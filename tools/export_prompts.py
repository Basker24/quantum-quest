#!/usr/bin/env python3
"""Список промптов для картинок: docs/generated/image_prompts.md и .csv.
Файл для игры: game/img/<ID>.jpg (ID — как в сцене, движок ищет его сам).
В промпте плейсхолдер [STYLE_ANCHOR] — манеру рисовки подставляет tools/gen_images.py --style N."""
import csv
from qqparse import ROOT, load

# Стиль: манера рисовки (плейсхолдер [STYLE_ANCHOR]) + фото-носитель эпохи — см. tools/artstyle.py
from artstyle import ERA_MEDIUM as STYLE, style_suffix

def main():
    G = load()
    rows = []
    for sid, sc in sorted(G["scenes"].items(), key=lambda x: x[1].get("file", "")):
        if not sc.get("photo_prompt"):
            continue
        era = sc.get("photo", "bw")
        rows.append({"id": sid, "file": f"game/img/{sid}.jpg", "era": era, "caption": sc.get("photo_caption", ""),
                     "prompt": f"{sc['photo_prompt'].rstrip('. ')}. {style_suffix(era)}"})
    out = ROOT / "docs" / "generated"
    with open(out / "image_prompts.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["id", "file", "era", "caption", "prompt"]); w.writeheader(); w.writerows(rows)
    md = ["# Промпты для картинок", "", f"{len(rows)} сцен. Готовую картинку назови как в колонке «файл» и положи в `game/img/`.", ""]
    for r in rows:
        md += [f"## {r['id']} · {r['caption']}", f"файл: `{r['file']}` · эпоха: {r['era']}", "", "```", r["prompt"], "```", ""]
    (out / "image_prompts.md").write_text("\n".join(md), encoding="utf-8")
    print(f"промпты: {len(rows)} → docs/generated/image_prompts.md, .csv")

if __name__ == "__main__":
    main()
