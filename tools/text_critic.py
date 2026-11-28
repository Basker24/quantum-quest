#!/usr/bin/env python3
"""Литературный критик по всему тексту игры через OpenAI API. Выдаёт ТОЧНЫЕ правки «было → стало» (JSON),
которые шоураннер просматривает и применяет tools/apply_fixes.py. Сам ничего в сценах не меняет.

    python3 tools/text_critic.py --lang ru [--lives В1,Т] [--jobs 4] [--model gpt-5.5] [--effort medium]
    python3 tools/text_critic.py --lang en ...

ru — русский текст: нейросетевые обороты, канцелярит, кальки, сочетаемость, стоп-лист docs/03_style.md.
en — английский перевод против русского оригинала: глоссарий docs/en/glossary.md и docs/en/style_en.md.
Партии — по жизням (префикс ID: Т, В1, …, Ф, К), смерти идут со своей жизнью; большие жизни режутся на части.
Результат: docs/review/<lang>/<дата>_<жизнь>[_N].json — {"fixes": [{file, find, replace, kind, why}], "verdict"}.
Ключ — OPENAI_API_KEY (никогда не печатать). Только стандартная библиотека.
"""
import argparse
import concurrent.futures as cf
import datetime
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from en_critic import ask, strip_notes  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "review"
MAX_CHARS = 60000

RULES_JSON = """
ФОРМАТ ОТВЕТА — только JSON, без пояснений вокруг:
{"fixes": [{"file": "B1-05.md", "find": "точная цитата из файла", "replace": "исправленный вариант",
            "kind": "тик|канцелярит|калька|сочетаемость|логика|ритм|опечатка|регистр|смысл", "why": "коротко, почему"}],
 "verdict": "2–4 фразы: общее впечатление о партии и три самых частых проблемы"}
Правила для find/replace:
- find — дословная цитата из прозы файла (символ в символ, с теми же кавычками «» и тире), от нескольких слов
  до двух предложений, и она должна встречаться в файле ровно один раз. Бери самый короткий кусок,
  который однозначно находится.
- Никогда не трогай разметку и логику: строки шапки (до второго ---), строки с "::", "fx:", "if ", "->",
  "visible:", "cost:", "tags:", ID сцен, имена флагов и переменных, заголовки "## …".
- replace меняет только то, что нужно; смысл, факты, числа (04:12, 252, годы, возраст), имена, предметы сохраняются.
- Не больше 12 правок на файл; если файл хороший — ни одной. Лучше пропустить спорное, чем испортить живое.
"""

BRIEF_RU = """Ты — строгий литературный редактор русской прозы старой школы (уровень редактора «Нового мира»).
Перед тобой текстовая ветвящаяся игра: от первого лица, настоящее время, Кузбасс, герой тонет в семь лет в 1996-м
и живёт дальше через смерти в соседних мирах. Голос взрослеет вместе с героем (дворовая речь ребёнка, сленг
подростка 2000-х, взрослая речь), плюс короткие сухие ремарки его же в 72 года (абзацы с "> ").
Строки с "! " — служебные плашки интерфейса. Разметка: "::if … ::end" — условные куски текста,
"## Выбор" — варианты ("- [A] текст" видит игрок), "## После X", "## Пробуждение".

Задача: текст должен читаться как хорошая классическая русская проза, а не как текст нейросети.
Ищи и исправляй:
1. Нейросетевые тики: «не X, а Y» / «не X — Y» без нужды; триады; драматичные обрубки и однословные абзацы;
   повтор-усиление; пафосная последняя строка; «будто/словно/как будто» пачками; «что-то внутри», «тишина звенит»,
   «где-то на краю сознания», «повисает тишина», «время замирает»; объявленная эмоция («мне стало страшно»)
   вместо действия тела; двоеточие с «раскрытием главного»; лишние тире-вставки; «Если иначе — …».
2. Канцелярит и кальки с английского: «осуществить», «является», «в данный момент», «сделать выбор»,
   «это имеет смысл», «окей» в авторской речи, неестественный порядок слов, страдательные обороты.
3. Сочетаемость и управление глаголов, местоимения, которые непонятно к чему относятся, выброшенные
   подразумеваемые слова («сидел сорок» — чего?), противоречия внутри фразы, бытовая и физическая логика.
4. Ритм: три коротких предложения подряд, однообразное начало фраз («Я… Я… Я…»).
5. Регистр возраста: ребёнок не говорит словами взрослого, подросток 2005-го — словами 2020-х.
6. Опечатки, грамматика, пунктуация.
Не трогай: живую разговорную речь в репликах, мат «за кадром», сибирские и шахтёрские слова, сознательные
повторы-мотивы (счёт, 04:12, тельняшка, камертон, вода), стилизацию детской речи. Не делай текст гладким
и книжным там, где он нарочно шершавый. Не переписывай сцены целиком.

Ниже — стайлгайд автора; он важнее твоих вкусов.
""" + RULES_JSON

