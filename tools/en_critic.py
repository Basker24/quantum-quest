#!/usr/bin/env python3
"""Критик английской версии: отдаёт партию сцен ChatGPT через OpenAI API (канон п. 39.3).

    python3 tools/en_critic.py scenes_en/T-01.md scenes_en/T-02.md ...  [--name партия] [--model M]
    python3 tools/en_critic.py --glossary            # прочитать сам глоссарий и стайлгайд

К каждому английскому файлу из scenes_en/ подкладывается русский оригинал из scenes/ с тем же
именем. Контекст критика: docs/en/glossary.md и docs/en/style_en.md. Ответ сохраняется в
docs/en/review/<дата>_<партия>.md; ниже ответа шоураннер дописывает, что принято и что нет.

Только стандартная библиотека. Ключ — из переменной окружения OPENAI_API_KEY (никогда не печатать).
Модель по умолчанию — самая сильная текстовая из доступных (gpt-5.5-pro), запасная — gpt-5.5.
Дорого: отзыв на глоссарий у pro с effort=high — ≈ 8 тыс. токенов на входе и 45 тыс. на выходе (рассуждения).
Для партий сцен разумно --model gpt-5.5 --effort medium; pro — на пилот целиком.
Запрос фоновый (background: true) с опросом статуса: долгий синхронный ответ обрывает прокси.
"""
import argparse
import datetime
import http.client
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
EN_DOCS = ROOT / "docs" / "en"
REVIEW = EN_DOCS / "review"
MODELS = ["gpt-5.5-pro", "gpt-5.5"]

BRIEF = """You are a demanding English-language literary editor and a native speaker reviewing a translation
(an adaptation, not a crib) of a Russian branching text game, "The One Who Stayed".
First person, present tense, a boy from Kemerovo (the Kuzbass coal region of Siberia) who drowns at
seven in 1996 and keeps living; every age has its own voice, plus short dry italic asides from himself
at 72 in 2061 (paragraphs starting with "> "). Lines starting with "! " are interface notes.
The files use a small markup: YAML-like header, "::if COND ... ::end" conditional blocks, "## Выбор"
(choices; lines "- [A] text" are what the player sees; fx:/if/-> lines are game logic, ignore them),
"## После X" (what happens right after choice X), "## Пробуждение" (waking after a death).
Section headings in Russian are markup, not text: do not comment on them.

The translator's glossary and English style guide are given below. Judge against them, but also tell
when the glossary itself leads to bad English.

Report, per scene, only real problems, most important first:
1. UNIDIOMATIC: phrases no native speaker would write or say; calques from Russian; wrong collocations.
   Quote the phrase, say why, give a better version.
2. REGISTER: where the narrator stops sounding his age (a 7-year-old using adult words, a teenager in 2005
   using post-2008 slang, the old man moralizing), or where dialogue sounds written rather than spoken.
3. REALIA: Russian/Soviet things an English reader won't understand from the sentence itself, or that are
   over-explained (explained twice, or explained where context already does it).
4. AI TICS & RHYTHM: "not X but Y", triads, em-dash cascades, dramatic one-word paragraphs, announced
   emotions, purple last lines, three short sentences in a row.
5. MEANING: places where the English says something different from the Russian original (you get both),
   loses a detail that matters later (objects, numbers 04:12 / 252, scars, the watch), or adds one.
6. TYPOS & GRAMMAR.
Do not rewrite whole scenes. Do not praise. If a scene is fine, say "no issues" for it.
End with a short overall verdict: does the voice work in English, and the 3 most common problems.
Write in English."""

BRIEF_GLOSSARY = """You are a native English literary translator and editor. Below are a glossary and a style guide
(partly in Russian) prepared for adapting a Russian branching text game into English: a boy from the
Kuzbass coal country of Siberia drowns at seven in 1996 and keeps living through parallel deaths; voice
changes with age; dry asides from himself at 72. Review them BEFORE translation starts:
- Which English choices for terms, names, realia and recurring rhymes are wrong, clumsy, misleading or
  carry unwanted associations for an English reader? Propose better ones with reasons.
- Which register rules for ages (7-10 in 1996-99, 11-14, 15-18 in 2004-07, adult, old man) are wrong or
  anachronistic? Give example lines that would sound right.
- What is missing from the English AI-tic stop-list?
- Specific questions: "the Choir" vs "the Chorus"; "the Drift"; "rewind" for откат; "Vodyanoy" as a
  schoolyard nickname vs translating it; "Synchronize watches." as an engraved motto and a grandfather's
  last words; "HEART" vs "EMPATHY" as a stat name; American vs British English for this book.
Be concrete and brief. Write in English."""


