#!/bin/bash
# Портреты персонажей для «Объяснения» через OpenAI Images API
cd "$(dirname "$0")"
STYLE="Painterly digital portrait for a narrative video game, head and shoulders, three-quarter view, night scene lit by warm sodium streetlight from one side and cold blue moonlight from the other, muted dark teal and amber palette, visible brush strokes, post-Soviet Siberian industrial town, realistic proportions, dark simple background, no text, no letters, no frame."
gen () {
  local name="$1" desc="$2"
  python3 - "$name" "$desc" "$STYLE" <<'PY'
import json, sys, urllib.request, base64, os
name, desc, style = sys.argv[1], sys.argv[2], sys.argv[3]
body = json.dumps({"model": "gpt-image-2", "prompt": desc + " " + style, "size": "1024x1024", "quality": "medium", "n": 1}).encode()
req = urllib.request.Request("https://api.openai.com/v1/images/generations", data=body,
  headers={"Authorization": "Bearer " + os.environ["OPENAI_API_KEY"], "Content-Type": "application/json"})
d = json.load(urllib.request.urlopen(req, timeout=300))
open(name + "_raw.png", "wb").write(base64.b64decode(d["data"][0]["b64_json"]))
print("ok", name)
PY
}
gen misha "Misha, a tired 34-year-old miner and friend, stubble, short dark hair, worn checked shirt, kind heavy eyes, asleep-looking, slightly grey skin." &
gen liza "Liza, a 29-year-old woman, the hero's younger sister, light brown hair in a loose braid, freckles, gentle stubborn smile, knitted grey cardigan." &
gen danya "Danya, a 7-year-old boy, messy fair hair, big serious eyes, oversized striped t-shirt, a scratch on his cheek." &
gen gosha "Gosha, a 55-year-old car mechanic, bald with a grey moustache, oily blue work overalls, flat cap pushed back, skeptical squint." &
wait
for n in misha liza danya gosha; do [ -f ${n}_raw.png ] && convert ${n}_raw.png -resize 256x256 -quality 82 ${n}.jpg; done
ls -la *.jpg
