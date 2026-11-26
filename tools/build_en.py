#!/usr/bin/env python3
"""Английская версия: scenes_en/*.md → game/graph_en.js (канон п. 39).

Английские сцены лежат в scenes_en/ с теми же именами файлов, теми же ID и тем же DSL, что scenes/.
Переводятся только тексты: шапка (title, date, photo_caption, clock_label, lesson, epitaph, mourner),
абзацы, подписи вариантов (label, hint, locked), «## После X», «## Пробуждение». Логика (условия
::if, fx, переходы, visible, cost, tags, stage, photo, photo_by, clock, cause, next) обязана
совпадать с русской: сборка сверяет и падает на расхождении. Абзацы внутри одного условного блока
можно делить и сливать — сверяются условия, а не число абзацев.

graph_en.js — не второй полный граф, а слой текстов поверх русского: он грузится после graph.js
(только в английском режиме) и подменяет тексты в window.GRAPH до старта движка. Непереведённое
остаётся русским; список — window.GRAPH.en_missing (для e2e и режима автора).

Тексты конфига (имена переменных, ступени, шок первой смерти, мета-записи) — scenes_en/_config.json
(только текстовые поля). Подписи флагов — scenes_en/_memos.json. Подсказки путеводителя —
scenes_en/_guides.json.

    python3 tools/build_en.py          # build.py зовёт его сам
"""
import hashlib
import json
import sys

from qqparse import ROOT, QQError, parse_file

EN = ROOT / "scenes_en"
HEAD_TEXT = ("title", "date", "photo_caption", "clock_label", "lesson", "epitaph", "mourner")
HEAD_LOGIC = ("stage", "photo", "photo_by", "clock", "age", "stihia", "next")
EXCLUDE = ()  # DLC-2 лежит в game/gleb41, не в scenes/ — в сверку не входит


def src_sha(name):
    """Хэш русского исходника (12 знаков sha1) — пишется в шапку английского файла как src_sha."""
    p = ROOT / "scenes" / name
    return hashlib.sha1(p.read_bytes()).hexdigest()[:12] if p.exists() else None


def conds(blocks):
    """Последовательность условий абзацев; подряд идущие одинаковые склеены (абзацы можно делить)."""
    out = []
    for b in blocks or []:
        sig = json.dumps({k: v for k, v in b.items() if k not in ("md",)}, ensure_ascii=False, sort_keys=True)
        if b.get("kind") in ("chorus", "norewind"):
            out.append(sig)          # служебный блок — всегда отдельно
        elif not out or out[-1] != sig:
            out.append(sig)
    return out


def choice_logic(c):
    return json.dumps({k: c.get(k) for k in ("id", "fx", "outcomes", "visible", "cost", "tags")},
                      ensure_ascii=False, sort_keys=True)


def compare(sid, ru, en):
    errs = []
    for k in HEAD_LOGIC:
        if str(ru.get(k)) != str(en.get(k)):
            errs.append(f"шапка {k}: ru «{ru.get(k)}» ≠ en «{en.get(k)}»")
    if json.dumps(ru.get("cause"), sort_keys=True) != json.dumps(en.get("cause"), sort_keys=True):
        errs.append("cause отличается")
    for part in ("text", "awake"):
        if conds(ru.get(part)) != conds(en.get(part)):
            errs.append(f"{part}: условия абзацев не совпадают ({len(conds(ru.get(part)))} групп ru, "
                        f"{len(conds(en.get(part)))} en)")
    ra, ea = ru.get("after") or {}, en.get("after") or {}
    if set(ra) != set(ea):
        errs.append(f"«После»: ru {sorted(ra)} ≠ en {sorted(ea)}")
    for cid in set(ra) & set(ea):
        if conds(ra[cid]) != conds(ea[cid]):
            errs.append(f"«После {cid}»: условия абзацев не совпадают")
    rc, ec = ru.get("choices") or [], en.get("choices") or []
    if [c["id"] for c in rc] != [c["id"] for c in ec]:
        errs.append(f"варианты: ru {[c['id'] for c in rc]} ≠ en {[c['id'] for c in ec]}")
    else:
        for a, b in zip(rc, ec):
            if choice_logic(a) != choice_logic(b):
                errs.append(f"вариант [{a['id']}]: логика отличается (fx/переходы/visible/cost/tags)")
            for k in ("hint", "locked"):
                if bool(a.get(k)) != bool(b.get(k)):
                    errs.append(f"вариант [{a['id']}]: {k} есть только в одной версии")
    for k in HEAD_TEXT:
        if bool(ru.get(k)) != bool(en.get(k)):
            errs.append(f"шапка {k}: есть только в одной версии")
    return [f"{sid}: {e}" for e in errs]


