#!/usr/bin/env python3
"""Собирает scenes/*.md в game/graph.js (window.GRAPH = …), чтобы игра открывалась двойным кликом."""
import json
import sys

from qqparse import ROOT, QQError, load


def build_guides(g):
    """Путеводитель: ручные подсказки из scenes/_guides.json + путь-свидетель из tools/witness.py."""
    from witness import find_all
    import re
    hand = json.loads((ROOT / "scenes" / "_guides.json").read_text(encoding="utf-8"))
    S = g["scenes"]
    out = {}
    for fid, (path, _) in find_all(g).items():
        h = hand.get(fid, {})
        steps = []
        for sid, cid, death in path or []:
            sc = S[sid]
            m = re.search(r"(\d{4})", sc.get("date", ""))
            label = "Дальше" if cid is None else next(c["label"] for c in sc["choices"] if c["id"] == cid)
            steps.append({"scene": sid, "title": sc["title"], "year": m.group(1) if m else "",
                          "choice": cid, "label": label, "death": bool(death)})
        out[fid] = {"title": S[fid]["title"], "year": (re.search(r"(\d{4})", S[fid].get("date", "")) or [""])[0],
                    "hint": h.get("hint", ""), "forks": h.get("forks", []), "secret": h.get("secret", False),
                    "gate": h.get("gate"), "steps": steps, "found": path is not None}
    return out


def flag_sources(g):
    """Метка «↩ год · сцена»: для каждого флага — сцены, где его ставит выбор (fx варианта или исхода).
    Служебный F_ПУТЬ не метим: он только сортирует ветви."""
    flags = g["config"]["flags"]
    out = {}
    for sid, sc in g["scenes"].items():
        for c in sc.get("choices") or []:
            fxs = list(c.get("fx") or [])
            for o in c.get("outcomes") or []:
                fxs += o.get("fx") or []
            for _, name, _ in fxs:
                if name in flags and name != "F_ПУТЬ" and sid not in out.setdefault(name, []):
                    out[name].append(sid)
    return out


def expr_str(e):
    """AST условия → строка для режима автора (как в исходнике)."""
    if not isinstance(e, dict):
        return str(e)
    op = e.get("op")
    if op in ("num", "lit"):
        v = e["v"]
        return "null" if v is None else ("true" if v is True else "false" if v is False else str(v))
    if op == "var":
        return e["n"]
    if op == "truthy":
        return e["n"]
    if op == "not":
        return "!" + expr_str(e["a"])
    if op in ("and", "or"):
        j = " && " if op == "and" else " || "
        return "(" + j.join(expr_str(x) for x in e["a"]) + ")"
    if op == "cmp":
        return f"{expr_str(e['l'])} {e['c']} {expr_str(e['r'])}"
    if op == "seen":
        return ("seen_life" if e.get("life") else "seen") + f"({e['id']})"
    if op == "lived":
        return f"lived({e['id']})"
    if op in ("kinds", "branches", "one_life"):
        return op + "()"
    return op


