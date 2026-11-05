"""Стиль картинок «Тот, кто остался» (см. docs/05_visual.md).

Промпт = [сцена] + [персонажи] + [STYLE_ANCHOR: манера рисовки] + [ERA_MEDIUM: фото-носитель эпохи] + COMMON.

- Манера рисовки — КАК нарисовано. Одна на всю игру, выбирается после пробы стилей
  (`tools/gen_images.py --style-test`). В CSV стоит плейсхолдер `[STYLE_ANCHOR]`,
  gen_images.py подставляет вариант `--style N` (по умолчанию DEFAULT_STYLE).
- Носитель эпохи — КАКОЕ это фото (канон п. 24, «семейный альбом во времени»):
  рисованное, но выглядит как снимок своей эпохи.
Ключи ERA_MEDIUM совпадают с photo_eras в scenes/_config.json.
Используют: tools/export_prompts.py, tools/build_cast.py, tools/gen_images.py.
"""

PLACEHOLDER = "[STYLE_ANCHOR]"

# Варианты манеры рисовки для пробы. Номер = флаг --style N.
STYLE_ANCHORS = {
    1: ("painterly", "soft digital painting like key art of a narrative video game, visible brushstrokes, "
                     "simplified shapes, expressive warm-and-cold light"),
    2: ("ink-watercolor", "ink line drawing with loose watercolour washes, visible paper texture, "
                          "restrained palette, painted all the way to the edges of the frame"),
    3: ("gouache-soviet", "gouache and oil painting with bold visible brushstrokes, in the spirit of Soviet "
                          "1970s-80s children's book illustration, flat expressive forms"),
    4: ("cel-shaded", "graphic cel-shaded illustration, clean confident outlines, limited palette of five tones, "
                      "hard-edged shadow shapes"),
    5: ("charcoal", "pencil and charcoal drawing, smudged tones, visible hatching, rough paper grain"),
}
# Выбор автора после пробы стилей (05.11.2026): 2 — ink-watercolor.
DEFAULT_STYLE = 2

ERA_MEDIUM = {
    "bw": "illustrated photograph, painted to look like an authentic 1990s black-and-white amateur snapshot "
          "from a Soviet film camera: grain, slight blur",
    "color": "illustrated photograph, painted to look like a 2000s colour print from a photo lab: warm faded "
             "colours, flash, slight vignette, date-stamp feel",
    "digital": "illustrated photograph, painted to look like an early 2010s cheap digital point-and-shoot shot: "
               "noise, oversaturated colours, harsh flash",
    "phone": "illustrated photograph, painted to look like a 2020s-2040s smartphone photo: natural light, "
             "slightly compressed, candid",
    "future": "illustrated photograph, painted to look like a 2050s-2060s image: ultra-clean, unnaturally sharp "
              "and calm, muted palette, eerie perfection",
}

FULL_BLEED = ("full-bleed image: the picture fills the entire frame edge to edge, no border, no white margins, "
              "no paper edges, no vignette fading to white, no photo frame")

COMMON = (FULL_BLEED + ", first-person point of view, the narrator is never visible except his own hands, Kemerovo / Kuzbass, "
          "Siberia, Russia, no captions, no watermark, no brand logos, no recognizable real people")

# Эталоны всегда цветные (решение автора 05.11.2026), независимо от эпохи сцены.
REF_MEDIUM = "illustrated photograph in full natural colour, true-to-life hair, eye and skin colours"

REF_COMMON = (FULL_BLEED + ", character reference portrait for a story game, waist-up, three-quarter view, neutral plain "
              "light-grey background, soft natural light, no text, no watermark, no logos, "
              "an invented person, not a real or famous person")


def style_suffix(era: str) -> str:
    """Хвост промпта сцены: плейсхолдер манеры + носитель эпохи + общие правила."""
    return f"Drawing style: {PLACEHOLDER}. Medium: {ERA_MEDIUM.get(era, ERA_MEDIUM['phone'])}. {COMMON}"


def fill(prompt: str, style_no: int) -> str:
    """Подставляет выбранную манеру рисовки вместо плейсхолдера."""
    return prompt.replace(PLACEHOLDER, STYLE_ANCHORS[style_no][1])
