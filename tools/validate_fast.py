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
тупик проверка не пропустит. Откат на несколько шагов здесь не учитывается: по правилу
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
        return {"num": {}, "fl": {}}

    def merge(dst, src):
        for n, (lo, hi) in src["num"].items():
            if n in dst["num"]:
                a, b = dst["num"][n]
                dst["num"][n] = (min(a, lo), max(b, hi))
            else:
                dst["num"][n] = (lo, hi)
        for f, vs in src["fl"].items():
            dst["fl"].setdefault(f, set()).update(vs)

    def apply_fx(st, fx):
        out = {"num": dict(st["num"]), "fl": {k: set(v) for k, v in st["fl"].items()}}
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

    def possible(st, e, seen=frozenset()):
        used = sorted(n for n in names(e, set()) if n in CFG["vars"] or n in CFG["flags"])
        t = f = False
        for env in combos(st, used):
            r = ev(e, env, seen)
            t, f = t or r, f or not r
            if t and f:
                break
        return t, f

    def refine(st, e, truth):
        """Сужение по простым условиям: num-cmp, enum ==/!=, truthy, И (для «да»)."""
        out = {"num": dict(st["num"]), "fl": {k: set(v) for k, v in st["fl"].items()}}
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
                k = (sid, "текст", b["md"][:32])
                if t:
                    cond_true.add(k)
                if f:
                    cond_false.add(k)
        targets = []
        if "next" in sc and not sc.get("choices"):
            targets.append((sc["next"], st, []))
        for c in sc.get("choices", []):
            cs = st
            if "visible" in c:
                t, f = possible(st, c["visible"], frozenset(D))   # эхо: могло быть видно после смерти
                t0, f0 = possible(st, c["visible"])
                k = (sid, c["id"], "visible: " + c.get("visible_src", ""))
                if t:
                    cond_true.add(k)
                if f0:
                    cond_false.add(k)
                if not t:
                    continue
                if not ("seen" in str(c["visible"])):
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
                targets.append((o["to"], cur, c["fx"] + o.get("fx", [])))
        for to, cur, fx in targets:
            entry_from[to].add(sid)
            merge(STATE.setdefault(to, new_state()), apply_fx(cur, fx))

        # --- I1 локально
        if any(o["to"] in D for c in sc.get("choices", []) for o in c["outcomes"]):
            exprs = [c.get("visible") for c in sc["choices"]] + [o.get("if") for c in sc["choices"] for o in c["outcomes"]]
            used = sorted({n for e in exprs if e for n in names(e, set())})
            bad = 0
            for env in combos(st, used):
                def alive(seen):
                    dead = set()
                    for c in sc["choices"]:
                        if "visible" in c and not ev(c["visible"], env, seen):
                            continue
                        for o in c["outcomes"]:
                            if "if" in o and not ev(o["if"], env, seen):
                                continue
                            if o["to"] not in D:
                                return True, dead
                            dead.add(o["to"])
                            break
                    return False, dead
                ok, dead = alive(frozenset())
                if not ok and dead:
                    ok, _ = alive(frozenset(dead))
                if not ok:
                    bad += 1
                    if bad <= 5:
                        errors.append(f"I1: возможный тупик в {sid} при " + ", ".join(f"{k}={v}" for k, v in env.items()))
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