def dev_index(g):
    """Для режима автора: где проверяется каждая переменная (пороги), где меняется, где читается каждый флаг."""
    import re
    V, F = g["config"]["vars"], g["config"]["flags"]
    checks, fxs, reads = {v: [] for v in V}, {v: [] for v in V}, {f: [] for f in F}
    year = lambda sc: (re.search(r"(\d{4})", sc.get("date", "")) or [""])[0]
    cut = lambda t, n=60: (t := re.sub(r"[*_]", "", t).replace("\n", " ").strip()) and (t if len(t) <= n else t[:n - 1].rstrip() + "…")

    def walk(e, acc):
        if not isinstance(e, dict):
            return acc
        if e.get("op") == "cmp" and e["l"].get("op") == "var":
            acc.append(e)
        elif e.get("op") == "truthy":
            acc.append(e)
        for k in ("a", "l", "r"):
            x = e.get(k)
            for y in (x if isinstance(x, list) else [x]):
                walk(y, acc)
        return acc

    def note(cond, sid, y, where, gives):
        for e in walk(cond, []):
            n = e["n"] if e.get("op") == "truthy" else e["l"]["n"]
            src = expr_str(e)
            if n in V and e.get("op") == "cmp" and e["r"].get("op") == "num":
                checks[n].append({"s": sid, "y": y, "w": where, "c": e["c"], "n": e["r"]["v"], "g": gives})
            elif n in F:
                reads[n].append({"s": sid, "y": y, "w": where, "c": src})

    for sid, sc in g["scenes"].items():
        y = year(sc)
        for b in sc.get("text") or []:
            note(b.get("if"), sid, y, "абзац «" + cut(b.get("md", "")) + "»", "абзац текста")
        for cid, blocks in (sc.get("after") or {}).items():
            for b in blocks:
                note(b.get("if"), sid, y, f"После {cid}: «" + cut(b.get("md", "")) + "»", "абзац последствия")
        for c in sc.get("choices") or []:
            lab = f"{c['id']} «{cut(c['label'], 50)}»"
            note(c.get("visible"), sid, y, "вариант " + lab + ": видимость", "открывает вариант")
            for o in c["outcomes"]:
                to = o["to"]
                tt = (g["scenes"].get(to) or g["deaths"].get(to) or {}).get("title", "")
                note(o.get("if"), sid, y, "вариант " + lab + ": исход", f"→ {to} «{tt}»")
            for o in [None] + c["outcomes"]:
                for kind, n, v in (c["fx"] if o is None else o.get("fx") or []):
                    if n in V:
                        d = (f"+{v}" if v >= 0 else str(v)) if kind == "add" else f"≤ {v}" if kind == "cap" else f"= {v}"
                        fxs[n].append({"s": sid, "y": y, "w": "вариант " + lab + ("" if o is None else f" → {o['to']}"), "d": d})
    for did, d in g["deaths"].items():
        y = year(d)
        for part in ("text", "awake"):
            for b in d.get(part) or []:
                note(b.get("if"), did, y, ("смерть" if part == "text" else "пробуждение") + " «" + cut(b.get("md", "")) + "»", "абзац смерти")
        if d.get("cause"):
            note(d["cause"]["if"], did, y, "причина смерти (лента)", "засечка «здесь началось»")
    for d in (checks, fxs, reads):
        for lst in d.values():
            lst.sort(key=lambda x: (x["y"] or "9999", x["s"]))
    return checks, fxs, reads


def main():
    try:
        g = load()
    except QQError as e:
        print("ОШИБКА:", e)
        sys.exit(1)
    memos = json.loads((ROOT / "scenes" / "_memos.json").read_text(encoding="utf-8"))
    memos.pop("_comment", None)
    g["memos"] = memos
    missing = [f for f in g["config"]["flags"] if f not in memos]
    if missing:
        print("ПРЕДУПРЕЖДЕНИЕ: нет подписи в scenes/_memos.json для", ", ".join(missing))
    g["flag_src"] = flag_sources(g)
    g["var_checks"], g["var_fx"], g["flag_reads"] = dev_index(g)
    if "--no-witness" not in sys.argv:
        g["guides"] = build_guides(g)
    else:  # без поиска — оставить путеводитель из прошлой сборки, чтобы он не пропал из игры
        old = ROOT / "game" / "graph.js"
        if old.exists():
            try:
                g["guides"] = json.loads(old.read_text(encoding="utf-8")[len("window.GRAPH = "):-2]).get("guides", {})
            except ValueError:
                pass
    if "--no-dev" not in sys.argv:  # пресеты режима автора → game/dev.js (≈15 с)
        import dev_presets
        dev_presets.main()
    out = ROOT / "game" / "graph.js"
    out.write_text("window.GRAPH = " + json.dumps(g, ensure_ascii=False) + ";\n", encoding="utf-8")
    # вариант для публикации как Artifact: без своего каркаса doctype/html/head/body
    html = (ROOT / "game" / "index.html").read_text(encoding="utf-8")
    head = html.split("<head>", 1)[1].split("</head>", 1)[0]
    body = html.split("<body>", 1)[1].split("</body>", 1)[0]
    keep = [l for l in head.splitlines() if "<meta charset" not in l and 'name="viewport"' not in l]
    keep.insert(1, '<meta name="claude:viewport-fit-sides" content="cover">')
    (ROOT / "game" / "play.html").write_text("\n".join(keep).strip() + "\n" + body.strip() + "\n", encoding="utf-8")
    print(f"собрано: {len(g['scenes'])} сцен, {len(g['deaths'])} смертей → {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
