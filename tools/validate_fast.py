#!/usr/bin/env python3
"""Быстрая проверка Quantum Quest (интервальная). Включается сама, когда точный перебор
становится слишком большим, или вручную: python3 tools/validate_fast.py

Как работает:
- для каждой сцены копит диапазоны чисел и множества значений флагов по всем путям
  (с уточнением по простым условиям: «ТЕЛ >= 45» сужает диапазон в ветке «да»);
- I2: условие «никогда не выполняется» — если его не выполняет ни одна комбинация
  значений участвующих переменных из диапазонов сцены;
- I1 (локально): в каждой сцене со смертельными исходами перебираются ВСЕ комбинации
  значений переменных, которые эта сцена проверяет. Если при какой-то комбинации нет
  несмертельного варианта (даже с эхо-вариантом после смерти), это тупик.

Это перестраховка: комбинация может оказаться недостижимой (лишняя тревога), но настоящий
тупик проверка не пропустит. I1 требует живого пути после ЛЮБОЙ одной смерти в сцене
(эхо по смыслу: каждая смерть должна что-то открывать). Мета-эхо seen(✝…) из прошлых
жизней в I1 не считается: Журнал может быть пустым.

«Время» (clock/cost): для каждой сцены копится множество возможных остатков секунд на входе;
вариант с cost больше остатка закрыт («не успеть») и в I1 не считается. Откат на несколько шагов здесь не учитывается: по правилу
библии 10.4 в каждой ловушке должен быть безопасный дорогой выход.
"""
import sys
from collections import defaultdict
from itertools import product

from qqparse import ROOT, QQError, load
from validate import ev, names, successors