def overlay(item):
    o = {k: item[k] for k in HEAD_TEXT if item.get(k)}
    o["text"] = item.get("text") or []
    if "awake" in item:
        o["awake"] = item["awake"]
    if "after" in item:
        o["after"] = item["after"]
    if item.get("choices"):
        o["choices"] = {c["id"]: {k: c[k] for k in ("label", "hint", "locked") if c.get(k)} for c in item["choices"]}
    return o


def build(g):
    """g — русский граф из qqparse.load(). Возвращает (слой, ошибки)."""
    cfg = g["config"]
    lay = {"scenes": {}, "deaths": {}}
    errs = []
    if not EN.exists():
        return None, [], [], []
    stale, broken = [], []
    for p in sorted(EN.glob("*.md")):
        if p.name.startswith(("_", "._")):
            continue
        try:
            sid, item = parse_file(p, cfg)
        except QQError as e:
            errs.append(f"{p.name}: {e}")
            continue
        src = g["deaths"] if sid.startswith("✝") else g["scenes"]
        if sid not in src:
            errs.append(f"{p.name}: в русской версии нет {sid}")
            continue
        if src[sid].get("file") != p.name:
            errs.append(f"{p.name}: {sid} в русской версии лежит в {src[sid].get('file')}")
        diff = compare(sid, src[sid], item)
        if diff:  # логика разошлась (русскую правили): сцена идёт по-русски, пока перевод не догонят
            broken.append((sid, diff))
            continue
        if item.get("en_status") == "stale" or item.get("src_sha") != src_sha(p.name):
            stale.append(sid)  # текст мог отстать, но логика та же — показываем английский
        lay["deaths" if sid.startswith("✝") else "scenes"][sid] = overlay(item)
    for name in ("_config.json", "_memos.json", "_guides.json"):
        f = EN / name
        if f.exists():
            lay[name[1:-5]] = json.loads(f.read_text(encoding="utf-8"))
    total = len(g["scenes"]) + len(g["deaths"])
    done = len(lay["scenes"]) + len(lay["deaths"])
    lay["missing"] = sorted(set(g["scenes"]) - set(lay["scenes"])) + sorted(set(g["deaths"]) - set(lay["deaths"]))
    lay["stats"] = {"done": done, "total": total}
    lay["stale"] = sorted(stale)
    lay["broken"] = sorted(s for s, _ in broken)
    return lay, errs, stale, broken


def report(g=None, full=False):
    """Для validate.py: предупреждения о недостающих, устаревших и разошедшихся английских сценах.
    Ошибкой не считается — игра откатывается на русский текст. Возвращает число ошибок разбора."""
    if g is None:
        from qqparse import load
        g = load()
    lay, errs, stale, broken = build(g)
    if lay is None:
        print("EN: scenes_en/ нет")
        return 0
    s = lay["stats"]
    print(f"EN: переведено {s['done']} из {s['total']}; устарели {len(stale)}; логика разошлась {len(broken)}; не переведено {len(lay['missing'])}")
    for e in errs:
        print("EN ОШИБКА:", e)
    for sid, diff in broken:
        print(f"⚠️  EN {sid}: логика разошлась с русской — в игре по-русски:", "; ".join(diff[:3]))
    if stale:
        print("⚠️  EN устарели (src_sha ≠ хэш русского файла или en_status: stale):", ", ".join(stale))
    if lay["missing"]:
        m = lay["missing"]
        print(f"⚠️  EN не переведены ({len(m)}):", ", ".join(m if full or len(m) <= 30 else m[:30] + [f"… ещё {len(m) - 30} (--en-all)"]))
    return len(errs)


