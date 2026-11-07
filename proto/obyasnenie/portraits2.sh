#!/bin/bash
# Портреты Витьки и Ники под канон «Тот, кто остался» (OpenAI, gpt-image-2)
cd "$(dirname "$0")"
STYLE="Painterly digital portrait for a narrative video game, head and shoulders, three-quarter view, night scene lit by warm sodium streetlight from one side and cold blue moonlight from the other, muted dark teal and amber palette, visible brush strokes, post-Soviet Siberian industrial town, realistic proportions, dark simple background, no text, no letters, no frame."
gen () {
  python3 - "$1" "$2" "$STYLE" <<'PY'
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
gen misha "Vitka, a 35-year-old coal miner, the hero's childhood friend: bright red hair cut short, lots of freckles, red stubble, tired heavy eyes after a double shift, worn checked flannel shirt, a crooked grin." &
gen liza "Nika, a 34-year-old woman, the hero's sister: short dark-blond pixie haircut, serious strict face like a school headmistress, thin lips, attentive grey eyes, plain grey knitted sweater, no makeup." &
wait
for n in misha liza; do [ -f ${n}_raw.png ] && convert ${n}_raw.png -resize 256x256 -quality 82 ${n}.jpg; done
ls -la misha.jpg liza.jpg