BRIEF_EN = """You are a demanding native-speaker literary editor checking an English adaptation of a Russian
branching text game, "The One Who Stayed". First person, present tense, a boy from Kemerovo (Kuzbass) who drowns
at seven in 1996 and keeps living; every age has its own voice, plus dry asides from himself at 72 in 2061
(paragraphs starting with "> "). Lines starting with "! " are interface notes. Markup: header, "::if … ::end",
"## Выбор" choices ("- [A] text" is what the player sees), "## После X", "## Пробуждение" — headings are markup.
You get the Russian original and the English for each scene file.

Find and fix in the ENGLISH: unidiomatic phrasing and calques; register slips for the narrator's age; realia an
English reader can't follow, or over-explained ones; AI tics ("not X but Y", triads, em-dash cascades, one-word
dramatic paragraphs, announced emotions, purple last lines); meaning errors against the Russian (lost or added
details that matter: 04:12, 252, scars, the watch, names, numbers); typos and grammar.
Follow the glossary and style guide below; flag only real problems. Answer in JSON as specified; "file" is the
English file name, "find" quotes the ENGLISH text exactly, "why" may be in English.
""" + RULES_JSON.replace("ФОРМАТ ОТВЕТА — только JSON, без пояснений вокруг:", "ANSWER FORMAT — JSON only:")


def life_of(text):
    m = re.search(r"^id:\s*(\S+)", text, re.M)
    i = m.group(1).lstrip("✝") if m else "?"
    return "К" if i.startswith("⊣") else i.split("-")[0]


def batches(lang, lives):
    src = ROOT / ("scenes" if lang == "ru" else "scenes_en")
    groups = {}
    for p in sorted(src.glob("*.md")):
        if p.name.startswith("_"):
            continue
        ru = ROOT / "scenes" / p.name
        lf = life_of(ru.read_text(encoding="utf-8"))
        if lives and lf not in lives:
            continue
        if lang == "ru":
            chunk = f"########## FILE {p.name}\n" + strip_notes(p.read_text(encoding="utf-8"))
        else:
            chunk = (f"########## FILE {p.name}\n--- RUSSIAN ORIGINAL ---\n" + strip_notes(ru.read_text(encoding="utf-8"))
                     + "\n--- ENGLISH ---\n" + strip_notes(p.read_text(encoding="utf-8")))
        groups.setdefault(lf, []).append(chunk)
    out = []
    for lf, chunks in groups.items():
        part, size, n = [], 0, 1
        for c in chunks:
            if part and size + len(c) > MAX_CHARS:
                out.append((f"{lf}_{n}", part)); part, size, n = [], 0, n + 1
            part.append(c); size += len(c)
        if part:
            out.append((f"{lf}_{n}" if n > 1 else lf, part))
    return out


def parse(answer):
    s = answer.strip()
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s)
    i, j = s.find("{"), s.rfind("}")
    return json.loads(s[i:j + 1])


def run(lang, name, parts, models, effort, ctx):
    brief = (BRIEF_RU if lang == "ru" else BRIEF_EN) + "\n\n" + ctx
    answer, model, usage = ask(brief, "\n\n".join(parts), models, effort)
    d = OUT / lang
    d.mkdir(parents=True, exist_ok=True)
    f = d / f"{datetime.date.today().isoformat()}_{name}.json"
    try:
        data = parse(answer)
    except Exception:
        data = {"fixes": [], "verdict": "", "raw": answer}
    data["_meta"] = {"model": model, "usage": usage, "files": [p.split("\n", 1)[0][11:] for p in parts]}
    f.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    return f, len(data.get("fixes", []))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", choices=["ru", "en"], required=True)
    ap.add_argument("--lives", help="через запятую: Т,В1,…,Ф,К")
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--model", default="gpt-5.5")
    ap.add_argument("--effort", default="medium", choices=["low", "medium", "high"])
    a = ap.parse_args()
    lives = set(a.lives.split(",")) if a.lives else None
    if a.lang == "ru":
        ctx = (ROOT / "docs" / "03_style.md").read_text(encoding="utf-8")
    else:
        ctx = "\n\n".join((ROOT / "docs" / "en" / n).read_text(encoding="utf-8") for n in ("glossary.md", "style_en.md"))
    bs = batches(a.lang, lives)
    print(f"{a.lang}: партий {len(bs)}, знаков {sum(len(x) for _, p in bs for x in p)}", file=sys.stderr)
    with cf.ThreadPoolExecutor(a.jobs) as ex:
        futs = {ex.submit(run, a.lang, n, p, [a.model], a.effort, ctx): n for n, p in bs}
        for fu in cf.as_completed(futs):
            try:
                f, k = fu.result()
                print(f"  {futs[fu]}: {k} правок → {f.relative_to(ROOT)}", flush=True)
            except BaseException as e:  # noqa: BLE001 — ask() зовёт sys.exit
                print(f"  {futs[fu]}: ОШИБКА {e}", flush=True)


if __name__ == "__main__":
    main()
