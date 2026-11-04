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
    print(f"собрано: {len(g['scenes'])} сцен, {len(g['deaths'])} смертей → {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
