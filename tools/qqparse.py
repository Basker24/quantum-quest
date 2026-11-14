"""Парсер исходников сцен Quantum Quest.

Формат сцены (scenes/*.md, файлы на «_» игнорируются):

    ---
    id: Т-01
    title: Чёрная заводь
    date: 28 июля 1996
    age: 7
    stage: trunk            # prologue | trunk | demo | branch | anchor | final
    photo: bw               # bw | color | digital | phone | future
    photo_caption: ...
    photo_prompt: ...
    photo_by: F_В109        # кадр по флагу: img/<ID>~<ЗНАЧЕНИЕ>.jpg, нет файла — img/<ID>.jpg
    photo_by: F_А, F_Б      # по нескольким флагам: img/<ID>~<ЗНАЧ_А>~<ЗНАЧ_Б>.jpg → ~<ЗНАЧ_А> → ~<ЗНАЧ_Б> → <ID>.jpg; bool-флаг даёт значение ДА
    clock: 60               # «время» в острой сцене (канон п. 30): запас секунд, тратят только выборы
    clock_label: до потери сознания    # что значит ноль
    ---
    Абзацы прозы через пустую строку.

    ::if F_Т01 == ЧАСЫ       (условный блок; ::drift COND — помеченное искажение ДРЕЙФа; ::fate COND — тяжёлое последствие выбора)
    текст
    ::end

    ## Выбор
    - [A] Текст варианта
      visible: ДАР >= 25
      cost: 20                (только в сцене с clock: сколько секунд съедает выбор)
      fx: ВОЛ +10, ТЕЛ +5, F_Т01 = СПОР
      if ТЕЛ >= 45 -> В1-08
      if РАЗ >= 40 -> В1-09 ; fx: ДАР +5
      else -> ✝В1-07.A
      -> Т-02                 (безусловный переход)

    ## Далее -> Т-02           (сцена без выбора)

    ## После A                (что случилось сразу после выбора A — до перехода; ::if допускаются)
    текст

    ## 🔒 Заметки             (всё ниже игнорируется движком)

Смерть — файл с id, начинающимся на «✝»; секция «## Пробуждение» — текст после отката.
В шапке смерти: lesson: Азот у пола (карточка «Что я вынес», подпись эха, ≤ 6 слов);
cause: F_ЗАКЛЕИЛ -> В1-07 (ловушка с причиной в прошлом: засечка ленты «здесь началось»).
Условия: && || ! ( ) >= <= > < == !=, числа, имена переменных/флагов, литералы enum,
seen(✝ID) — видел в любой жизни (мета), seen_life(✝ID) — видел в этой жизни,
lived(ID) — сцена ID прожита в одной из ПРОШЛЫХ жизней (мета, «встречи ветвей»).
kinds() — сколько разных стихий (stihia у ✝) в Журнале за все жизни; branches() — в скольких
разных ветвях я жил за все жизни (В1, В2.1, В2.2, В3…В7; общая часть В2 — только если ни в
В2.1, ни в В2.2 не попал). Мета-гейт Ф-04 (канон п. 14): kinds() >= 5 && branches() >= 3.
one_life() — идёт режим «Одна жизнь» (смерть без отката).
Функций случайности в языке нет (канон, п. 1).

«Время» (clock/cost): счётчик живёт в цепочке подряд идущих сцен с clock; первая сцена
цепочки заводит его на свой clock, следующие продолжают остаток, первая сцена без clock
сбрасывает. Вариант с cost больше остатка виден, но закрыт («не успеть»). Остаток хранится
в состоянии героя под служебным ключом CLOCK_KEY, поэтому откат возвращает и его.
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCENES = ROOT / "scenes"
CLOCK_KEY = "_clock"   # служебный ключ остатка секунд в состоянии (движок, свидетели)


class QQError(Exception):
    pass


# ---------------------------------------------------------------- выражения
TOK = re.compile(r"\s*(?:(\d+)|(&&|\|\||>=|<=|==|!=|[<>!()])|(seen_life|seen|lived|kinds|branches|one_life)\s*\(([^)]*)\)|([^\s&|<>=!()]+))")
META_FN = ("kinds", "branches", "one_life")   # функции без аргументов (мета-счётчики и режим)


def tokenize(src):
    pos, out = 0, []
    src = src.strip()
    while pos < len(src):
        m = TOK.match(src, pos)
        if not m or m.end() == pos:
            raise QQError(f"не разобрать выражение: «{src}» с позиции {pos}")
        num, op, fn, arg, name = m.groups()
        if num:
            out.append(("num", int(num)))
        elif op:
            out.append(("op", op))
        elif fn:
            out.append(("fn", fn, arg.strip()))
        else:
            out.append(("name", name))
        pos = m.end()
    return out


def parse_expr(src, cfg):
    toks = tokenize(src)
    i = 0

    def peek():
        return toks[i] if i < len(toks) else None

    def take(kind=None, val=None):
        nonlocal i
        t = peek()
        if t is None or (kind and t[0] != kind) or (val and t[1] != val):
            raise QQError(f"ожидалось {val or kind} в «{src}»")
        i += 1
        return t

    def atom():
        t = peek()
        if t is None:
            raise QQError(f"неожиданный конец «{src}»")
        if t == ("op", "("):
            take()
            e = or_()
            take("op", ")")
            return e
        if t[0] == "num":
            take()
            return {"op": "num", "v": t[1]}
        if t[0] == "fn":
            take()
            if t[1] == "lived":
                if not t[2]:
                    raise QQError(f"lived() без ID сцены в «{src}»")
                return {"op": "lived", "id": t[2]}
            if t[1] in META_FN:
                if t[2]:
                    raise QQError(f"{t[1]}() без аргументов, а не «{t[1]}({t[2]})» в «{src}»")
                return {"op": t[1]}
            return {"op": "seen", "id": t[2], "life": t[1] == "seen_life"}
        if t[0] == "name":
            take()
            n = t[1]
            if n in cfg["vars"] or n in cfg["flags"]:
                return {"op": "var", "n": n}
            if n in ("true", "да"):
                return {"op": "num", "v": 1}
            if n in ("false", "нет"):
                return {"op": "num", "v": 0}
            return {"op": "lit", "v": n}
        raise QQError(f"лишний символ {t[1]} в «{src}»")

    def cmp_():
        left = atom()
        t = peek()
        if t and t[0] == "op" and t[1] in (">=", "<=", ">", "<", "==", "!="):
            take()
            right = atom()
            for x, y in ((left, right), (right, left)):
                if x["op"] == "var" and y["op"] == "lit":
                    f = cfg["flags"].get(x["n"])
                    if f and f.get("type") == "enum" and y["v"] not in f["values"]:
                        raise QQError(f"у {x['n']} нет значения «{y['v']}» (есть: {', '.join(f['values'])}) в «{src}»")
            return {"op": "cmp", "c": t[1], "l": left, "r": right}
        if left["op"] == "lit":
            raise QQError(f"неизвестное имя «{left['v']}» в «{src}» (объяви его в _config.json)")
        if left["op"] == "var":
            return {"op": "truthy", "n": left["n"]}
        return left

    def not_():
        if peek() == ("op", "!"):
            take()
            return {"op": "not", "a": not_()}
        return cmp_()

    def and_():
        parts = [not_()]
        while peek() == ("op", "&&"):
            take()
            parts.append(not_())
        return parts[0] if len(parts) == 1 else {"op": "and", "a": parts}

    def or_():
        parts = [and_()]
        while peek() == ("op", "||"):
            take()
            parts.append(and_())
        return parts[0] if len(parts) == 1 else {"op": "or", "a": parts}

    e = or_()
    if i != len(toks):
        raise QQError(f"лишнее в конце «{src}»")
    return e


def parse_fx(src, cfg):
    fx = []
    for part in [p.strip() for p in src.split(",") if p.strip()]:
        m = re.fullmatch(r"(\S+)\s*([+-])\s*(\d+)", part)
        if m:
            name, sign, n = m.groups()
            if name not in cfg["vars"]:
                raise QQError(f"fx: «{name}» не переменная")
            fx.append(["add", name, int(n) * (1 if sign == "+" else -1)])
            continue
        m = re.fullmatch(r"(\S+)\s*<=\s*(\d+)", part)       # потолок: ТЕЛ <= 45 (старение)
        if m:
            name, n = m.groups()
            if name not in cfg["vars"]:
                raise QQError(f"fx: «{name}» не переменная")
            fx.append(["cap", name, int(n)])
            continue
        m = re.fullmatch(r"(\S+)\s*=\s*(\S+)", part)
        if m:
            name, val = m.groups()
            if name in cfg["vars"]:
                fx.append(["set", name, int(val)])
                continue
            if name not in cfg["flags"]:
                raise QQError(f"fx: «{name}» не объявлен")
            f = cfg["flags"][name]
            if f["type"] == "enum":
                if val not in f["values"]:
                    raise QQError(f"fx: {name} не может быть «{val}»")
                fx.append(["set", name, val])
            elif f["type"] == "bool":
                fx.append(["set", name, val in ("true", "да", "1")])
            else:
                fx.append(["set", name, int(val)])
            continue
        if part in cfg["flags"] and cfg["flags"][part]["type"] == "bool":
            fx.append(["set", part, True])
            continue
        raise QQError(f"fx: не понял «{part}»")
    return fx


# ---------------------------------------------------------------- сцены
def split_front(text, path):
    if not text.startswith("---"):
        raise QQError(f"{path.name}: нет шапки ---")
    _, head, body = text.split("---", 2)
    meta = {}
    for line in head.strip().splitlines():
        if line.strip() and not line.strip().startswith("#"):
            k, _, v = line.partition(":")
            meta[k.strip()] = v.strip()
    return meta, body


def parse_blocks(body, cfg):
    blocks, cur, cond = [], [], None

    def flush():
        txt = "\n".join(cur).strip()
        for para in re.split(r"\n\s*\n", txt):
            para = para.strip()
            if para:
                b = {"md": para}
                if para.startswith("> "):      # ремарка старика из 2061
                    b = {"md": para[2:].replace("\n> ", "\n"), "kind": "old"}
                elif para.startswith("! "):    # служебная плашка
                    b = {"md": para[2:], "kind": "sys"}
                if cond:
                    b.update(cond)
                blocks.append(b)
        cur.clear()

    for line in body.splitlines():
        s = line.strip()
        if "::" in s and not s.startswith("::") and re.search(r"::(if|drift|fate|body|end|chorus|norewind)\b", s):
            raise QQError(f"директива не в начале строки: «{s[:60]}…»")
        if s.startswith("::end") and s != "::end":
            raise QQError(f"текст после ::end в той же строке: «{s[:60]}»")
        if s.startswith(("::if ", "::drift ", "::fate ", "::body ")):
            if cond is not None:
                raise QQError(f"вложенный ::if не поддерживается: «{s[:60]}» (объедини условия через &&)")
            flush()
            kind, expr = s[2:].split(" ", 1)
            cond = {"if": parse_expr(expr, cfg)}
            if kind == "drift":
                cond["drift"] = True
            elif kind == "body":  # тело помнит смерть этой жизни: метка «◌ тело помнит»
                cond["body"] = True
            elif kind == "fate":  # тяжёлое последствие прошлого выбора: метка «в другом мире всё было не так»
                cond["fate"] = True
        elif s == "::end":
            flush()
            cond = None
        elif s in ("::chorus", "::norewind"):
            # ::chorus — голоса Рыбаков из Журнала смертей игрока; ::norewind — лента, которой нет (Ф2)
            flush()
            b = {"md": "", "kind": s[2:]}
            if cond:
                b.update(cond)
            blocks.append(b)
        else:
            cur.append(line)
    flush()
    return blocks


def parse_choices(section, cfg, sid):
    choices, ch = [], None
    for raw in section.splitlines():
        if not raw.strip():
            continue
        m = re.match(r"-\s*\[(\w+)\]\s*(.+)", raw.strip())
        if m and not raw.startswith((" ", "\t")):
            ch = {"id": m.group(1), "label": m.group(2).strip(), "fx": [], "outcomes": []}
            choices.append(ch)
            continue
        if ch is None:
            raise QQError(f"{sid}: строка вне варианта: {raw}")
        s = raw.strip()
        if s.startswith("visible:"):
            ch["visible"] = parse_expr(s[8:], cfg)
            ch["visible_src"] = s[8:].strip()
        elif s.startswith("fx:"):
            ch["fx"] += parse_fx(s[3:], cfg)
        elif s.startswith("cost:"):
            m = re.fullmatch(r"cost:\s*(\d+)", s)
            if not m:
                raise QQError(f"{sid}/{ch['id']}: «cost: N» — число секунд")
            ch["cost"] = int(m.group(1))
        elif s.startswith("tags:"):
            ch["tags"] = [t.strip() for t in s[5:].split(",")]
        else:
            m = re.fullmatch(r"(?:(if)\s+(.+?)|(else))?\s*->\s*(\S+)(?:\s*;\s*fx:\s*(.+))?", s)
            if not m:
                raise QQError(f"{sid}/{ch['id']}: не понял «{s}»")
            _, cond, _, to, ofx = m.groups()
            o = {"to": to}
            if cond:
                o["if"] = parse_expr(cond, cfg)
                o["if_src"] = cond.strip()
            if ofx:
                if to.startswith("✝"):
                    raise QQError(f"{sid}/{ch['id']}: смертельный исход не может менять переменные (канон п. 5)")
                o["fx"] = parse_fx(ofx, cfg)
            ch["outcomes"].append(o)
    for c in choices:
        if not c["outcomes"]:
            raise QQError(f"{sid}/{c['id']}: нет переходов")
        if "if" in c["outcomes"][-1]:
            raise QQError(f"{sid}/{c['id']}: последний переход должен быть без условия (else или ->)")
    return choices


def parse_file(path, cfg):
    meta, body = split_front(path.read_text(encoding="utf-8"), path)
    sid = meta.get("id")
    if not sid:
        raise QQError(f"{path.name}: нет id")
    body = re.split(r"^##\s*🔒.*$", body, flags=re.M)[0]
    parts = re.split(r"^##\s*(Выбор|Пробуждение|Далее.*|После\s+\w+)\s*$", body, flags=re.M)
    text = parts[0]
    item = {k: v for k, v in meta.items()}
    if "age" in item:
        item["age"] = int(item["age"])
    if "clock" in item:
        if not re.fullmatch(r"\d+", item["clock"]):
            raise QQError(f"{sid}: «clock: N» — число секунд")
        item["clock"] = int(item["clock"])
        if not item.get("clock_label"):
            raise QQError(f"{sid}: у clock нужен clock_label (что значит ноль)")
    # смерть: lesson — карточка «Что я вынес» (≤ 6 слов); cause — ловушка с причиной в прошлом:
    # «cause: УСЛОВИЕ -> ID» — при условии засечка ID на ленте отката помечена «здесь началось»
    if "lesson" in item and len(item["lesson"].split()) > 6:
        raise QQError(f"{sid}: lesson длиннее 6 слов")
    if "cause" in item:
        m = re.fullmatch(r"(.+?)\s*->\s*(\S+)", item["cause"])
        if not m:
            raise QQError(f"{sid}: «cause: УСЛОВИЕ -> ID»")
        item["cause"] = {"if": parse_expr(m.group(1), cfg), "if_src": m.group(1).strip(), "scene": m.group(2)}
    item["text"] = parse_blocks(text, cfg)
    item["file"] = path.name
    for head, content in zip(parts[1::2], parts[2::2]):
        if head == "Выбор":
            item["choices"] = parse_choices(content, cfg, sid)
        elif head == "Пробуждение":
            item["awake"] = parse_blocks(content, cfg)
        elif head.startswith("Далее"):
            m = re.search(r"->\s*(\S+)", head)
            if not m:
                raise QQError(f"{sid}: «## Далее -> ID»")
            item["next"] = m.group(1)
        elif head.startswith("После"):
            # что случилось сразу после выбора — показывается до перехода в следующую сцену
            cid = head.split()[1]
            item.setdefault("after", {})[cid] = parse_blocks(content, cfg)
    for c in item.get("choices", []):
        if "cost" in c and "clock" not in item:
            raise QQError(f"{sid}/{c['id']}: cost без clock в шапке сцены")
    for cid in item.get("after", {}):
        if cid not in {c["id"] for c in item.get("choices", [])}:
            raise QQError(f"{sid}: «## После {cid}», а варианта [{cid}] нет")
    return sid, item


def lived_ids(x, acc):
    """Все ID из lived(ID) в сцене/условии."""
    if isinstance(x, dict):
        if x.get("op") == "lived":
            acc.add(x["id"])
        for v in x.values():
            lived_ids(v, acc)
    elif isinstance(x, list):
        for v in x:
            lived_ids(v, acc)
    return acc


def has_meta(e):
    """Условие зависит от мета-слоя (Журнал, прошлые жизни, режим): seen без _life, lived, kinds, branches, one_life."""
    if isinstance(e, dict):
        if e.get("op") in ("lived",) + META_FN or (e.get("op") == "seen" and not e.get("life")):
            return True
        return any(has_meta(v) for v in e.values())
    if isinstance(e, list):
        return any(has_meta(v) for v in e)
    return False


def load():
    cfg = json.loads((SCENES / "_config.json").read_text(encoding="utf-8"))
    for m in cfg.get("meta_entries", []):
        m["if"] = parse_expr(m["cond"], cfg)
    scenes, deaths = {}, {}
    for p in sorted(SCENES.glob("*.md")):
        if p.name.startswith("_") or p.name.startswith("._"):
            continue  # "_*" — служебные; "._*" — мусор AppleDouble с exFAT-диска
        sid, item = parse_file(p, cfg)
        target = deaths if sid.startswith("✝") else scenes
        if sid in target:
            raise QQError(f"дубликат id {sid}")
        target[sid] = item
    # ссылки
    for sid, sc in scenes.items():
        targets = [sc["next"]] if "next" in sc else []
        for c in sc.get("choices", []):
            targets += [o["to"] for o in c["outcomes"]]
        for t in targets:
            if t not in scenes and t not in deaths:
                raise QQError(f"{sid}: ссылка на несуществующую сцену {t}")
    for sid, sc in scenes.items():
        pb = sc.get("photo_by")
        for f in ([x.strip() for x in str(pb).split(",") if x.strip()] if pb else []):
            if f not in cfg["flags"]:
                raise QQError(f"{sid}: photo_by: {f} — нет такого флага в _config.json")
    for did, d in deaths.items():
        if "cause" in d and d["cause"]["scene"] not in scenes:
            raise QQError(f"{did}: cause ссылается на несуществующую сцену {d['cause']['scene']}")
    # lived(ID) — только существующие сцены (смерти — через seen); достижимость проверяет validate
    for sid, sc in list(scenes.items()) + list(deaths.items()):
        for lid in lived_ids(sc, set()):
            if lid not in scenes:
                raise QQError(f"{sid}: lived({lid}) — нет такой сцены")
    if cfg["start"] not in scenes:
        raise QQError("стартовой сцены нет")
    return {"config": cfg, "scenes": scenes, "deaths": deaths}
