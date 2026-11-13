#!/usr/bin/env python3
"""Свидетели: для каждого финала ищет один конкретный путь от начала игры.

Поиск — DFS по точному состоянию (все переменные и флаги), без абстракций.
Эвристика: сначала пробуем варианты, которые двигают переменные в сторону условий,
стоящих на рёбрах в цель (ДАР >= 80 → растить ДАР; ДРЕЙФ <= 30 → не растить).
Смерть — это шаг «умер и откатился»: переменные не меняются, смерть попадает
в seen_life (открывает эхо-варианты в этой сцене). Мета-эхо seen(✝…) свидетель не берёт:
путь должен проходиться с пустым Журналом. lived(ID) (прожито в прошлой жизни) — тоже
ложь: ev с meta=frozenset().
«Время»: остаток секунд (CLOCK_KEY) — часть точного состояния; вариант с cost больше
остатка закрыт, переход в сцену без clock сбрасывает счёт.

Результат:
  docs/generated/witness.md — пути для автора;
  возвращает dict guides для game/graph.js (GRAPH.guides).
Если путь не найден в пределах лимита — предупреждение «финал, возможно, недостижим».
"""
import sys
from collections import defaultdict

from qqparse import CLOCK_KEY, ROOT, load
from validate import ev, GATES

LIMIT = 1500000


