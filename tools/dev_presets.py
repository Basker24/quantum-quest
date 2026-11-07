#!/usr/bin/env python3
"""Пресеты для режима автора: «прыжок в сцену со статами под дальнейшую историю».

Для каждой пары (сцена S, цель T), где T — финал или тупик, достижимый из S по графу,
ищется DFS-путь start → S → T по точному состоянию (тот же поиск, что у свидетелей,
tools/witness.py: kit). Фаза 1 идёт к S, фаза 2 — от S к T; если из этого входа в S
цель не достижима, поиск возвращается в фазу 1 и ищет другой вход.

На пару хранится только то, что нужно движку:
  st   — состояние в момент входа в S (переменные, ненулевые флаги, остаток секунд);
  tail — хвост пути S → T: [сцена, вариант | null, смерть | null];
  pre  — последние шаги до S (для правдоподобного стека отката): [сцена, вариант, отличия состояния, индекс в tr];
  tr   — след выборов, поставивших флаги (метки «↩»), и шаги pre: [сцена, вариант, [флаги]].
Не найдено в пределах лимита — пара попадает в fail (в игре цель серая, «пути не найдено»).

Запуск: python3 tools/dev_presets.py [--limit N] → game/dev.js (window.DEV = …).
"""
import json
import sys
import time

from qqparse import CLOCK_KEY, ROOT, load
from witness import kit

SWEEP = 400000  # узлов на общий обход к одной цели
LIMIT = 4000    # узлов на пару, которую общий обход не покрыл (обычно цель там и правда недостижима)
PRE = 7         # шагов стека до S


_CTX = {}


def _sweep(t):
    return _CTX["sweep"](t)


def _search(pair):
    return _CTX["search"](pair)