JS_APPLY = r"""
(function () {
  // слой английских текстов поверх русского графа (tools/build_en.py); непереведённое остаётся русским
  var G = window.GRAPH, L = window.GRAPH_EN_LAYER;
  if (!G || !L) return;
  function put(dst, o) {
    for (var k in o) {
      if (k === "choices") {
        (dst.choices || []).forEach(function (c) { var t = o.choices[c.id]; if (t) for (var j in t) c[j] = t[j]; });
      } else dst[k] = o[k];
    }
  }
  ["scenes", "deaths"].forEach(function (part) {
    for (var id in L[part]) if (G[part][id]) { put(G[part][id], L[part][id]); G[part][id].en = true; }
  });
  var C = G.config, E = L.config || {};
  ["title", "shock_first", "shock_again", "shock_later", "photo_eras"].forEach(function (k) { if (E[k]) C[k] = E[k]; });
  for (var v in (E.vars || {})) if (C.vars[v]) for (var f in E.vars[v]) C.vars[v][f] = E.vars[v][f];
  (E.meta_entries || []).forEach(function (m) { (C.meta_entries || []).forEach(function (x) { if (x.id === m.id) for (var f in m) if (f !== "id") x[f] = m[f]; }); });
  if (E.stihii_names) C.stihii_names = E.stihii_names;
  if (L.memos) for (var m in L.memos) if (G.memos && m.charAt(0) !== "_") G.memos[m] = L.memos[m];
  // путеводитель: названия и подписи шагов — из переведённых сцен; ручные подсказки — из _guides.json
  var GU = L.guides || {};
  for (var fid in (G.guides || {})) {
    var gd = G.guides[fid], sc = G.scenes[fid];
    if (sc && sc.en) gd.title = sc.title;
    if (GU[fid]) { if (GU[fid].hint) gd.hint = GU[fid].hint; if (GU[fid].forks) gd.forks = GU[fid].forks; }
    (gd.steps || []).forEach(function (s) {
      var x = G.scenes[s.scene];
      if (!x || !x.en) return;
      s.title = x.title;
      if (s.choice == null) s.label = "Next";
      else (x.choices || []).forEach(function (c) { if (c.id === s.choice) s.label = c.label; });
    });
  }
  // непереведённые сцены: русский текст с пометкой (откат, чтобы игра не ломалась)
  L.missing.forEach(function (id) { var s = G.scenes[id] || G.deaths[id]; if (s && s.text && id.charAt(0) !== "✝") s.text = [{ md: "This scene hasn't been translated yet, so it's shown in Russian.", kind: "sys" }].concat(s.text); });
  G.en_missing = L.missing; G.en_stats = L.stats; G.lang = "en";
})();
"""


def main(g=None):
    if g is None:
        from qqparse import load
        g = load()
    lay, errs, stale, broken = build(g)
    if lay is None:
        return 0
    for sid, diff in broken:
        print(f"EN ПРЕДУПРЕЖДЕНИЕ: {sid} — логика разошлась с русской, в игре пока по-русски:", "; ".join(d.split(": ", 1)[1] for d in diff[:3]))
    if stale:
        print(f"EN ПРЕДУПРЕЖДЕНИЕ: устарели ({len(stale)}; src_sha не совпадает или en_status: stale):", ", ".join(stale))
    for e in errs:
        print("EN ОШИБКА:", e)
    if errs:
        return 1
    out = ROOT / "game" / "graph_en.js"
    out.write_text("window.GRAPH_EN_LAYER = " + json.dumps(lay, ensure_ascii=False) + ";\n" + JS_APPLY,
                   encoding="utf-8")
    s = lay["stats"]
    print(f"EN: переведено {s['done']} из {s['total']} сцен и смертей → {out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