def kit(G):
    """Общие части поиска (переиспользует tools/dev_presets.py): переходы, достижимость, эвристика, живые переменные."""
    S, D, CFG = G["scenes"], G["deaths"], G["config"]

    def clamp(n, v):
        c = CFG["vars"][n]
        return max(c["min"], min(c["max"], v))

    def tick(st, sid, cost, to):
        """Остаток секунд после выбора в sid и входа в to (цепочка сцен с clock)."""
        st = dict(st)
        v = st.get(CLOCK_KEY)
        if v is not None:
            v -= cost
        c = S[to].get("clock") if to in S else None
        st[CLOCK_KEY] = None if c is None else (c if v is None else v)
        return st

    def apply(st, fx):
        st = dict(st)
        for kind, n, v in fx:
            if n in CFG["vars"]:
                st[n] = clamp(n, st[n] + v) if kind == "add" else min(st[n], v) if kind == "cap" else v
            else:
                st[n] = v
        return st

    def succ(sid):
        sc = S[sid]
        out = [sc["next"]] if "next" in sc else []
        for c in sc.get("choices", []):
            out += [o["to"] for o in c["outcomes"] if o["to"] in S]
        return out

    finals = [sid for sid, sc in S.items() if sc.get("stage") == "final"]

    # обратная достижимость: из каких сцен вообще можно дойти до цели
    preds = defaultdict(set)
    for sid in S:
        for t in succ(sid):
            preds[t].add(sid)

    def can_reach(target):
        seen, st = {target}, [target]
        while st:
            v = st.pop()
            for p in preds[v]:
                if p not in seen:
                    seen.add(p)
                    st.append(p)
        return seen

    # направления: какие условия стоят на рёбрах, ведущих к цели (и вообще к сценам на пути)
    def directions(target):
        want = defaultdict(int)   # var -> +1 растить / -1 не растить
        flag_want = {}            # flag -> желаемое значение
        flag_avoid = {}           # flag -> значения, которых надо избегать

        def walk(e, neg=False):
            if not isinstance(e, dict):
                return
            op = e.get("op")
            if op == "not":
                return walk(e["a"], not neg)
            if op in ("and", "or"):
                for a in e["a"]:
                    walk(a, neg)
                return
            if op == "truthy" and not neg:
                flag_want[e["n"]] = True
            if op == "cmp":
                l, r, c = e["l"], e["r"], e["c"]
                if l.get("op") == "var" and r.get("op") == "num":
                    up = c in (">=", ">")
                    if neg:
                        up = not up
                    if c in (">=", ">", "<=", "<"):
                        want[l["n"]] += 1 if up else -1
                if l.get("op") == "var" and r.get("op") == "lit":
                    if (c == "==") != neg:
                        flag_want[l["n"]] = r["v"]
                    else:
                        flag_avoid.setdefault(l["n"], set()).add(r["v"])

        for sid in S:
            for c in S[sid].get("choices", []):
                if any(o["to"] == target for o in c["outcomes"]):
                    walk(c.get("visible"))
                    for o in c["outcomes"]:
                        if o["to"] == target:
                            walk(o.get("if"))
        return want, flag_want, flag_avoid

    def score(c, o, want, flag_want, flag_avoid):
        s = 0
        for kind, n, v in c["fx"] + o.get("fx", []):
            if n in want and kind == "add":
                s += want[n] * v
            elif n in flag_want and flag_want[n] == v:
                s += 50
            elif v in flag_avoid.get(n, ()):
                s -= 50
        return s

    # живость: что ещё может быть прочитано в переходах сцены или после неё
    from validate import names
    reads = {sid: names([c.get("visible") for c in sc.get("choices", [])]
                        + [o.get("if") for c in sc.get("choices", []) for o in c["outcomes"]], set())
             for sid, sc in S.items()}
    live = {sid: set(r) for sid, r in reads.items()}
    changed = True
    while changed:
        changed = False
        for sid in S:
            for t in succ(sid):
                if not live[t] <= live[sid]:
                    live[sid] |= live[t]
                    changed = True
    live = {sid: tuple(sorted(v)) for sid, v in live.items()}

    def st0():
        st = {k: v["start"] for k, v in CFG["vars"].items()}
        st.update({k: None for k in CFG["flags"]})
        st[CLOCK_KEY] = S[CFG["start"]].get("clock")
        return st

    def key(sid, st, seen):
        return (sid, tuple(st[n] for n in live[sid]), st.get(CLOCK_KEY), seen)

    def options(sid, st, seen, reach, dirs):
        """Варианты в порядке перебора: (score, c, o); смерти — в конце, только ещё не виденные в этой сцене."""
        sc = S[sid]
        left = st.get(CLOCK_KEY)
        vis = [c for c in sc.get("choices", []) if not c.get("visible") or ev(c["visible"], st, seen, GATES)]
        opts = []
        for c in vis:
            if left is not None and c.get("cost", 0) > left:
                continue                          # не успеть
            o = next(o for o in c["outcomes"] if not o.get("if") or ev(o["if"], st, seen, GATES))
            if o["to"] in D:
                if o["to"] not in seen:
                    opts.append((-1000, c, o))   # смерть — только если ничего другого не вышло
                continue
            if o["to"] in reach:
                opts.append((score(c, o, *dirs), c, o))
        opts.sort(key=lambda x: -x[0])
        return vis, opts

    def step(sid, st, c, o):
        return tick(apply(apply(st, c["fx"]), o.get("fx", [])), sid, c.get("cost", 0), o["to"])

    from types import SimpleNamespace
    return SimpleNamespace(S=S, D=D, CFG=CFG, finals=finals, succ=succ, can_reach=can_reach, directions=directions,
                           tick=tick, apply=apply, st0=st0, key=key, options=options, step=step, live=live)


def searcher(G, limit=LIMIT):
    """search(target, via=None) → (путь, сколько состояний); via — сцена, через которую путь обязан пройти."""
    K = kit(G)
    S, D, CFG, can_reach, directions, tick, key = K.S, K.D, K.CFG, K.can_reach, K.directions, K.tick, K.key

    def search(target, via=None):
        # до via идём по сценам, из которых via достижима, после — по тем, из которых достижима цель
        # (граф ацикличен: после via к ней не вернуться, поэтому ключ состояния тот же)
        reach_t = can_reach(target)
        dirs_t = directions(target)
        if via is not None:
            reach_v = can_reach(via) & reach_t if via in reach_t else set()
            dirs_v = directions(via)
            if not reach_v:
                return None, 0
        visited = set()
        budget = [limit]
        path = []

        def dfs(sid, st, seen, passed=via is None):
            if sid == via:
                passed = True
            if sid == target:
                return passed
            reach, dirs = (reach_t, dirs_t) if passed else (reach_v, dirs_v)
            k = key(sid, st, seen)
            if k in visited or budget[0] <= 0:
                return False
            visited.add(k)
            budget[0] -= 1
            sc = S[sid]
            vis, opts = K.options(sid, st, seen, reach, dirs)
            if not vis and "next" in sc:
                if sc["next"] in reach:
                    path.append((sid, None, None))
                    if dfs(sc["next"], tick(st, sid, 0, sc["next"]), frozenset(), passed):
                        return True
                    path.pop()
                return False
            for _, c, o in opts:
                if o["to"] in D:
                    path.append((sid, c["id"], o["to"]))
                    if dfs(sid, st, seen | {o["to"]}, passed):
                        return True
                    path.pop()
                    continue
                path.append((sid, c["id"], None))
                if dfs(o["to"], K.step(sid, st, c, o), frozenset(), passed):
                    return True
                path.pop()
            return False

        found = dfs(CFG["start"], K.st0(), frozenset())
        return (list(path) if found else None), limit - budget[0]

    return K, search


