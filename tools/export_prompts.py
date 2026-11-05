#!/usr/bin/env python3
"""Список промптов для картинок: docs/generated/image_prompts.md и .csv.
Файл для игры: game/img/<ID>.jpg (ID — как в сцене, движок ищет его сам)."""
import csv
from qqparse import ROOT, load

STYLE = {
    "bw": "authentic 1990s black-and-white amateur film photo, Soviet-era camera, grain, slight blur, white paper border",
    "color": "2000s color print from a photo lab, warm faded colors, flash, slight vignette, date stamp style",
    "digital": "early 2010s cheap digital point-and-shoot photo, noise, oversaturated, harsh flash",
    "phone": "2020s-2040s smartphone photo, natural light, slightly compressed, candid",
    "future": "2050s-2060s ultra-clean, unnaturally sharp and calm image, muted palette, eerie perfection",
}
COMMON = "first-person point of view, the narrator is never visible, Kemerovo / Kuzbass, Siberia, Russia, no text, no watermark"

def main():
    G = load()
    rows = []
    for sid, sc in sorted(G["scenes"].items(), key=lambda x: x[1].get("file", "")):
        if not sc.get("photo_prompt"):
            continue
        era = sc.get("photo", "bw")
        rows.append({"id": sid, "file": f"game/img/{sid}.jpg", "era": era, "caption": sc.get("photo_caption", ""),
                     "prompt": f"{sc['photo_prompt']}. Style: {STYLE.get(era, '')}. {COMMON}"})
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
