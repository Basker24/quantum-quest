#!/usr/bin/env python3
"""Валидатор Quantum Quest: перебирает ВСЕ достижимые состояния и проверяет инварианты.

C5  у смертельного исхода нет эффектов (гарантирует парсер)
C6  в стволе и прологе нет смертей героя
I1′ нет тупиков: в каждом состоянии есть несмертельный вариант, или он появится
    после ≤ 1 смерти в этой сцене (эхо-вариант seen_life), или хватит глубины отката
I2  каждое условие хотя бы раз истинно и хотя бы раз ложно
R   все сцены и смерти достижимы

Комбинаторику держит анализ живости (как удаление мёртвых переменных в компиляторе):
состояние в сцене X точно хранит только те переменные и флаги, которые ещё могут быть
прочитаны в X или после неё (плюс ДАР — от него зависит откат). Остальные не влияют
на ход игры, поэтому для них копятся точные min/max и множества значений.

Пишет docs/generated/report.md: шапки всех сцен (входы, диапазоны, флаги) и Mermaid-схему.
"""
import sys
from collections import defaultdict

from qqparse import ROOT, QQError, load

G = CFG = None


def ev(e, st, seen_life=frozenset()):
    op = e["op"]
    if op in ("num", "lit"):
        return e["v"]
    if op == "var":
        return st.get(e["n"])
    if op == "truthy":
        return bool(st.get(e["n"]))
    if op == "not":
        return not ev(e["a"], st, seen_life)
    if op == "and":
        return all(ev(a, st, seen_life) for a in e["a"])
    if op == "or":
        return any(ev(a, st, seen_life) for a in e["a"])
    if op == "seen":
        return e["id"] in seen_life
    if op == "cmp":
        l, r = ev(e["l"], st, seen_life), ev(e["r"], st, seen_life)
        c = e["c"]
        if c in ("==", "!="):
            return (l == r) == (c == "==")
        l, r = l or 0, r or 0
        return {">=": l >= r, "<=": l <= r, ">": l > r, "<": l < r}[c]
    raise ValueError(op)


def names(e, acc):
    if isinstance(e, dict):
        if e.get("op") in ("var", "truthy"):
            acc.add(e["n"])
        for v in e.values():
            names(v, acc)
    elif isinstance(e, list):
        for v in e:
            names(v, acc)
    return acc


def depth(dar):
    d = 1
    for lo, n in CFG["rollback"]:
        if dar >= lo:
            d = n
    return d


def seal(sc):
    return CFG["seal_groups"].get(sc.get("stage", "trunk"), sc.get("stage"))


def successors(sc):
    out = [sc["next"]] if "next" in sc else []
    for c in sc.get("choices", []):
        out += [o["to"] for o in c["outcomes"]]
    return out


