#!/usr/bin/env python3
"""Собирает scenes/*.md в game/graph.js (window.GRAPH = …), чтобы игра открывалась двойным кликом."""
import json
import sys

from qqparse import ROOT, QQError, load


def main():
    try:
        g = load()
    except QQError as e:
        print("ОШИБКА:", e)
        sys.exit(1)
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
