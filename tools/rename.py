#!/usr/bin/env python3
"""Переименовать сцену или смерть везде: python3 tools/rename.py СТАРЫЙ НОВЫЙ

Меняет id в шапке файла, все стрелки `-> ID`, `## Далее -> ID`, `seen(ID)` / `seen_life(ID)`
и поле "scene" в meta_entries конфига. Файл на диске не переименовывает (имя файла ни на что не влияет).
После переименования запусти build.py и validate.py.
"""
import json
import re
import sys

from qqparse import SCENES


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    old, new = sys.argv[1], sys.argv[2]
    if old.startswith("✝") != new.startswith("✝"):
        print("Нельзя превратить сцену в смерть и наоборот.")
        sys.exit(2)
    esc = re.escape(old)
    pats = [
        (re.compile(rf"^(id:\s*){esc}\s*$", re.M), rf"\g<1>{new}"),
        (re.compile(rf"(->\s*){esc}(?=\s|$|;)", re.M), rf"\g<1>{new}"),
        (re.compile(rf"(seen(?:_life)?\(\s*){esc}(\s*\))"), rf"\g<1>{new}\g<2>"),
    ]
    changed = 0
    for p in sorted(SCENES.glob("*.md")):
        src = p.read_text(encoding="utf-8")
        out = src
        for rx, rep in pats:
            out = rx.sub(rep, out)
        if out != src:
            p.write_text(out, encoding="utf-8")
            changed += 1
            print("  изменён", p.name)
    cfg_path = SCENES / "_config.json"
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    hit = False
    if cfg.get("start") == old:
        cfg["start"] = new
        hit = True
    for m in cfg.get("meta_entries", []):
        if m.get("scene") == old:
            m["scene"] = new
            hit = True
    if hit:
        cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("  изменён _config.json")
    print(f"готово: {old} → {new}, файлов: {changed + hit}")


if __name__ == "__main__":
    main()
