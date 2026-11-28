#!/usr/bin/env python3
"""Просмотр и применение правок критика (tools/text_critic.py).

    python3 tools/apply_fixes.py show docs/review/ru/2026-11-28_В1.json      # пронумерованный список
    python3 tools/apply_fixes.py apply docs/review/ru/2026-11-28_В1.json --ok 1,3,5-9 [--edit edits.json]

--ok — номера принятых правок (остальные отклонены). --edit — JSON {"номер": "свой вариант replace"} для правок,
которые принимаются в исправленном виде. Каждая правка применяется, только если find встречается в файле ровно
один раз и не задевает строки логики/разметки. Решения пишутся обратно в JSON (поле "decision").

Русская правка меняет хэш исходника: у английского файла с тем же именем src_sha обновляется ТОЛЬКО если
передан --sync-en (шоураннер подтверждает, что правка стилистическая и английский смысл не изменился);
иначе английский файл станет «устаревшим» в validate.py — и это честно.
"""
import argparse
import hashlib
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
LOGIC = re.compile(r"^\s*(::|fx:|if |->|visible:|cost:|tags:|id:|src_sha:|## )")


def nums(s):
    out = set()
    for part in filter(None, (s or "").split(",")):
        if "-" in part:
            a, b = part.split("-"); out.update(range(int(a), int(b) + 1))
        else:
            out.add(int(part))
    return out


def src_dir(review):
    return ROOT / ("scenes" if "/ru/" in str(review).replace("\\", "/") else "scenes_en")


def show(path):
    d = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    for i, f in enumerate(d.get("fixes", []), 1):
        print(f"{i:3}. [{f.get('file')}] ({f.get('kind')}) {f.get('why')}\n     − {f.get('find')}\n     + {f.get('replace')}")
    if d.get("verdict"):
        print("\nВЕРДИКТ:", d["verdict"])


def apply(path, ok, edits, sync_en):
    path = pathlib.Path(path)
    d = json.loads(path.read_text(encoding="utf-8"))
    base, changed, report = src_dir(path), set(), {"applied": 0, "rejected": 0, "failed": []}
    for i, f in enumerate(d.get("fixes", []), 1):
        if i not in ok:
            f["decision"] = "rejected"; report["rejected"] += 1; continue
        rep = edits.get(str(i), f["replace"])
        p = base / f["file"]
        if not p.exists():
            f["decision"] = "failed: нет файла"; report["failed"].append(i); continue
        t = p.read_text(encoding="utf-8")
        n = t.count(f["find"])
        if n != 1:
            f["decision"] = f"failed: find встречается {n} раз"; report["failed"].append(i); continue
        k = t.index(f["find"])
        line_start = t.rfind("\n", 0, k) + 1
        line = t[line_start:t.find("\n", k) if t.find("\n", k) >= 0 else len(t)]
        head_end = t.find("\n---", 4)
        if k < head_end or LOGIC.match(line):
            f["decision"] = "failed: задевает шапку или логику"; report["failed"].append(i); continue
        p.write_text(t.replace(f["find"], rep, 1), encoding="utf-8")
        f["decision"] = "applied" + (" (edited)" if str(i) in edits else "")
        if rep != f["replace"]:
            f["replace_final"] = rep
        changed.add(f["file"]); report["applied"] += 1
    path.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
    if sync_en and base.name == "scenes":
        for name in sorted(changed):
            en = ROOT / "scenes_en" / name
            if en.exists():
                sha = hashlib.sha1((ROOT / "scenes" / name).read_bytes()).hexdigest()[:12]
                t = en.read_text(encoding="utf-8")
                en.write_text(re.sub(r"^src_sha: .*$", "src_sha: " + sha, t, count=1, flags=re.M), encoding="utf-8")
    print(f"применено {report['applied']}, отклонено {report['rejected']}, не легло {report['failed']}; файлы: {', '.join(sorted(changed))}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["show", "apply"])
    ap.add_argument("review")
    ap.add_argument("--ok", default="")
    ap.add_argument("--edit")
    ap.add_argument("--sync-en", action="store_true")
    a = ap.parse_args()
    if a.cmd == "show":
        show(a.review)
    else:
        edits = json.loads(pathlib.Path(a.edit).read_text(encoding="utf-8")) if a.edit else {}
        apply(a.review, nums(a.ok), edits, a.sync_en)


if __name__ == "__main__":
    sys.exit(main())