def _req(method, url, body=None, timeout=120):
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        sys.exit("нет OPENAI_API_KEY в окружении")
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def call(model, instructions, text, limit=3600, effort="high"):
    """Фоновый запрос (background: true) и опрос статуса: долгий синхронный ответ обрывает прокси."""
    body = {"model": model, "instructions": instructions, "input": text, "background": True,
            "reasoning": {"effort": effort}}
    d = _req("POST", "https://api.openai.com/v1/responses", body)
    rid, t0 = d["id"], time.time()
    while d.get("status") in ("queued", "in_progress"):
        if time.time() - t0 > limit:
            raise TimeoutError(f"{model}: нет ответа за {limit} с")
        time.sleep(15)
        try:
            d = _req("GET", "https://api.openai.com/v1/responses/" + rid)
        except (urllib.error.URLError, http.client.HTTPException, TimeoutError, ConnectionError):
            continue            # сеть мигнула — спросим ещё раз
    if d.get("status") != "completed":
        raise RuntimeError(f"{model}: статус {d.get('status')}: {d.get('error') or d.get('incomplete_details')}")
    out = [c.get("text", "") for o in d.get("output", []) if o.get("type") == "message"
           for c in o.get("content", []) if c.get("type") in ("output_text", "text")]
    return "\n".join(out).strip(), d.get("model", model), d.get("usage", {})


def ask(instructions, text, models, effort="high"):
    last = None
    for m in models:
        for attempt in range(3):
            try:
                return call(m, instructions, text, effort=effort)
            except urllib.error.HTTPError as e:
                msg = e.read().decode(errors="replace")[:300]
                last = f"{m}: HTTP {e.code} {msg}"
                if e.code in (400, 401, 403, 404):
                    break           # модель недоступна или ключ — к следующей модели
            except (urllib.error.URLError, http.client.HTTPException, TimeoutError, ConnectionError, RuntimeError) as e:
                last = f"{m}: {e}"
            time.sleep(5 * (attempt + 1))
        print("  не вышло:", last, file=sys.stderr)
    sys.exit("критик не ответил: " + str(last))


def strip_notes(t):
    return t.split("## 🔒", 1)[0].rstrip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="*")
    ap.add_argument("--name", help="имя партии для файла отзыва")
    ap.add_argument("--model", help="модель (по умолчанию самая сильная)")
    ap.add_argument("--glossary", action="store_true", help="отзыв на глоссарий и стайлгайд")
    ap.add_argument("--effort", default="high", choices=["low", "medium", "high"], help="глубина рассуждений (дешевле — medium)")
    a = ap.parse_args()
    models = [a.model] if a.model else MODELS
    ctx = "\n\n".join(f"===== {p.name} =====\n{p.read_text(encoding='utf-8')}"
                      for p in (EN_DOCS / "glossary.md", EN_DOCS / "style_en.md"))
    if a.glossary:
        instructions, text, name = BRIEF_GLOSSARY, ctx, a.name or "glossary"
        files = ["docs/en/glossary.md", "docs/en/style_en.md"]
    else:
        if not a.files:
            ap.error("нужны файлы scenes_en/*.md или --glossary")
        parts = []
        for f in a.files:
            p = (ROOT / f) if not os.path.isabs(f) else pathlib.Path(f)
            ru = ROOT / "scenes" / p.name
            parts.append(f"########## SCENE FILE {p.name}\n--- RUSSIAN ORIGINAL ---\n"
                         + (strip_notes(ru.read_text(encoding="utf-8")) if ru.exists() else "(none)")
                         + "\n--- ENGLISH ---\n" + strip_notes(p.read_text(encoding="utf-8")))
        instructions = BRIEF + "\n\n" + ctx
        text = "\n\n".join(parts)
        name = a.name or pathlib.Path(a.files[0]).stem
        files = a.files
    t0 = time.time()
    print(f"критик читает {len(files)} файл(ов), {len(text)} знаков…", file=sys.stderr)
    answer, model, usage = ask(instructions, text, models, a.effort)
    REVIEW.mkdir(parents=True, exist_ok=True)
    out = REVIEW / f"{datetime.date.today().isoformat()}_{name}.md"
    n = 2
    while out.exists():
        out = REVIEW / f"{datetime.date.today().isoformat()}_{name}_{n}.md"
        n += 1
    out.write_text(
        f"# Отзыв критика: {name}\n\n"
        f"- Модель: `{model}`; {datetime.datetime.now().strftime('%d.%m.%Y %H:%M')}; "
        f"{int(time.time() - t0)} с; токены: {usage.get('input_tokens', '?')} → {usage.get('output_tokens', '?')}\n"
        f"- Файлы: {', '.join('`' + f + '`' for f in files)}\n\n"
        f"## Замечания критика\n\n{answer}\n\n"
        f"## Ответ шоураннера\n\n_(принято / отклонено и почему — дописывается после правки)_\n",
        encoding="utf-8")
    print(out.relative_to(ROOT))


if __name__ == "__main__":
    main()