def main():
    global G, CFG
    try:
        G = load()
    except QQError as e:
        print("ОШИБКА ПАРСИНГА:", e)
        sys.exit(1)
    CFG = G["config"]
    S, D = G["scenes"], G["deaths"]
    ALL = list(CFG["vars"]) + list(CFG["flags"])
    errors, warns = [], []

    # --- живость: что читается в условиях ПЕРЕХОДОВ в сцене или после неё.
    # Условия абзацев текста на ход игры не влияют — их проверяем в конце по накопленным значениям.
    reads = {sid: names([c.get("visible") for c in sc.get("choices", [])]
                        + [o.get("if") for c in sc.get("choices", []) for o in c["outcomes"]], set())
             for sid, sc in S.items()}
    live = {sid: set(r) | {"ДАР"} for sid, r in reads.items()}
    changed = True
    while changed:
        changed = False
        for sid, sc in S.items():
            for t in successors(sc):
                if t in S and not live[t] <= live[sid]:
                    live[sid] |= live[t]
                    changed = True
    live_order = {sid: tuple(n for n in ALL if n in live[sid]) for sid in S}

    def init():
        st = {k: v["start"] for k, v in CFG["vars"].items()}
        st.update({k: None for k in CFG["flags"]})
        return st

    def clampv(n, v):
        c = CFG["vars"][n]
        return max(c["min"], min(c["max"], v))

    # aux: {name: (lo, hi)} для чисел, {name: frozenset} для флагов
    def split(sid, st):
        keyv = tuple(st[n] for n in live_order[sid])
        aux = {}
        for n in ALL:
            if n in live[sid]:
                continue
            v = st[n]
            aux[n] = (v, v) if n in CFG["vars"] else frozenset([v])
        return keyv, aux

    def fx_aux(aux, fx):
        aux = dict(aux)
        for kind, n, v in fx:
            if n not in aux:
                continue
            if n in CFG["vars"]:
                lo, hi = aux[n]
                aux[n] = (clampv(n, lo + v), clampv(n, hi + v)) if kind == "add" else (v, v)
            else:
                aux[n] = frozenset([v])
        return aux

    def merge(a, b):
        out, grew = {}, False
        for n in set(a) | set(b):
            if n not in a:
                out[n] = b[n]; grew = True
            elif n not in b:
                out[n] = a[n]
            elif n in CFG["vars"]:
                lo, hi = min(a[n][0], b[n][0]), max(a[n][1], b[n][1])
                out[n] = (lo, hi)
                grew |= (lo, hi) != a[n]
            else:
                out[n] = a[n] | b[n]
                grew |= out[n] != a[n]
        return out, grew

    cond_true, cond_false = set(), set()
    AUX = {}                       # node -> aux
    EDGES = {}                     # node -> [(child, fx)] — только несмертельные
    parents = defaultdict(set)
    info = {}
    reached_deaths = set()
    entry_from = defaultdict(set)

    st0 = init()
    k0, a0 = split(CFG["start"], st0)
    start = (CFG["start"], k0)
    AUX[start] = a0
    work = [start]
    while work:
        node = work.pop()
        sid, keyv = node
        sc = S[sid]
        if node not in EDGES:
            st = dict(zip(live_order[sid], keyv))

            def run(seen_life):
                vis, res = [], []
                for c in sc.get("choices", []):
                    if "visible" in c:
                        r = ev(c["visible"], st, seen_life)
                        (cond_true if r else cond_false).add((sid, c["id"], "visible: " + c.get("visible_src", "")))
                        if not r:
                            continue
                    vis.append(c)
                for c in vis:
                    for o in c["outcomes"]:
                        if "if" in o:
                            r = ev(o["if"], st, seen_life)
                            (cond_true if r else cond_false).add((sid, c["id"], "if " + o.get("if_src", "")))
                            if not r:
                                continue
                        res.append((c, o))
                        break
                return vis, res

            vis1, res1 = run(frozenset())
            dead1 = frozenset(o["to"] for c, o in res1 if o["to"] in D)
            vis2, res2 = run(dead1) if dead1 else (vis1, res1)
            out = []
            if "next" in sc and not sc.get("choices"):
                out.append((sc["next"], []))
            for c, o in res2:
                if o["to"] in D:
                    reached_deaths.add(o["to"])
                    if sc.get("stage") in ("trunk", "prologue"):
                        errors.append(f"C6: смерть {o['to']} в стволе ({sid})")
                    continue
                out.append((o["to"], c["fx"] + o.get("fx", [])))
            edges = []
            full = dict(st)
            for to, fx in out:
                entry_from[to].add(sid)
                # применяем fx к живой части, неживые переменные пойдут через aux
                st2 = dict(full)
                for kind, n, v in fx:
                    if n in st2:
                        st2[n] = clampv(n, st2[n] + v) if kind == "add" else v
                # переменные, живые в ребёнке, но мёртвые здесь, не бывает: live(parent) ⊇ live(child)
                ck = tuple(st2[n] for n in live_order[to])
                edges.append(((to, ck), fx))
            EDGES[node] = edges
            alive1 = any(o["to"] not in D for c, o in res1) or ("next" in sc and not sc.get("choices"))
            info[node] = {"decision": len(vis1) >= 2, "alive1": alive1,
                          "terminal": not sc.get("choices") and "next" not in sc, "seal": seal(sc),
                          "dar": st.get("ДАР", 0)}
            for ch, _ in edges:
                parents[ch].add(node)
        # распространяем aux
        for ch, fx in EDGES[node]:
            # переменные, живые здесь, но мёртвые в ребёнке, уходят в aux ребёнка
            st = dict(zip(live_order[sid], keyv))
            extra = {}
            for n in live_order[sid]:
                if n not in live[ch[0]]:
                    v = st[n]
                    for kind, fn, fv in fx:
                        if fn == n:
                            v = clampv(n, v + fv) if kind == "add" else fv
                    extra[n] = (v, v) if n in CFG["vars"] else frozenset([v])
            a = fx_aux(AUX[node], fx)
            a.update(extra)
            if ch not in AUX:
                AUX[ch] = a
                work.append(ch)
            else:
                m, grew = merge(AUX[ch], a)
                if grew:
                    AUX[ch] = m
                    work.append(ch)

    # --- I1′
    memo = {}

    def doomed(n):
        if n in memo:
            return memo[n]
        memo[n] = False
        if info[n]["terminal"]:
            return False
        r = all(doomed(c) for c, _ in EDGES[n]) if EDGES[n] else True
        memo[n] = r
        return r

    sys.setrecursionlimit(100000)

    def rescue(n, k, sealg, seen=()):
        ps = parents.get(n, ())
        if not ps:
            return False
        for p in ps:
            if p in seen:
                continue
            if info[p]["seal"] != sealg:
                return False
            if info[p]["decision"]:
                if not doomed(p):
                    continue
                if k - 1 <= 0 or not rescue(p, k - 1, sealg, seen + (p,)):
                    return False
            elif not rescue(p, k, sealg, seen + (p,)):
                return False
        return True

    bad = 0
    for n in EDGES:
        if not doomed(n):
            continue
        d = depth(info[n]["dar"] or 0)
        if not rescue(n, d - 1, info[n]["seal"]):
            bad += 1
            if bad <= 15:
                st = dict(zip(live_order[n[0]], n[1]))
                pretty = ", ".join(f"{k}={v}" for k, v in st.items() if v not in (None, False))
                errors.append(f"I1′: тупик в {n[0]} (глубина отката {d}) при: {pretty}")
    if bad > 15:
        errors.append(f"I1′: … и ещё {bad - 15} тупиковых состояний")

    # условия абзацев: перебираем возможные значения только тех переменных, что в них участвуют
    from itertools import product
    for n, aux in AUX.items():
        sid = n[0]
        blocks = [b for b in S[sid]["text"] if "if" in b]
        if not blocks:
            continue
        st = dict(zip(live_order[sid], n[1]))
        for b in blocks:
            used = sorted(names(b["if"], set()))
            opts = []
            for u in used:
                if u in st:
                    opts.append([st[u]])
                elif u in CFG["vars"]:
                    lo, hi = aux[u]
                    opts.append(list(range(lo, hi + 1, 5)) or [lo])
                else:
                    opts.append(sorted(aux[u], key=str))
            k = (sid, "текст", b["md"][:32])
            for combo in product(*opts):
                r = ev(b["if"], dict(zip(used, combo)))
                (cond_true if r else cond_false).add(k)
                if k in cond_true and k in cond_false:
                    break

    for k in cond_true | cond_false:
        if k not in cond_true:
            errors.append(f"I2: условие никогда не выполняется — {k[0]} [{k[1]}] {k[2]}")
        elif k not in cond_false:
            warns.append(f"I2: условие всегда истинно — {k[0]} [{k[1]}] {k[2]}")
    reached = {n[0] for n in EDGES}
    for sid in S:
        if sid not in reached:
            warns.append(f"R: сцена {sid} недостижима")
    for did in D:
        if did not in reached_deaths:
            warns.append(f"R: смерть {did} недостижима")

    # --- сводка по сценам
    rng = defaultdict(dict)
    flg = defaultdict(lambda: defaultdict(set))
    count = defaultdict(int)
    for n, aux in AUX.items():
        sid = n[0]
        count[sid] += 1
        st = dict(zip(live_order[sid], n[1]))
        for v in CFG["vars"]:
            lo, hi = (st[v], st[v]) if v in st else aux[v]
            if v in rng[sid]:
                a, b = rng[sid][v]
                rng[sid][v] = (min(a, lo), max(b, hi))
            else:
                rng[sid][v] = (lo, hi)
        for f in CFG["flags"]:
            vals = {st[f]} if f in st else aux[f]
            flg[sid][f] |= set(vals)

    rank = {"prologue": 0, "trunk": 1, "demo": 2, "branch": 3, "anchor": 4, "final": 5}
    order = sorted(rng, key=lambda s: (rank.get(S[s].get("stage"), 9), s))
    L = ["# Отчёт валидатора (генерируется, не править руками)", "",
         f"Сцен: {len(S)}, смертей: {len(D)}, узлов «сцена × живое состояние»: {len(AUX)}", "", "## Проблемы", ""]
    L += [f"- ❌ {e}" for e in errors] or ["- ✅ ошибок нет"]
    L += [f"- ⚠️ {w}" for w in warns]
    L += ["", "## Схема", "", "```mermaid", "flowchart TD"]
    for sid, sc in S.items():
        L.append(f'  {sid.replace("-", "_")}["{sid} {sc.get("title", "")}"]')
    for sid, sc in S.items():
        for c in sc.get("choices", []):
            for o in c["outcomes"]:
                t = o["to"]
                if t in D:
                    L.append(f'  {sid.replace("-", "_")} -. {c["id"]} .-> {t.replace("-", "_").replace(".", "_").replace("✝", "X_")}(("✝"))')
                else:
                    L.append(f'  {sid.replace("-", "_")} -- {c["id"]} --> {t.replace("-", "_")}')
        if "next" in sc:
            L.append(f'  {sid.replace("-", "_")} --> {sc["next"].replace("-", "_")}')
    L += ["```", "", "## Шапки сцен (диапазоны на входе по всем достижимым путям)", ""]
    for sid in order:
        sc = S[sid]
        L.append(f"### {sid}. {sc.get('title', '')}")
        L.append(f"ВХОДЫ: {', '.join(sorted(entry_from[sid])) or 'старт'} · узлов: {count[sid]}")
        parts = []
        for v in CFG["vars"]:
            lo, hi = rng[sid][v]
            parts.append(f"{v} {lo}" if lo == hi else f"{v} {lo}–{hi}")
        L.append("ДИАПАЗОНЫ: " + " · ".join(parts))
        fl = []
        for f in CFG["flags"]:
            vals = flg[sid][f]
            real = sorted(str(v) for v in vals if v not in (None, False))
            if real:
                fl.append(f"{f} ∈ {{{', '.join(real)}{', —' if (None in vals or False in vals) else ''}}}")
        L.append("ФЛАГИ: " + ("; ".join(fl) if fl else "нет"))
        L.append("")
    out = ROOT / "docs" / "generated" / "report.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(L) + "\n", encoding="utf-8")

    print(f"узлов: {len(AUX)}, сцен: {len(reached)}/{len(S)}, смертей: {len(reached_deaths)}/{len(D)}")
    for e in errors:
        print("❌", e)
    for w in warns:
        print("⚠️ ", w)
    print("отчёт:", out.relative_to(ROOT))
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
