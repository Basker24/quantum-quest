#!/usr/bin/env python3
"""Генерация картинок через OpenAI Images API (только стандартная библиотека + urllib).

Ключ: переменная окружения OPENAI_API_KEY (скрипт его никогда не печатает).

Режимы:
  --refs                 портреты-эталоны из docs/generated/characters.csv → game/img/ref/<char>_<age>.png
                         (фильтры: --tier main|episodic|all, --chars nika,vitka, --ages 7,22)
  --scenes Т-01,В1-05    сцены из docs/generated/scene_cast.csv → game/img/<ID>.jpg
  --all                  все сцены из scene_cast.csv
  --style-test           проба манер рисовки: Т-01 в 5 вариантах, в цвете, без носителя эпохи
                         → game/img/style-test/<n>-<имя>.jpg (с --style N — только один вариант)

Если у сцены есть персонажи и их эталоны уже лежат на диске, запрос идёт в /v1/images/edits
с эталонами как референсами; иначе — /v1/images/generations.

Общие флаги: --model gpt-image-1, --quality medium, --size 1536x1024, --ref-size 1024x1536,
--style N (манера рисовки, см. tools/artstyle.py), --force (перегенерировать существующие),
--dry-run (печатает запросы, сеть не трогает, ключ не нужен).
Журнал расходов: docs/generated/images_log.csv.

API (по документации OpenAI Images API; сверено по памяти, сети в сессии подготовки не было):
  POST /v1/images/generations  JSON: model, prompt, n, size (1024x1024|1536x1024|1024x1536|auto),
       quality (low|medium|high|auto), output_format (png|jpeg|webp), output_compression, moderation (auto|low)
  POST /v1/images/edits        multipart: model, prompt, image[] (до 16 картинок для gpt-image-1),
       size, quality, n, output_format, input_fidelity (high|low, gpt-image-1)
  Ответ: {"data": [{"b64_json": "..."}], "usage": {...}}
"""
import argparse
import base64
import csv
import datetime as dt
import io
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import artstyle  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
GEN = ROOT / "docs" / "generated"
CHARS_CSV = GEN / "characters.csv"
CAST_CSV = GEN / "scene_cast.csv"
LOG_CSV = GEN / "images_log.csv"
STYLE_TEST_DIR = ROOT / "game" / "img" / "style-test"
STYLE_TEST_SCENE = "Т-01"

API = "https://api.openai.com/v1/images"
DEFAULT_MODEL = "gpt-image-1"
MAX_REFS = 6           # больше референсов — дороже и хуже держит каждого
LONG_SIDE = 1200       # сжатие результата для игры
RETRY_PAUSES = (5, 15, 45)

try:
    from PIL import Image  # noqa: F401
    HAVE_PIL = True
except ImportError:
    HAVE_PIL = False

LATIN_TO_CYR = str.maketrans({"T": "Т", "B": "В", "F": "Ф", "K": "К", "A": "А", "J": "Ж"})


