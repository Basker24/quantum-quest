#!/usr/bin/env bash
# Сборка браузерной версии для itch.io: dist/tot-kto-ostalsya-itch.zip, index.html в корне архива.
# Эталоны (img/ref), пробы стиля (img/style-test) и архивные кадры не попадают.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 tools/build.py --no-witness >/dev/null
OUT=dist/itch
rm -rf "$OUT" && mkdir -p "$OUT/img"
cp game/index.html game/engine.js game/graph.js game/dev.js game/style.css "$OUT/"
find game/img -maxdepth 1 -type f \( -name '*.jpg' -o -name '*.png' -o -name '*.webp' \) ! -name '*архив*' -exec cp {} "$OUT/img/" \;
if [ -d game/obyasnenie ]; then cp -r game/obyasnenie "$OUT/"; fi
( cd "$OUT" && rm -f ../tot-kto-ostalsya-itch.zip && zip -qr ../tot-kto-ostalsya-itch.zip . )
echo "готово: dist/tot-kto-ostalsya-itch.zip ($(du -h dist/tot-kto-ostalsya-itch.zip | cut -f1))"
