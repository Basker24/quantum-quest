#!/usr/bin/env python3
"""Валидатор Quantum Quest: перебирает ВСЕ достижимые состояния (не интервалы) и проверяет инварианты.

C5  у смертельного исхода нет эффектов (гарантирует парсер)
C6  в стволе и прологе нет смертей героя
I1′ нет тупиков: в каждом состоянии есть несмертельный вариант, или он появится
    после ≤ 1 смерти в этой сцене (эхо-вариант seen_life), или хватит глубины отката
I2  каждое условие хотя бы раз истинно (иначе мёртвая ветка) и хотя бы раз ложно (иначе лишнее)
R   все сцены и смерти достижимы

Пишет отчёт docs/generated/report.md: для каждой сцены — входы, диапазоны всех
переменных и значения флагов на входе (то самое «шапка сцены», только посчитанная).
"""
import sys
from collections import defaultdict

from qqparse import ROOT, QQError, load

G = None
CFG = None


def ev(e, st, seen_life=frozenset(), seen_any=False):
    op = e["op"]
    if op == "num":
        return e["v"]
    if op == "lit":
        return e["v"]
    if op == "var":
        return st.get(e["n"])
    if op == "truthy":
        return bool(st.get(e["n"]))
    if op == "not":
        return not ev(e["a"], st, seen_life, seen_any)
    if op == "and":
        return all(ev(a, st, seen_life, seen_any) for a in e["a"])
    if op == "or":
        return any(ev(a, st, seen_life, seen_any) for a in e["a"])
    if op == "seen":
        return (e["id"] in seen_life) if e["life"] else (seen_any or e["id"] in seen_life)
    if op == "cmp":
        l, r = ev(e["l"], st, seen_life, seen_any), ev(e["r"], st, seen_life, seen_any)
        c = e["c"]
        if c in ("==", "!="):
            return (l == r) == (c == "==")
        l = l or 0
        r = r or 0
        return {">=": l >= r, "<=": l <= r, ">": l > r, "<": l < r}[c]
    raise ValueError(op)


def initial():
    st = {k: v["start"] for k, v in CFG["vars"].items()}
    for k in CFG["flags"]:
        st[k] = None
    return st


def apply(fx, st):
    st = dict(st)
    for kind, name, val in fx:
        if kind == "add":
            v = CFG["vars"][name]
            st[name] = max(v["min"], min(v["max"], st[name] + val))
        else:
            st[name] = val
    return st


def key(st):
    return tuple(sorted(st.items(), key=lambda kv: kv[0]))


def depth(dar):
    d = 1
    for lo, n in CFG["rollback"]:
        if dar >= lo:
            d = n
    return d


def seal(sc):
    return CFG["seal_groups"].get(sc.get("stage", "trunk"), sc.get("stage"))


