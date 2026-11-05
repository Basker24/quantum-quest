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
    if "--no-witness" not in sys.argv:
        g["guides"] = build_guides(g)
    else:  # без поиска — оставить путеводитель из прошлой сборки, чтобы он не пропал из игры
        old = ROOT / "game" / "graph.js"
        if old.exists():
            try:
                g["guides"] = json.loads(old.read_text(encoding="utf-8")[len("window.GRAPH = "):-2]).get("guides", {})
            except ValueError:
                pass
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
