// Дашборд проекта: собирает статистику из graph.js и файлов кадров → docs/generated/dashboard.html
// node tools/dashboard.js
const fs = require("fs"), path = require("path"), cp = require("child_process");
const R = path.join(__dirname, "..");
global.window = {}; eval(fs.readFileSync(R + "/game/graph.js", "utf8"));
const G = window.G || Object.values(window)[0];
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const yr = (d) => ((d || "").match(/\d{4}/) || [""])[0];
const ord = (a, b) => a.localeCompare(b, "ru", { numeric: true });

const ids = Object.keys(G.scenes);
const finals = ids.filter((i) => i.startsWith("Ф-")), deads = ids.filter((i) => i.startsWith("⊣"));
const imgDir = R + "/game/img";
const hasImg = (id) => fs.existsSync(path.join(imgDir, id + ".jpg"));
const withImg = ids.filter(hasImg), noImg = ids.filter((i) => !hasImg(i));

const laneOf = (id) => (id.startsWith("⊣") ? "⊣К" : id.startsWith("Ф-") ? "Ф" : id.startsWith("Я-") ? "Я" : id.startsWith("П") ? "П4" : id.split("-")[0]);
const LANES = [["Т", "Детство и ствол"], ["В1", "Как батя"], ["В1.2", "Участок"], ["В2", "Физфак (общая)"], ["В2.1", "Эталон"], ["В2.2", "Сорок два"], ["В3", "Партия"], ["В4", "Сварной"], ["В5", "Куда угодно"], ["В6", "Голоса"], ["В7", "Остаться"], ["Я", "Якорь 2061"], ["П4", "Арка «Батя»"], ["Ф", "Финалы"], ["⊣К", "Тупики"]];
const rows = LANES.map(([l, name]) => {
  const list = ids.filter((i) => laneOf(i) === l);
  const withFrame = list.filter(hasImg).length;
  const deaths = Object.keys(G.deaths).filter((d) => d.startsWith("✝" + l + "-") || (l === "В1.2" && d.startsWith("✝В1.2-"))).length;
  return { l, name, total: list.length, withFrame, deaths };
}).filter((r) => r.total);

let commits = [];
try { commits = cp.execSync("git log -5 --pretty=format:%h%x09%ad%x09%s --date=short", { cwd: R, encoding: "utf8" })
  .split("\n").map((l) => { const [h, d, ...r] = l.split("\t"); return { h, d, s: r.join(" ") }; }); } catch (e) { commits = [{ h: "?", d: "?", s: "git недоступен" }]; }

const bar = (v, max, color) => `<div class="bar"><div class="fill" style="width:${max ? Math.round((v / max) * 100) : 0}%;background:${color}"></div></div>`;
const rowsHtml = rows.map((r) => `<tr><td class="mono">${esc(r.l)}</td><td>${esc(r.name)}</td><td class="num">${r.total}</td><td>${bar(r.withFrame, r.total, "#d9a441")}</td><td class="num">${r.withFrame}</td><td class="num">${r.total - r.withFrame}</td><td class="num">${r.deaths}</td></tr>`).join("");
const noImgList = noImg.sort(ord).map((i) => `<span class="chip">${esc(i)}</span>`).join("");
const commitsHtml = commits.map((c) => `<tr><td class="mono">${esc(c.h)}</td><td class="mono dim">${esc(c.d)}</td><td>${esc(c.s)}</td></tr>`).join("");
const now = new Date().toLocaleString("ru", { timeZone: "Asia/Krasnoyarsk" });

const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Дашборд «Тот, кто остался»</title><link href="https://fonts.googleapis.com/css2?family=PT+Serif&family=PT+Mono&display=swap" rel="stylesheet">
<style>
body{background:#0a0e13;color:#e7e2d6;font:15px/1.5 "PT Serif",Georgia,serif;margin:0;padding:24px 16px 48px;
background-image:radial-gradient(circle at 1px 1px,rgba(143,211,255,.07) 1px,transparent 0);background-size:22px 22px}
.wrap{max-width:1000px;margin:0 auto}h1{font-size:24px;font-weight:400;margin:0}h2{font-size:16px;font-weight:400;color:#d9a441;margin:26px 0 10px}
.mono{font-family:"PT Mono",monospace}.dim{color:#8a93a0}.num{font-family:"PT Mono",monospace;text-align:right;font-variant-numeric:tabular-nums}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin:16px 0 8px}
.card{border:1px solid #2a3542;border-radius:10px;background:#111820;padding:10px 14px}.card b{display:block;font-size:24px;font-variant-numeric:tabular-nums}
.card span{font:11px "PT Mono",monospace;color:#8a93a0}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:6px 8px;border-bottom:1px solid #1d2733;text-align:left;vertical-align:top}
th{font:11px "PT Mono",monospace;color:#8a93a6;text-transform:uppercase;letter-spacing:.05em}
.bar{background:#1d2733;border-radius:4px;height:8px;min-width:60px}.fill{height:8px;border-radius:4px}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{font:11px "PT Mono",monospace;border:1px solid #2a3542;border-radius:5px;padding:3px 7px;color:#c9d4df}
a{color:#d9a441}.foot{font:11px "PT Mono",monospace;color:#5a6b7c;margin-top:26px}
</style></head><body><div class="wrap">
<h1>Дашборд «Тот, кто остался»</h1>
<p class="mono dim">собрано ${esc(now)} (Кемерово) · node tools/dashboard.js</p>
<div class="cards">
<div class="card"><b>${ids.length}</b><span>сцены</span></div>
<div class="card"><b>${Object.keys(G.deaths).length}</b><span>смерти</span></div>
<div class="card"><b>${finals.length}</b><span>финалы</span></div>
<div class="card"><b>${deads.length}</b><span>тупики</span></div>
<div class="card"><b>${Object.keys(G.guides || {}).length}/26</b><span>маршруты-свидетели</span></div>
<div class="card"><b>${withImg.length}</b><span>сцен с кадрами</span></div>
<div class="card"><b>${noImg.length}</b><span>без кадров</span></div>
</div>
<h2>Прогресс по ветвям</h2>
<table><tr><th>ID</th><th>Ветвь</th><th>Сцен</th><th>Кадры</th><th>С</th><th>Без</th><th>✝</th></tr>${rowsHtml}</table>
<h2>Сцены без кадров (${noImg.length})</h2>
<div class="chips">${noImgList}</div>
<h2>Последние коммиты</h2>
<table>${commitsHtml}</table>
<p class="foot">играть: https://quantum-quest-940t.zai-ai.site · аудит 17.11: закрыт (ИТОГИ-2026-11-17.md) · грант Президента 2027: черновик (docs/grants/)</p>
</div></body></html>`;
const out = path.join(R, "docs", "generated", "dashboard.html");
fs.writeFileSync(out, html);
console.log("дашборд:", out, `(${ids.length} сцен, ${noImg.length} без кадров)`);