def find_all(G, limit=LIMIT):
    K, search = searcher(G, limit)
    return {t: search(t) for t in K.finals}


# восемь жизней: первая сцена каждой ветви (В2.1 и В2.2 начинаются после общей части В2)
LIVES = [("В1", "В1-01"), ("В2.1", "В2.1-00"), ("В2.2", "В2.2-00"), ("В3", "В3-01"),
         ("В4", "В4-01"), ("В5", "В5-01"), ("В6", "В6-01"), ("В7", "В7-01")]
ANCHOR = "Я-01"


def find_lives(G, limit=LIMIT):
    """По одному пути от старта до якоря Я-01 через каждую из восьми жизней."""
    K, search = searcher(G, limit)
    return {name: (via, search(ANCHOR, via)) for name, via in LIVES if via in K.S}


def letter_of(sc, cid, st=None):
    ids = [c["id"] for c in sc.get("choices", [])]
    return cid


def main():
    G = load()
    S = G["scenes"]
    res = find_all(G)
    lines = ["# Свидетели: по одному пути к каждому финалу", "",
             "Сгенерировано `tools/witness.py`. Буква — id варианта в исходнике сцены.", ""]
    guides, warns = {}, []
    for t, (path, used) in res.items():
        title = S[t]["title"]
        if path is None:
            warns.append(f"финал {t} «{title}»: путь не найден ({used} состояний) — возможно, недостижим")
            lines += [f"## {t} «{title}» — путь НЕ найден ({used} состояний)", ""]
            continue
        steps = []
        lines += [f"## {t} «{title}» — {len(path)} шагов, {used} состояний", ""]
        for sid, cid, death in path:
            sc = S[sid]
            if cid is None:
                lines.append(f"- {sid} «{sc['title']}» → Дальше")
                steps.append([sid, None, None])
                continue
            c = next(c for c in sc["choices"] if c["id"] == cid)
            mark = f" ✝ (смерть {death}, откат)" if death else ""
            lines.append(f"- {sid} «{sc['title']}» → [{cid}] {c['label']}{mark}")
            steps.append([sid, cid, death])
        lines.append("")
        guides[t] = steps
    lines += ["# Восемь жизней: по одному пути от старта до " + ANCHOR + " через каждую ветвь", ""]
    for name, (via, (path, used)) in find_lives(G).items():
        if path is None:
            warns.append(f"жизнь {name} (через {via}): путь до {ANCHOR} не найден ({used} состояний)")
            lines += [f"## {name} — через {via} «{S[via]['title']}»: путь до {ANCHOR} НЕ найден ({used} состояний)", ""]
            continue
        lines += [f"## {name} — через {via} «{S[via]['title']}»: {len(path)} шагов, {used} состояний", ""]
        for sid, cid, death in path:
            sc = S[sid]
            if cid is None:
                lines.append(f"- {sid} «{sc['title']}» → Дальше")
                continue
            c = next(c for c in sc["choices"] if c["id"] == cid)
            lines.append(f"- {sid} «{sc['title']}» → [{cid}] {c['label']}" + (f" ✝ (смерть {death}, откат)" if death else ""))
        lines.append("")
    out = ROOT / "docs" / "generated" / "witness.md"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    for w in warns:
        print("ПРЕДУПРЕЖДЕНИЕ:", w)
    print(f"свидетели: {len(guides)}/{len(res)} финалов → {out.relative_to(ROOT)}")
    return guides


if __name__ == "__main__":
    main()
