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
from itertools import product
from collections import defaultdict

from qqparse import ROOT, QQError, load

G = CFG = None


def ev(e, st, seen_life=frozenset(), meta=None):
    """seen_life — смерти этой жизни; meta — смерти из Журнала (все жизни).
    meta=None: считать Журналом то же, что seen_life (как раньше). Для I1 передают frozenset():
    мета-эхо (seen без _life) — подарок прошлых жизней, опираться на него нельзя."""
    op = e["op"]
    if op in ("num", "lit"):
        return e["v"]
    if op == "var":
        return st.get(e["n"])
    if op == "truthy":
        return bool(st.get(e["n"]))
    if op == "not":
        return not ev(e["a"], st, seen_life, meta)
    if op == "and":
        return all(ev(a, st, seen_life, meta) for a in e["a"])
    if op == "or":
        return any(ev(a, st, seen_life, meta) for a in e["a"])
    if op == "seen":
        if e.get("life") or meta is None:
            return e["id"] in seen_life
        return e["id"] in meta
    if op == "cmp":
        l, r = ev(e["l"], st, seen_life, meta), ev(e["r"], st, seen_life, meta)
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
    # Числа живут сквозь всю игру. Флаги — только внутри своего отрезка (ствол / ветвь / якорь):
    # на границе отрезка флаг, нужный дальше, берётся из накопленного множества значений
    # (over-approximation: тупики не пропускаются, но возможны лишние тревоги).
    changed = True
    while changed:
        changed = False
        for sid, sc in S.items():
            for t in successors(sc):
                if t not in S:
                    continue
                add = live[t] if seal(S[t]) == seal(sc) else {n for n in live[t] if n in CFG["vars"]}
                if not add <= live[sid]:
                    live[sid] |= add
                    changed = True
    live_order = {sid: tuple(n for n in ALL if n in live[sid]) for sid in S}

    # --- абстракция значений: у enum-флага важно только, равен ли он литералу,
    # с которым его где-то сравнивают в переходах. Остальные значения склеиваются в «*».
    CMP = defaultdict(set)

    def collect_cmp(e):
        if isinstance(e, dict):
            if e.get("op") == "cmp":
                for a, b in ((e["l"], e["r"]), (e["r"], e["l"])):
                    if a.get("op") == "var" and b.get("op") == "lit":
                        CMP[a["n"]].add(b["v"])
            for v in e.values():
                collect_cmp(v)
        elif isinstance(e, list):
            for v in e:
                collect_cmp(v)

    for sc in S.values():
        for c in sc.get("choices", []):
            collect_cmp(c.get("visible"))
            for o in c["outcomes"]:
                collect_cmp(o.get("if"))
    ENUMS = {n for n, f in CFG["flags"].items() if f["type"] == "enum"}

    def abst(n, v):
        if n in ENUMS and v is not None and v not in CMP.get(n, ()):
            return "*"
        return v

    INTERN, VCACHE = {}, {}

    def pack(aux):
        t = tuple(sorted(((k, VCACHE.setdefault(v, v)) for k, v in aux.items()), key=lambda kv: kv[0]))
        return INTERN.setdefault(t, t)

    DEATH_SEALS = {seal(sc) for sc in S.values()
                   if any(o["to"] in D for c in sc.get("choices", []) for o in c["outcomes"])}

    # --- насыщение чисел (точная оптимизация): если значение выше любого будущего порога
    # даже после всех возможных будущих минусов (или ниже любого порога после всех плюсов),
    # его точная величина ни на одно условие не влияет — такие значения склеиваются.
    NUM = list(CFG["vars"])

    def cmp_consts(e, acc):
        if isinstance(e, dict):
            if e.get("op") == "cmp":
                for a, b in ((e["l"], e["r"]), (e["r"], e["l"])):
                    if a.get("op") == "var" and a["n"] in CFG["vars"] and b.get("op") == "num":
                        acc[a["n"]].add(b["v"])
            for v in e.values():
                cmp_consts(v, acc)
        elif isinstance(e, list):
            for v in e:
                cmp_consts(v, acc)
        return acc

    own_th = {}
    for sid, sc in S.items():
        acc = defaultdict(set)
        cmp_consts([b.get("if") for b in sc["text"]] + [c.get("visible") for c in sc.get("choices", [])]
                   + [o.get("if") for c in sc.get("choices", []) for o in c["outcomes"]]
                   + [b.get("if") for bl in sc.get("after", {}).values() for b in bl], acc)
        acc["ДАР"] |= {lo for lo, _ in CFG["rollback"]}      # пороги глубины отката
        own_th[sid] = acc
    TH, INC, DEC = {}, {}, {}
    sys.setrecursionlimit(100000)

    def calc(sid):
        if sid in TH:
            return
        TH[sid] = {n: set(own_th[sid].get(n, ())) for n in NUM}
        INC[sid] = {n: 0 for n in NUM}
        DEC[sid] = {n: 0 for n in NUM}
        sc = S[sid]
        outs = [(sc["next"], [])] if "next" in sc else []
        for c in sc.get("choices", []):
            for o in c["outcomes"]:
                if o["to"] in S:
                    outs.append((o["to"], c["fx"] + o.get("fx", [])))
        for to, fx in outs:
            calc(to)
            for n in NUM:
                up = dn = 0
                for kind, fn, v in fx:
                    if fn != n:
                        continue
                    if kind == "add":
                        up, dn = (up + v, dn) if v > 0 else (up, dn - v)
                    else:                       # set / cap: без насыщения
                        up += 1000
                        dn += 1000
                TH[sid][n] |= TH[to][n]
                INC[sid][n] = max(INC[sid][n], up + INC[to][n])
                DEC[sid][n] = max(DEC[sid][n], dn + DEC[to][n])

    for sid in S:
        calc(sid)

    SAT = {(sid, n): (min(TH[sid][n]) - INC[sid][n] - 5, max(TH[sid][n]) + DEC[sid][n] + 5)
           for sid in S for n in NUM if TH[sid][n]}

    def kv(sid, n, v):
        """Значение для ключа узла: насыщение для чисел, абстракция для флагов."""
        if n in ENUMS:
            return abst(n, v)
        b = SAT.get((sid, n))
        if b and v is not None:
            if v > b[1]:
                return b[1]
            if v < b[0]:
                return b[0]
        return v

    def init():
        st = {k: v["start"] for k, v in CFG["vars"].items()}
        st.update({k: None for k in CFG["flags"]})
        return st

    def clampv(n, v):
        c = CFG["vars"][n]
        return max(c["min"], min(c["max"], v))

    # aux: точные (lo, hi) для ВСЕХ чисел и множества для ВСЕХ флагов; ключ — насыщенный/абстрактный
    def split(sid, st):
        keyv = tuple(kv(sid, n, st[n]) for n in live_order[sid])
        aux = {}
        for n in ALL:
            v = st[n]
            aux[n] = frozenset([v]) if n in CFG["flags"] else (v, v)
        return keyv, aux

    def fx_aux(aux, fx):
        aux = dict(aux)
        for kind, n, v in fx:
            if n not in aux:
                continue
            if n in CFG["vars"]:
                lo, hi = aux[n]
                aux[n] = ((clampv(n, lo + v), clampv(n, hi + v)) if kind == "add"
                          else (min(lo, v), min(hi, v)) if kind == "cap" else (v, v))
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
    # сцены обходим в топологическом порядке: к моменту обработки сцены все её входы
    # уже слиты, поэтому каждый узел раскрывается ровно один раз
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
    if len(order) != len(S):
        errors.append("цикл в графе сцен: время в игре должно идти только вперёд")
    PENDING = defaultdict(dict)    # сцена -> {живой ключ: aux (dict, ещё копится)}
    PENDING[start[0]][start[1]] = a0
    import os
    VERBOSE = os.environ.get("QQ_VERBOSE")
    LIMIT = int(os.environ.get("QQ_LIMIT", "300000"))
    for sid in order:
        sc = S[sid]
        bucket = PENDING.pop(sid, {})
        if VERBOSE:
            print(f"  {sid}: {len(bucket)} узлов, всего {len(AUX)}", flush=True)
        if len(AUX) + len(bucket) > LIMIT:
            print(f"точный перебор больше {LIMIT} узлов (сцена {sid}) — переключаюсь на быструю проверку")
            import validate_fast
            sys.exit(validate_fast.main(note=f"Точный перебор превысил {LIMIT} узлов на сцене {sid}."))
        for keyv, auxd in bucket.items():
            node = (sid, keyv)
            AUX[node] = pack(auxd)
            st = dict(zip(live_order[sid], keyv))

            def run(seen_life):
                vis, res = [], []
                for c in sc.get("choices", []):
                    if c.get("cost", 0) > sc.get("clock", 10 ** 9):
                        continue
                    if "visible" in c:
                        # мета-эхо: для I2 считаем Журнал полным, для хода игры (и I1′) — пустым
                        if ev(c["visible"], st, seen_life, frozenset(D)):
                            cond_true.add((sid, c["id"], "visible: " + c.get("visible_src", "")))
                        r = ev(c["visible"], st, seen_life, frozenset())
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
                        st2[n] = clampv(n, st2[n] + v) if kind == "add" else min(st2[n], v) if kind == "cap" else v
                # флаги, нужные ребёнку из другого отрезка, но не живые здесь, — из накопленного множества
                miss = [n for n in live_order[to] if n not in st2]
                if miss:
                    a0 = fx_aux(auxd, fx)
                    choices_ = [sorted({abst(n, v) for v in a0[n]}, key=str) for n in miss]
                    for combo in product(*choices_):
                        st3 = dict(st2)
                        st3.update(zip(miss, combo))
                        edges.append(((to, tuple(kv(to, n, st3[n]) for n in live_order[to])), fx))
                    continue
                ck = tuple(kv(to, n, st2[n]) for n in live_order[to])
                edges.append(((to, ck), fx))
            EDGES[node] = tuple(edges)
            sg = seal(sc)
            # (решение?, терминал?, печать, ДАР)
            info[node] = (len(vis1) >= 2, not sc.get("choices") and "next" not in sc, sg, st.get("ДАР", 0) or 0)
            if sg in DEATH_SEALS:
                for ch, _ in edges:
                    parents[ch].add(node)
            # распространяем aux в детей (они в более поздних сценах)
            for ch, fx in edges:
                a = fx_aux(auxd, fx)        # aux хранит точные интервалы всех чисел и множества всех флагов
                tgt = PENDING[ch[0]]
                if ch[1] in tgt:
                    tgt[ch[1]], _ = merge(tgt[ch[1]], a)
                else:
                    tgt[ch[1]] = a

    # --- I1′
    memo = {}

    def doomed(n):
        if n in memo:
            return memo[n]
        memo[n] = False
        if info[n][1]:
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
            if info[p][2] != sealg:
                return False
            if info[p][0]:
                if not doomed(p):
                    continue
                if k - 1 <= 0 or not rescue(p, k - 1, sealg, seen + (p,)):
                    return False
            elif not rescue(p, k, sealg, seen + (p,)):
                return False
        return True

    bad = 0
    for n in EDGES:
        if info[n][2] not in DEATH_SEALS or not doomed(n):
            continue
        d = depth(info[n][3])
        if not rescue(n, d - 1, info[n][2]):
            bad += 1
            if bad <= 15:
                st = dict(zip(live_order[n[0]], n[1]))
                pretty = ", ".join(f"{k}={v}" for k, v in st.items() if v not in (None, False))
                errors.append(f"I1′: тупик в {n[0]} (глубина отката {d}) при: {pretty}")
    if bad > 15:
        errors.append(f"I1′: … и ещё {bad - 15} тупиковых состояний")

    # условия абзацев: перебираем возможные значения только тех переменных, что в них участвуют

    for n, auxt in AUX.items():
        sid = n[0]
        blocks = [b for b in S[sid]["text"] if "if" in b]
        if not blocks:
            continue
        aux = dict(auxt)
        st = dict(zip(live_order[sid], n[1]))
        for b in blocks:
            used = sorted(names(b["if"], set()))
            opts = []
            for u in used:
                if u in CFG["flags"]:
                    vals = aux[u]
                    if u in st and st[u] != "*":
                        vals = {st[u]}
                    elif u in st:
                        vals = {v for v in vals if v is not None and v not in CMP.get(u, ())} or vals
                    opts.append(sorted(vals, key=str))
                elif u in st:
                    opts.append([st[u]])
                else:
                    lo, hi = aux[u]
                    opts.append(list(range(lo, hi + 1, 5)) or [lo])
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
    for n, auxt in AUX.items():
        sid = n[0]
        aux = dict(auxt)
        count[sid] += 1
        st = dict(zip(live_order[sid], n[1]))
        for v in CFG["vars"]:
            lo, hi = aux[v]
            if v in rng[sid]:
                a, b = rng[sid][v]
                rng[sid][v] = (min(a, lo), max(b, hi))
            else:
                rng[sid][v] = (lo, hi)
        for f in CFG["flags"]:
            flg[sid][f] |= set(aux[f])

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
    if "--exact" in sys.argv:
        main()                      # точный перебор всех состояний (тяжёлый, для небольших графов)
    else:
        import validate_fast        # по умолчанию: быстрая интервальная проверка (доли секунды)
        sys.exit(validate_fast.main(note="Точный перебор: python3 tools/validate.py --exact"))
