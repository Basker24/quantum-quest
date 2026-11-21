// Аудит отклика: флаги, которые ставятся и нигде не читаются; значения флагов, которые ничего не меняют;
// выборы без «После», без видимых fx и ведущие туда же, куда соседние. node tools/audit_echo.js
const fs = require("fs");
global.window = {}; eval(fs.readFileSync(__dirname + "/../game/graph.js", "utf8"));
const G = window.G || Object.values(window)[0];
const sets = {}, reads = {};
const walk = (e, acc) => { if (!e || typeof e !== "object") return; if ((e.op === "var" || e.op === "truthy") && e.n && e.n.startsWith("F_")) acc.add(e.n);
  if (e.op === "cmp" && e.l && e.l.op === "var" && e.l.n && e.l.n.startsWith("F_")) acc.add(e.l.n + "=" + (e.r && e.r.v));
  for (const k of ["a", "l", "r"]) { const x = e[k]; if (Array.isArray(x)) x.forEach((y) => walk(y, acc)); else walk(x, acc); } };
const R = new Set();
const all = { ...G.scenes, ...G.deaths };
for (const [id, s] of Object.entries(all)) {
  for (const b of s.text || []) walk(b.if, R);
  for (const c of s.choices || []) { walk(c.visible, R); for (const o of c.outcomes) walk(o.if, R);
    for (const [k, n, v] of [...(c.fx || []), ...c.outcomes.flatMap((o) => o.fx || [])]) if (k === "set" && n.startsWith("F_")) (sets[n] = sets[n] || []).push(id + "/" + c.id + "=" + v); }
  for (const blks of Object.values(s.after || {})) for (const b of blks) walk(b.if, R);
  if (s.photo_by) for (const f of [].concat(s.photo_by)) R.add(f);
}
const memos = JSON.parse(fs.readFileSync(__dirname + "/../scenes/_memos.json", "utf8"));
console.log("## Флаги, которые ставятся, но нигде не читаются (кроме памяток «Что со мной было»)");
for (const [n, where] of Object.entries(sets)) if (!R.has(n) && ![...R].some((x) => x.startsWith(n + "="))) console.log("-", n, (memos[n] ? "(есть памятка)" : "(нет даже памятки)"), "←", [...new Set(where)].slice(0, 4).join(", "));
console.log("\n## Значения флагов, которые нигде не проверяются (флаг читается, но это значение — нет)");
for (const [n, where] of Object.entries(sets)) {
  if (!R.has(n) && ![...R].some((x) => x.startsWith(n + "="))) continue;
  const vals = [...new Set(where.map((w) => w.split("=")[1]))];
  const checked = new Set([...R].filter((x) => x.startsWith(n + "=")).map((x) => x.split("=")[1]));
  if (R.has(n) || !checked.size) continue; // проверка на истинность — читаются все
  const dead = vals.filter((v) => !checked.has(v) && v !== "undefined" && v !== "true");
  if (dead.length && dead.length < vals.length) console.log("-", n, "=", dead.join(", "));
}
console.log("\n## Выборы без «После», без fx и туда же, куда соседи (последствие игроку не видно)");
for (const [id, s] of Object.entries(G.scenes)) {
  const ch = s.choices || []; if (ch.length < 2) continue;
  const tos = ch.map((c) => c.outcomes.map((o) => o.to).join("|"));
  for (const c of ch) {
    const fx = [...(c.fx || []), ...c.outcomes.flatMap((o) => o.fx || [])];
    const after = s.after && s.after[c.id];
    const same = tos.filter((t) => t === c.outcomes.map((o) => o.to).join("|")).length > 1;
    if (!after && same && c.outcomes.every((o) => !o.to.startsWith("✝"))) console.log("-", id, "[" + c.id + "]", c.label.slice(0, 60), fx.length ? "· fx только " + fx.map((x) => x[1]).join(",") : "· без fx");
  }
}