def main(note=""):
    try:
        G = load()
    except QQError as e:
        print("ОШИБКА ПАРСИНГА:", e)
        return 1
    CFG = G["config"]
    S, D = G["scenes"], G["deaths"]
    NUM, FL = list(CFG["vars"]), list(CFG["flags"])
    errors, warns = [], []
    cond_true, cond_false = set(), set()

    def clampv(n, v):
        c = CFG["vars"][n]
        return max(c["min"], min(c["max"], v))

    # --- топологический порядок
    indeg = {s: 0 for s in S}
    for s, sc in S.items():
        for t in set(successors(sc)):
            if t in S:
                indeg[t] += 1
    order, q = [], [s for s in S if indeg[s] == 0]
    while q:
        s = q.pop()
        order.append(s)
        for t in set(successors(S[s])):
            if t in S:
                indeg[t] -= 1
                if indeg[t] == 0:
                    q.append(t)

    def new_state():
        return {"num": {}, "fl": {}, "clk": set()}

    def clk_in(to, vals):
        """Остатки секунд на входе в сцену: цепочка сцен с clock продолжает счёт, без clock — сброс."""
        c = S[to].get("clock")
        if c is None:
            return {None}
        return {c if v is None else v for v in vals}

    def merge(dst, src):
        for n, (lo, hi) in src["num"].items():
            if n in dst["num"]:
                a, b = dst["num"][n]
                dst["num"][n] = (min(a, lo), max(b, hi))
            else:
                dst["num"][n] = (lo, hi)
        for f, vs in src["fl"].items():
            dst["fl"].setdefault(f, set()).update(vs)
        dst["clk"] |= src.get("clk", set())

    def apply_fx(st, fx):
        out = {"num": dict(st["num"]), "fl": {k: set(v) for k, v in st["fl"].items()}, "clk": set(st.get("clk", ()))}
        for kind, n, v in fx:
            if n in CFG["vars"]:
                lo, hi = out["num"][n]
                out["num"][n] = ((clampv(n, lo + v), clampv(n, hi + v)) if kind == "add"
                                 else (min(lo, v), min(hi, v)) if kind == "cap" else (v, v))
            else:
                out["fl"][n] = {v}
        return out

    def values(st, n):
        if n in CFG["vars"]:
            lo, hi = st["num"][n]
            return list(range(lo, hi + 1, 5)) or [lo]
        return sorted(st["fl"][n], key=str)

    def combos(st, used, cap=200000):
        lists = [values(st, n) for n in used]
        size = 1
        for l in lists:
            size *= max(1, len(l))
        if size > cap:
            warns.append(f"комбинаций слишком много ({size}) для {used} — проверены не все")
        for c in product(*lists):
            yield dict(zip(used, c))

    def possible(st, e, seen=frozenset(), meta=None):
        used = sorted(n for n in names(e, set()) if n in CFG["vars"] or n in CFG["flags"])
        t = f = False
        for env in combos(st, used):
            r = ev(e, env, seen, meta)
            t, f = t or r, f or not r
            if t and f:
                break
        return t, f

    def refine(st, e, truth):
        """Сужение по простым условиям: num-cmp, enum ==/!=, truthy, И (для «да»)."""
        out = {"num": dict(st["num"]), "fl": {k: set(v) for k, v in st["fl"].items()}, "clk": set(st.get("clk", ()))}
        def one(c):
            if c.get("op") == "and" and truth:
                for a in c["a"]:
                    one(a)
                return
            if c.get("op") == "cmp" and c["l"].get("op") == "var":
                n, r, op = c["l"]["n"], c["r"], c["c"]
                if n in CFG["vars"] and r.get("op") == "num":
                    lo, hi = out["num"][n]
                    v = r["v"]
                    if not truth:
                        op = {">=": "<", "<": ">=", "<=": ">", ">": "<=", "==": "!=", "!=": "=="}[op]
                    if op == ">=":
                        lo = max(lo, v)
                    elif op == ">":
                        lo = max(lo, v + 5)
                    elif op == "<=":
                        hi = min(hi, v)
                    elif op == "<":
                        hi = min(hi, v - 5)
                    if lo <= hi:
                        out["num"][n] = (lo, hi)
                elif n in CFG["flags"] and r.get("op") == "lit":
                    vs = out["fl"][n]
                    keep = {x for x in vs if (x == r["v"]) == ((op == "==") == truth)}
                    if keep:
                        out["fl"][n] = keep
        one(e)
        return out

    st0 = new_state()
    for n in NUM:
        st0["num"][n] = (CFG["vars"][n]["start"],) * 2
    for f in FL:
        st0["fl"][f] = {None}
    st0["clk"] = clk_in(CFG["start"], {None})
    STATE = {CFG["start"]: st0}
    entry_from = defaultdict(set)
    reached_deaths = set()

    for sid in order:
        if sid not in STATE:
            continue
        st, sc = STATE[sid], S[sid]
        for b in sc["text"]:
            if "if" in b:
                t, f = possible(st, b["if"])
                if "seen" in str(b["if"]):        # смерть могла быть, а могла и не быть
                    t2, f2 = possible(st, b["if"], frozenset(D))
                    t, f = t or t2, f or f2
                if "lived" in str(b["if"]):       # прожито в прошлой жизни — может быть и так, и так
                    t2, f2 = possible(st, b["if"], frozenset(), frozenset(D))
                    t, f = t or t2, f or f2
                k = (sid, "текст", b["md"][:32])
                if t:
                    cond_true.add(k)
                if f:
                    cond_false.add(k)
        targets = []
        clock = sc.get("clock")
        clks = st["clk"] or {None}
        if "next" in sc and not sc.get("choices"):
            targets.append((sc["next"], st, [], clks))
        for c in sc.get("choices", []):
            cs = st
            cost = c.get("cost", 0)
            fit = {v for v in clks if v is None or v >= cost}
            if clock is not None and not fit:
                warns.append(f"T: {sid} [{c['id']}] не успеть никогда (cost {cost} > остатка {max(v for v in clks if v is not None)})")
                continue
            nclk = {v - cost for v in fit} if clock is not None else {None}
            if "visible" in c:
                t, f = possible(st, c["visible"], frozenset(D))   # эхо: могло быть видно после смерти
                if "lived" in str(c["visible"]):
                    t = t or possible(st, c["visible"], frozenset(), frozenset(D))[0]
                t0, f0 = possible(st, c["visible"])
                k = (sid, c["id"], "visible: " + c.get("visible_src", ""))
                if t:
                    cond_true.add(k)
                if f0:
                    cond_false.add(k)
                if not t:
                    continue
                if not ("seen" in str(c["visible"]) or "lived" in str(c["visible"])):
                    cs = refine(st, c["visible"], True)
            rem = cs
            for o in c["outcomes"]:
                if rem is None:
                    break
                cur = rem
                if "if" in o:
                    t, f = possible(rem, o["if"])
                    k = (sid, c["id"], "if " + o.get("if_src", ""))
                    if t:
                        cond_true.add(k)
                    if f:
                        cond_false.add(k)
                    if not t:
                        continue
                    cur = refine(rem, o["if"], True)
                    rem = refine(rem, o["if"], False) if f else None
                else:
                    rem = None
                if o["to"] in D:
                    reached_deaths.add(o["to"])
                    if sc.get("stage") in ("trunk", "prologue"):
                        errors.append(f"C6: смерть {o['to']} в стволе ({sid})")
                    continue
                targets.append((o["to"], cur, c["fx"] + o.get("fx", []), nclk))
        for to, cur, fx, ck in targets:
            entry_from[to].add(sid)
            nxt = apply_fx(cur, fx)
            nxt["clk"] = clk_in(to, ck)
            merge(STATE.setdefault(to, new_state()), nxt)

        # --- I1 локально
        if any(o["to"] in D for c in sc.get("choices", []) for o in c["outcomes"]):
            exprs = [c.get("visible") for c in sc["choices"]] + [o.get("if") for c in sc["choices"] for o in c["outcomes"]]
            used = sorted({n for e in exprs if e for n in names(e, set())})
            bad = 0
            NOMETA = frozenset()      # мета-эхо (seen без _life) на I1 не опираем
            for left, env in ((v, e) for v in sorted(clks, key=lambda x: -1 if x is None else x) for e in combos(st, used)):
                def alive(seen):
                    dead = []
                    for c in sc["choices"]:
                        if left is not None and c.get("cost", 0) > left:
                            continue          # не успеть
                        if "visible" in c and not ev(c["visible"], env, seen, NOMETA):
                            continue
                        for o in c["outcomes"]:
                            if "if" in o and not ev(o["if"], env, seen, NOMETA):
                                continue
                            if o["to"] not in D:
                                return True, dead
                            if o["to"] not in dead:
                                dead.append(o["to"])
                            break
                    return False, dead
                ok, dead = alive(frozenset())
                why = ""
                if not ok and dead:
                    # после ЛЮБОЙ одной смерти этой сцены должен открыться живой путь
                    lost = [d for d in dead if not alive(frozenset([d]))[0]]
                    ok = not lost
                    why = f" (после смерти {', '.join(lost)} живого пути нет)" if lost else ""
                if not ok:
                    bad += 1
                    if bad <= 5:
                        tail = ", ".join(f"{k}={v}" for k, v in env.items())
                        if left is not None:
                            tail += f", осталось {left} с"
                        errors.append(f"I1: возможный тупик в {sid} при {tail}{why}")
            if bad > 5:
                errors.append(f"I1: … в {sid} ещё {bad - 5} таких комбинаций")

    for k in cond_true | cond_false:
        if k not in cond_true:
            errors.append(f"I2: условие никогда не выполняется — {k[0]} [{k[1]}] {k[2]}")
    for sid in S:
        if sid not in STATE:
            warns.append(f"R: сцена {sid} недостижима")
    for did in D:
        if did not in reached_deaths:
            warns.append(f"R: смерть {did} недостижима")

    rank = {"prologue": 0, "trunk": 1, "demo": 2, "branch": 3, "anchor": 4, "final": 5}
    L = ["# Отчёт валидатора (генерируется, не править руками)", "",
         "**Режим: быстрая интервальная проверка.** " + (note or ""), "",
         "Диапазоны ниже — по всем путям, с небольшим запасом (переменные считаются независимо).", "",
         "## Проблемы", ""]
    L += [f"- ❌ {e}" for e in errors] or ["- ✅ ошибок нет"]
    L += [f"- ⚠️ {w}" for w in warns]
    L += ["", "## Шапки сцен", ""]
    for sid in sorted(STATE, key=lambda s: (rank.get(S[s].get("stage"), 9), s)):
        st = STATE[sid]
        L.append(f"### {sid}. {S[sid].get('title', '')}")
        L.append(f"ВХОДЫ: {', '.join(sorted(entry_from[sid])) or 'старт'}")
        L.append("ДИАПАЗОНЫ: " + " · ".join(f"{n} {lo}" if lo == hi else f"{n} {lo}–{hi}" for n, (lo, hi) in st["num"].items()))
        fl = []
        for f, vs in st["fl"].items():
            real = sorted(str(v) for v in vs if v not in (None, False))
            if real:
                fl.append(f"{f} ∈ {{{', '.join(real)}{', —' if (None in vs or False in vs) else ''}}}")
        L.append("ФЛАГИ: " + ("; ".join(fl) if fl else "нет"))
        L.append("")
    out = ROOT / "docs" / "generated" / "report.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(L) + "\n", encoding="utf-8")
    print(f"быстрая проверка: сцен {len(STATE)}/{len(S)}, смертей {len(reached_deaths)}/{len(D)}")
    for e in errors:
        print("❌", e)
    for w in warns:
        print("⚠️ ", w)
    print("отчёт:", out.relative_to(ROOT))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