def main():
    global G, CFG
    try:
        G = load()
    except QQError as e:
        print("ОШИБКА ПАРСИНГА:", e)
        sys.exit(1)
    CFG = G["config"]
    S, D = G["scenes"], G["deaths"]
    errors, warns = [], []
    cond_true, cond_false = defaultdict(bool), defaultdict(bool)
    edges = defaultdict(set)        # node -> set(child nodes) (несмертельные)
    parents = defaultdict(set)
    node_info = {}                  # node -> dict(decision, deaths, echo_rescue)
    reached_scenes, reached_deaths = set(), set()
    entry_states = defaultdict(list)
    entry_from = defaultdict(set)

    start = (CFG["start"], key(initial()))
    stack, seen_nodes = [start], {start}
    while stack:
        node = stack.pop()
        sid, k = node
        st = dict(k)
        sc = S[sid]
        reached_scenes.add(sid)
        entry_states[sid].append(st)
        for b in sc["text"]:
            if "if" in b:
                r = ev(b["if"], st)
                (cond_true if r else cond_false)[(sid, "текст", b["md"][:30])] = True
        children, deaths_here = [], []

        def run(seen_life):
            vis = []
            for c in sc.get("choices", []):
                if "visible" in c:
                    r = ev(c["visible"], st, seen_life)
                    (cond_true if r else cond_false)[(sid, c["id"], "visible: " + c.get("visible_src", ""))] = True
                    if not r:
                        continue
                vis.append(c)
            res = []
            for c in vis:
                for o in c["outcomes"]:
                    if "if" in o:
                        r = ev(o["if"], st, seen_life)
                        (cond_true if r else cond_false)[(sid, c["id"], "if " + o.get("if_src", ""))] = True
                        if not r:
                            continue
                    res.append((c, o))
                    break
            return vis, res

        vis1, res1 = run(frozenset())
        if "next" in sc and not sc.get("choices"):
            nk = sc["next"]
            ch = (nk, key(st))
            children.append(ch)
            entry_from[nk].add(sid)
        dead1 = [o["to"] for c, o in res1 if o["to"] in D]
        vis2, res2 = run(frozenset(dead1)) if dead1 else (vis1, res1)
        for c, o in res2:
            if o["to"] in D:
                deaths_here.append(o["to"])
                reached_deaths.add(o["to"])
                if sc.get("stage") in ("trunk", "prologue"):
                    errors.append(f"C6: смерть {o['to']} в стволе ({sid})")
                continue
            st2 = apply(c["fx"] + o.get("fx", []), st)
            ch = (o["to"], key(st2))
            children.append(ch)
            entry_from[o["to"]].add(sid)
        alive1 = any(o["to"] not in D for c, o in res1) or ("next" in sc and not sc.get("choices"))
        alive2 = any(o["to"] not in D for c, o in res2)
        node_info[node] = {"decision": len(vis1) >= 2, "alive1": alive1, "echo": (not alive1) and alive2,
                           "terminal": not sc.get("choices") and "next" not in sc, "seal": seal(sc)}
        for ch in children:
            edges[node].add(ch)
            parents[ch].add(node)
            if ch not in seen_nodes:
                seen_nodes.add(ch)
                stack.append(ch)

    # doomed: все пути из узла (с учётом эхо) ведут в смерть
    memo = {}

    def doomed(n, path=()):
        if n in memo:
            return memo[n]
        if n in path:
            errors.append(f"цикл в графе через {n[0]}")
            return False
        info = node_info[n]
        if info["terminal"]:
            memo[n] = False
            return False
        r = all(doomed(c, path + (n,)) for c in edges[n]) if edges[n] else True
        memo[n] = r
        return r

    def rescue(n, k, sealg, visited=()):
        """Есть ли на КАЖДОМ обратном пути в пределах k решений не обречённый узел-решение."""
        ps = parents.get(n, set())
        if not ps:
            return False
        for p in ps:
            if p in visited:
                continue
            info = node_info[p]
            if info["seal"] != sealg:
                return False
            if info["decision"]:
                if not doomed(p):
                    continue
                if k - 1 <= 0 or not rescue(p, k - 1, sealg, visited + (p,)):
                    return False
            else:
                if not rescue(p, k, sealg, visited + (p,)):
                    return False
        return True

    bad = 0
    for n, info in node_info.items():
        if not doomed(n):
            continue
        st = dict(n[1])
        if info["echo"]:
            continue
        if not info["alive1"] and not info["echo"] and any(not doomed(c) for c in edges[n]):
            continue
        d = depth(st.get("ДАР", 0))
        if not rescue(n, d - 1, info["seal"]):
            bad += 1
            if bad <= 15:
                pretty = ", ".join(f"{k}={v}" for k, v in sorted(st.items()) if v not in (None, False))
                errors.append(f"I1′: тупик в {n[0]} (глубина отката {d}) при состоянии: {pretty}")
    if bad > 15:
        errors.append(f"I1′: ... и ещё {bad - 15} тупиковых состояний")

    for k in set(cond_true) | set(cond_false):
        if not cond_true[k]:
            errors.append(f"I2: условие никогда не выполняется — {k[0]} [{k[1]}] {k[2]}")
        elif not cond_false[k]:
            warns.append(f"I2: условие всегда истинно — {k[0]} [{k[1]}] {k[2]}")
    for sid in S:
        if sid not in reached_scenes:
            warns.append(f"R: сцена {sid} недостижима")
    for did in D:
        if did not in reached_deaths:
            warns.append(f"R: смерть {did} недостижима")

    # отчёт
    lines = ["# Отчёт валидатора (генерируется, не править руками)", "",
             f"Сцен: {len(S)}, смертей: {len(D)}, состояний: {len(seen_nodes)}", "",
             "## Проблемы", ""]
    lines += [f"- ❌ {e}" for e in errors] or ["- ✅ ошибок нет"]
    lines += [f"- ⚠️ {w}" for w in warns]
    lines += ["", "## Шапки сцен (диапазоны на входе по всем достижимым путям)", ""]
    rank = {"prologue": 0, "trunk": 1, "demo": 2, "branch": 3, "anchor": 4, "final": 5}
    order = sorted(entry_states, key=lambda s: (rank.get(S[s].get("stage"), 9), s))
    for sid in order:
        sts = entry_states[sid]
        sc = S[sid]
        lines.append(f"### {sid}. {sc.get('title', '')}")
        lines.append(f"ВХОДЫ: {', '.join(sorted(entry_from[sid])) or 'старт'} · состояний: {len(sts)}")
        rng = []
        for v in CFG["vars"]:
            vals = [s[v] for s in sts]
            lo, hi = min(vals), max(vals)
            rng.append(f"{v} {lo}" if lo == hi else f"{v} {lo}–{hi}")
        lines.append("ДИАПАЗОНЫ: " + " · ".join(rng))
        fl = []
        for f in CFG["flags"]:
            vals = sorted({str(s[f]) for s in sts if s[f] not in (None, False)})
            if vals:
                none = any(s[f] in (None, False) for s in sts)
                fl.append(f"{f} ∈ {{{', '.join(vals)}{', —' if none else ''}}}")
        lines.append("ФЛАГИ: " + ("; ".join(fl) if fl else "нет"))
        lines.append("")
    out = ROOT / "docs" / "generated" / "report.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"состояний: {len(seen_nodes)}, сцен достигнуто: {len(reached_scenes)}/{len(S)}, смертей: {len(reached_deaths)}/{len(D)}")
    for e in errors:
        print("❌", e)
    for w in warns:
        print("⚠️ ", w)
    print("отчёт:", out.relative_to(ROOT))
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