# ---------------------------------------------------------------- helpers
def read_csv(path):
    if not path.exists():
        sys.exit(f"ошибка: нет {path.relative_to(ROOT)} — запусти python3 tools/build_cast.py")
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def log(row):
    new = not LOG_CSV.exists()
    with open(LOG_CSV, "a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["id", "time", "kind", "model", "quality", "size", "status", "file", "refs", "tokens"])
        if new:
            w.writeheader()
        w.writerow(row)


def api_key(dry):
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key and not dry:
        sys.exit("ошибка: не задан OPENAI_API_KEY. Задай ключ в переменных окружения "
                 "(export OPENAI_API_KEY=...) или запусти с --dry-run.")
    return key


def multipart(fields, files):
    """fields: [(name, value)], files: [(name, path)] → (body, content_type)."""
    b = f"----qq{uuid.uuid4().hex}"
    out = io.BytesIO()
    for name, val in fields:
        out.write(f"--{b}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{val}\r\n".encode())
    for name, path in files:
        mime = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
        out.write(f"--{b}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{path.name}\"\r\n"
                  f"Content-Type: {mime}\r\n\r\n".encode())
        out.write(path.read_bytes())
        out.write(b"\r\n")
    out.write(f"--{b}--\r\n".encode())
    return out.getvalue(), f"multipart/form-data; boundary={b}"


def call(key, endpoint, body, ctype, timeout):
    req = urllib.request.Request(f"{API}/{endpoint}", data=body, method="POST",
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": ctype})
    for i, pause in enumerate((0,) + RETRY_PAUSES):
        if pause:
            print(f"    повтор через {pause} с…")
            time.sleep(pause)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            txt = e.read().decode("utf-8", "replace")
            try:
                msg = json.loads(txt)["error"]["message"]
            except Exception:
                msg = txt[:300]
            if e.code in (429, 500, 502, 503, 504) and i < len(RETRY_PAUSES):
                print(f"    HTTP {e.code}: {msg}")
                continue
            raise RuntimeError(f"HTTP {e.code}: {msg}") from None
        except (urllib.error.URLError, TimeoutError) as e:
            if i < len(RETRY_PAUSES):
                print(f"    сеть: {e}")
                continue
            raise RuntimeError(f"сеть: {e}") from None


_warned = False


def save(raw, out, compress):
    global _warned
    out.parent.mkdir(parents=True, exist_ok=True)
    if compress and HAVE_PIL:
        from PIL import Image
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        im.thumbnail((LONG_SIDE, LONG_SIDE))
        im.save(out, "JPEG", quality=85, optimize=True, progressive=True)
    else:
        if compress and not _warned:
            print("  ПРЕДУПРЕЖДЕНИЕ: Pillow не установлен — сохраняю как есть, без сжатия до "
                  f"{LONG_SIDE}px (pip install pillow)")
            _warned = True
        out.write_bytes(raw)
    return out.stat().st_size


def generate(args, key, kind, item_id, prompt, out, size, refs=(), compress=True):
    """Один запрос. refs — существующие файлы эталонов (тогда endpoint edits)."""
    rel = out.relative_to(ROOT)
    if out.exists() and not args.force:
        print(f"  пропуск {item_id}: {rel} уже есть (--force для перегенерации)")
        return
    fmt = "jpeg" if compress else "png"
    if refs:
        names = "; ".join(f"image {i + 1} — {lab}" for i, (lab, _) in enumerate(refs))
        prompt = (f"Reference images ({names}): use them only to keep these characters' faces, hair, build and "
                  f"clothing consistent; do not copy their background, pose or framing. {prompt}")
        endpoint = "edits"
        fields = [("model", args.model), ("prompt", prompt), ("size", size), ("quality", args.quality),
                  ("n", "1"), ("output_format", fmt)]
        if args.fidelity != "none":
            fields.append(("input_fidelity", args.fidelity))
        files = [("image[]", p) for _, p in refs]
    else:
        endpoint = "generations"
        payload = {"model": args.model, "prompt": prompt, "size": size, "quality": args.quality, "n": 1,
                   "output_format": fmt}
        if args.moderation != "auto":
            payload["moderation"] = args.moderation
    if args.dry_run:
        print(f"\n[{kind}] {item_id} → {rel}")
        print(f"  POST {API}/{endpoint}  model={args.model} quality={args.quality} size={size} format={fmt}")
        if refs:
            for lab, p in refs:
                print(f"  image[]: {p.relative_to(ROOT)} ({lab})")
            if args.fidelity != "none":
                print(f"  input_fidelity={args.fidelity}")
        print(f"  prompt ({len(prompt)} симв.): {prompt}")
        return
    t0 = dt.datetime.now().isoformat(timespec="seconds")
    try:
        if refs:
            body, ctype = multipart(fields, files)
        else:
            body, ctype = json.dumps(payload).encode(), "application/json"
        res = call(key, endpoint, body, ctype, args.timeout)
        raw = base64.b64decode(res["data"][0]["b64_json"])
        nbytes = save(raw, out, compress)
        tokens = (res.get("usage") or {}).get("total_tokens", "")
        status = "ok"
        print(f"  ok {item_id} → {rel} ({nbytes // 1024} КБ, {endpoint})")
    except Exception as e:  # noqa: BLE001
        status, tokens = f"error: {e}", ""
        print(f"  ОШИБКА {item_id}: {e}")
    log({"id": item_id, "time": t0, "kind": kind, "model": args.model, "quality": args.quality, "size": size,
         "status": status, "file": str(rel), "refs": ";".join(lab for lab, _ in refs), "tokens": tokens})


def style_no(args):
    if args.style:
        return args.style
    if artstyle.DEFAULT_STYLE:
        return artstyle.DEFAULT_STYLE
    print("ПРЕДУПРЕЖДЕНИЕ: манера рисовки не выбрана (artstyle.DEFAULT_STYLE = None) — беру --style 1")
    return 1


def scene_refs(cast):
    refs = []
    for tok in filter(None, cast.split(";")):
        cid, age = tok.split(":")
        p = ROOT / "game" / "img" / "ref" / f"{cid}_{age}.png"
        if p.exists():
            refs.append((f"{cid} age {age}", p))
    return refs[:MAX_REFS]


# ---------------------------------------------------------------- modes
def run_refs(args, key):
    rows = read_csv(CHARS_CSV)
    if args.tier != "all":
        rows = [r for r in rows if r["tier"] == args.tier]
    if args.chars:
        want = set(args.chars.split(","))
        rows = [r for r in rows if r["char_id"] in want]
    if args.ages:
        want = set(args.ages.split(","))
        rows = [r for r in rows if r["age"] in want]
    n = style_no(args)
    print(f"эталонов: {len(rows)}, манера {n} «{artstyle.STYLE_ANCHORS[n][0]}»")
    for r in rows:
        generate(args, key, "ref", f"{r['char_id']}_{r['age']}", artstyle.fill(r["prompt"], n),
                 ROOT / r["ref_file"], args.ref_size, compress=False)


def run_scenes(args, key, ids):
    rows = {r["id"]: r for r in read_csv(CAST_CSV)}
    if ids is None:
        sel = list(rows.values())
    else:
        sel = []
        for i in ids:
            r = rows.get(i) or rows.get(i.translate(LATIN_TO_CYR))
            if not r:
                sys.exit(f"ошибка: сцены {i} нет в scene_cast.csv")
            sel.append(r)
    n = style_no(args)
    print(f"сцен: {len(sel)}, манера {n} «{artstyle.STYLE_ANCHORS[n][0]}»")
    for r in sel:
        generate(args, key, "scene", r["id"], artstyle.fill(r["prompt"], n), ROOT / r["file"], args.size,
                 refs=scene_refs(r["cast"]))


def run_style_test(args, key):
    rows = {r["id"]: r for r in read_csv(CAST_CSV)}
    r = rows[STYLE_TEST_SCENE]
    base = r["prompt"].split(" Drawing style:")[0].rstrip(". ")
    for word in ("old black-and-white family photo, ", "grain, scratches, white border"):
        base = base.replace(word, "")
    base = base.rstrip(", ")
    nums = [args.style] if args.style else sorted(artstyle.STYLE_ANCHORS)
    for n in nums:
        name, anchor = artstyle.STYLE_ANCHORS[n]
        prompt = (f"{base}. Drawing style: {anchor}. Full natural colour, neutral summer daylight palette, "
                  f"no photo border, no film grain, no vintage effect. {artstyle.COMMON}")
        generate(args, key, "style-test", f"style-{n}-{name}", prompt, STYLE_TEST_DIR / f"{n}-{name}.jpg",
                 args.size, refs=scene_refs(r["cast"]))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    m = ap.add_mutually_exclusive_group(required=True)
    m.add_argument("--refs", action="store_true", help="портреты-эталоны")
    m.add_argument("--scenes", help="ID сцен через запятую")
    m.add_argument("--all", action="store_true", help="все сцены")
    m.add_argument("--style-test", action="store_true", help="проба 5 манер рисовки на Т-01")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--quality", default="medium", choices=["low", "medium", "high", "auto"])
    ap.add_argument("--size", default="1536x1024", choices=["1024x1024", "1536x1024", "1024x1536", "auto"])
    ap.add_argument("--ref-size", default="1024x1536", choices=["1024x1024", "1536x1024", "1024x1536", "auto"])
    ap.add_argument("--style", type=int, choices=sorted(artstyle.STYLE_ANCHORS), help="манера рисовки")
    ap.add_argument("--tier", default="all", choices=["main", "episodic", "all"])
    ap.add_argument("--chars", help="только эти char_id (через запятую)")
    ap.add_argument("--ages", help="только эти возрасты (через запятую)")
    ap.add_argument("--fidelity", default="high", choices=["high", "low", "none"],
                    help="input_fidelity для edits (none — не отправлять)")
    ap.add_argument("--moderation", default="auto", choices=["auto", "low"])
    ap.add_argument("--timeout", type=int, default=300)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    key = api_key(args.dry_run)
    if not HAVE_PIL and not args.dry_run:
        print(f"ПРЕДУПРЕЖДЕНИЕ: Pillow не найден — сцены сохранятся без сжатия до {LONG_SIDE}px")
    if args.refs:
        run_refs(args, key)
    elif args.style_test:
        run_style_test(args, key)
    else:
        run_scenes(args, key, None if args.all else [s.strip() for s in args.scenes.split(",") if s.strip()])


if __name__ == "__main__":
    main()