def pmap(fn, items):
    """Параллельно на fork (замыкания из _CTX наследуются), иначе — по очереди."""
    import multiprocessing as mp
    items = list(items)
    try:
        ctx = mp.get_context("fork")
    except ValueError:
        return [fn(x) for x in items]
    with ctx.Pool(min(4, mp.cpu_count() or 1)) as pool:
        return pool.map(fn, items, chunksize=max(1, len(items) // 16))


def topo(S, succ):
    indeg = {x: 0 for x in S}
    for x in S:
        for y in succ(x):
            indeg[y] += 1
    q = [x for x in S if not indeg[x]]
    out = []
    while q:
        v = q.pop()
        out.append(v)
        for y in succ(v):
            indeg[y] -= 1
            if not indeg[y]:
                q.append(y)
    return out


def presets(G, limit=LIMIT, sweep_limit=SWEEP):
    K = kit(G)
    S, D = K.S, K.D
    reach = {t: K.can_reach(t) for t in K.finals}
    dirs = {t: K.directions(t) for t in K.finals}
    reach_s = {}

    def search(s_id, t):
        rs = reach_s.setdefault(s_id, K.can_reach(s_id))
        rt = reach[t]
        vis1, vis2 = set(), set()
        budget = [limit]
        path, entry = [], {}

        def dfs(sid, st, seen, phase):
            if phase == 1 and sid == s_id:
                n = len(path)
                if dfs(sid, st, seen, 2):
                    entry["st"], entry["i"] = st, n
                    return True
                return False
            if phase == 2 and sid == t:
                return True
            k = K.key(sid, st, seen)
            vis = vis1 if phase == 1 else vis2
            if k in vis or budget[0] <= 0:
                return False
            vis.add(k)
            budget[0] -= 1
            sc = S[sid]
            r = rs if phase == 1 else rt
            shown, opts = K.options(sid, st, seen, r, dirs[t])
            if not shown and "next" in sc:
                if sc["next"] in r:
                    path.append((sid, None, None))
                    if dfs(sc["next"], K.tick(st, sid, 0, sc["next"]), frozenset(), phase):
                        return True
                    path.pop()
                return False
            for _, c, o in opts:
                if o["to"] in D:
                    path.append((sid, c["id"], o["to"]))
                    if dfs(sid, st, seen | {o["to"]}, phase):
                        return True
                    path.pop()
                    continue
                path.append((sid, c["id"], None))
                if dfs(o["to"], K.step(sid, st, c, o), frozenset(), phase):
                    return True
                path.pop()
            return False

        ok = dfs(G["config"]["start"], K.st0(), frozenset(), 1)
        if not ok:
            return None, limit - budget[0]
        return (path[:entry["i"]], path[entry["i"]:], entry["st"]), limit - budget[0]

    def replay(prefix):
        """Состояния на входе в каждую сцену префикса и флаги, поставленные каждым выбором."""
        st, seen, out = K.st0(), frozenset(), []
        for sid, cid, death in prefix:
            sc = S[sid]
            if cid is None:
                out.append((sid, cid, dict(st), []))
                st = K.tick(st, sid, 0, sc["next"])
                continue
            c = next(c for c in sc["choices"] if c["id"] == cid)
            if death:
                seen = seen | {death}
                continue
            o = next(o for o in c["outcomes"] if not o.get("if") or K_ev(o["if"], st, seen))
            flags = [n for kind, n, _ in c["fx"] + o.get("fx", []) if kind == "set" and n in G["config"]["flags"]]
            out.append((sid, cid, dict(st), flags))
            st, seen = K.step(sid, st, c, o), frozenset()
        return out, st

    from validate import ev

    def end_of(st, tail):
        """Проигрывает хвост от состояния входа: куда он приводит (проверка пресета)."""
        seen, sid = frozenset(), tail[0][0]
        for s2, cid, death in tail:
            if s2 != sid:
                return None
            sc = S[sid]
            if cid is None:
                st, sid = K.tick(st, sid, 0, sc["next"]), sc["next"]
                continue
            c = next(c for c in sc["choices"] if c["id"] == cid)
            if c.get("visible") and not K_ev(c["visible"], st, seen):
                return None
            o = next(o for o in c["outcomes"] if not o.get("if") or K_ev(o["if"], st, seen))
            if death:
                if o["to"] != death:
                    return None
                seen = seen | {death}
                continue
            st, sid, seen = K.step(sid, st, c, o), o["to"], frozenset()
        return sid

    def K_ev(e, st, seen):
        return ev(e, st, seen, frozenset())

    def sweep(t, n):
        """Один обход к цели t: после успеха продолжает перебор, пока ниже есть сцены без пресета.
        memo: ключ состояния → (шаг, ключ ребёнка) при успехе, None — провал. Возвращает {сцена: (префикс, st, ключ)}."""
        r, dr = reach[t], dirs[t]
        memo, found, path, budget = {}, {}, [], [n]
        unc = [bits_reach[t] & ~bit[t]]   # сцены без пресета (битовая маска)

        def note(sid, st, k):
            if sid not in found:
                found[sid] = (list(path), st, k)
                unc[0] &= ~bit[sid]

        def dfs(sid, st, seen):
            if sid == t:
                return "T"
            k = K.key(sid, st, seen)
            if k in memo:
                if memo[k] is not None and not seen:
                    note(sid, st, k)
                return k if memo[k] is not None else None
            if budget[0] <= 0:
                return None
            memo[k] = None
            budget[0] -= 1
            sc = S[sid]
            shown, opts = K.options(sid, st, seen, r, dr)
            best = None
            if not shown and "next" in sc:
                if sc["next"] in r:
                    path.append((sid, None, None))
                    ck = dfs(sc["next"], K.tick(st, sid, 0, sc["next"]), frozenset())
                    path.pop()
                    if ck is not None:
                        best = ((sid, None, None), ck)
            else:
                for _, c, o in opts:
                    death = o["to"] in D
                    nxt = sid if death else o["to"]
                    if best is not None and not (fwd[nxt] & unc[0]):
                        continue                      # путь уже есть, а ниже нечего открывать
                    stp = (sid, c["id"], o["to"] if death else None)
                    path.append(stp)
                    ck = dfs(sid, st, seen | {o["to"]}) if death else dfs(o["to"], K.step(sid, st, c, o), frozenset())
                    path.pop()
                    if ck is not None and best is None:
                        best = (stp, ck)
            if best is not None:
                memo[k] = best
                if not seen:
                    note(sid, st, k)
            return k if best is not None else None

        dfs(G["config"]["start"], K.st0(), frozenset())

        def tail(k):
            out = []
            while k != "T":
                stp, k = memo[k]
                out.append(stp)
            return out
        return {sid: (pre, tail(k), st) for sid, (pre, st, k) in found.items()}, n - budget[0]

    # битовые маски: сцена → бит, fwd[сцена] — что достижимо вперёд (включая её саму)
    ids = list(S)
    bit = {sid: 1 << i for i, sid in enumerate(ids)}
    fwd = {}
    for sid in reversed(topo(S, K.succ)):
        m = bit[sid]
        for x in K.succ(sid):
            m |= fwd[x]
        fwd[sid] = m
    bits_reach = {t: sum(bit[x] for x in reach[t]) for t in K.finals}

    pres, fail, stats = {}, {}, [0, 0, 0]
    targets = {s: [t for t in K.finals if s in reach[t] and s != t] for s in S}
    got = {}
    _CTX.update(sweep=lambda t: sweep(t, sweep_limit), search=lambda st: search(*st))
    for t, (res, used) in zip(K.finals, pmap(_sweep, K.finals)):
        stats[2] += used
        for sid, v in res.items():
            got[(sid, t)] = v
    miss = [(s_id, t) for s_id, ts in targets.items() for t in ts if (s_id, t) not in got]
    for pair, (res, used) in zip(miss, pmap(_search, miss)):
        stats[2] += used
        if res is not None:
            got[pair] = res
    for s_id, ts in targets.items():
        for t in ts:
            res = got.get((s_id, t))
            if res is None:
                fail.setdefault(s_id, []).append(t)
                stats[1] += 1
                continue
            prefix, tail, st = res
            steps, st_end = replay(prefix)
            assert st_end == st, (s_id, t)
            assert tail and tail[0][0] == s_id and end_of(st, tail) == t, (s_id, t)
            clean = {k: v for k, v in st.items() if v is not None}
            tr, pre = [], []
            keep_pre = [i for i, x in enumerate(steps) if x[1] is not None][-PRE:]
            for i, (sid, cid, st_i, flags) in enumerate(steps):
                if cid is None:
                    continue
                if flags or i in keep_pre:
                    if i in keep_pre:
                        diff = {k: st_i.get(k) for k in set(st_i) | set(st) if st_i.get(k) != st.get(k)}
                        pre.append([sid, cid, diff, len(tr)])
                    tr.append([sid, cid, flags])
            pres.setdefault(s_id, {})[t] = {"st": clean, "tail": [list(x) for x in tail], "pre": pre, "tr": tr}
            stats[0] += 1
    return pres, fail, stats


def main():
    limit = LIMIT
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])
    t0 = time.time()
    G = load()
    pres, fail, (ok, bad, used) = presets(G, limit)
    out = ROOT / "game" / "dev.js"
    data = {"presets": pres, "fail": fail, "limit": limit}
    out.write_text("window.DEV = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"пресеты автора: {ok} пар, не найдено {bad}, {used} узлов, {time.time() - t0:.1f} с → {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
