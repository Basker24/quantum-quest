// Схема для артефакта «Схема «Тот, кто остался»»: данные — из game/graph.js, оформление и описания жизней — из template.html.
// node tools/scheme/build.js → tools/scheme/index.html
const fs = require("fs"), path = require("path");
const R = path.join(__dirname, "../..");
global.window = {}; eval(fs.readFileSync(R + "/game/graph.js", "utf8"));
const G = window.G || Object.values(window)[0];
let html = fs.readFileSync(__dirname + "/template.html", "utf8");
const grab = (name) => { const i = html.indexOf("const " + name + "="), j = html.indexOf("];", i); return { i, j: j + 2, v: eval(html.slice(i + name.length + 7, j + 1)) }; };
const yr = (d) => ((d || "").match(/\d{4}/) || [""])[0];
const ids = Object.keys(G.scenes), deaths = Object.keys(G.deaths);
const ord = (a, b) => a.localeCompare(b, "ru", { numeric: true });
// ствол
const trunk = ids.filter((i) => /^Т-(0[1-9]|10)/.test(i)).sort(ord).map((i) => [i, G.scenes[i].title, yr(G.scenes[i].date)]);
// ветви
const old = grab("B").v;
const SUBNAME = { "В1.2": "В1.2 «Участок»" };
const B = old.map((b) => {
  const k = b.id, pref = ids.filter((i) => i.startsWith(k + "-") || i.startsWith(k + ".")).map((i) => i.split("-")[0]);
  const groups = [...new Set(pref)].sort(ord);
  const parts = groups.map((g, n) => {
    const sc = ids.filter((i) => i.startsWith(g + "-")).sort(ord);
    const was = b.parts.find((p) => p.t.startsWith(g + " ")) || (n === 0 ? b.parts[0] : null);
    const t = SUBNAME[g] || (was ? was.t : `${g} «${G.scenes[sc[0]].title}»`);
    return { t, st: "r", s: sc.map((i) => [yr(G.scenes[i].date), G.scenes[i].title]) };
  });
  const dn = deaths.filter((d) => d.startsWith("✝" + k + "-") || d.startsWith("✝" + k + ".")).length;
  return { ...b, st: "r", deaths: dn, parts };
});
// финалы и тупики: ветвь — по первой сцене-родителю
const parentBranch = (fid) => { for (const [i, s] of Object.entries(G.scenes)) { const to = [...(s.choices || []).map((c) => c.to), s.next].filter(Boolean); if (to.includes(fid) && /^В/.test(i)) return i.split("-")[0]; } return null; };
const NOTE = { "Ф-04": "секрет", "Ф-06": "только В2.1" };
const fins = ids.filter((i) => G.scenes[i].stage === "final").sort(ord);
const F = fins.filter((i) => i.startsWith("Ф")).map((i) => ["r", i, G.scenes[i].title + (NOTE[i] ? " · " + NOTE[i] : "")]);
F.push(["r", "Ф7", "Наследство · кода В7"]);
// чья это жизнь: тупики входят из якоря, поэтому ветвь задана явно (по старой схеме); новые — по сцене-родителю
const DEADEND = { "⊣К-01": "В1.2", "⊣К-02": "В1", "⊣К-03": "В2.1", "⊣К-04": "В3", "⊣К-06": "В4", "⊣К-07": "В5", "⊣К-08": "В6", "⊣К-10": "В7", "⊣К-11": "В7", "⊣К-12": "дрейф ≥ 90", "⊣К-13": "после якоря, П1", "⊣К-14": "после якоря, П2" };
for (const i of fins.filter((i) => i.startsWith("⊣"))) { const p = DEADEND[i] || parentBranch(i) || "якорь"; F.push(["rk", i, G.scenes[i].title + " · " + p]); }
const put = (name, val) => { const g = grab(name); html = html.slice(0, g.i) + `const ${name}=${JSON.stringify(val)};` + html.slice(g.j); };
put("trunk", trunk); put("B", B); put("F", F);
// цифры и шапка
const photos = fs.readdirSync(R + "/game/img").filter((f) => /\.jpg$/.test(f) && G.scenes[f.replace(/(~.*)?\.jpg$/, "")]).length;
const nFin = fins.filter((i) => i.startsWith("Ф")).length, nDead = fins.length - nFin;
const d = new Date(), M = ["ЯНВАРЯ","ФЕВРАЛЯ","МАРТА","АПРЕЛЯ","МАЯ","ИЮНЯ","ИЮЛЯ","АВГУСТА","СЕНТЯБРЯ","ОКТЯБРЯ","НОЯБРЯ","ДЕКАБРЯ"];
html = html.replace(/<p class="sub">[^<]*<\/p>/, `<p class="sub">СХЕМА ИГРЫ · ${d.getDate()} ${M[d.getMonth()]} ${d.getFullYear()} · ВСЁ ИЗ ТЕКУЩЕЙ СБОРКИ</p>`)
  .replace(/<b>\d+<\/b>сцен/, `<b>${ids.length}</b>сцен`).replace(/<b>\d+<\/b>смертей/, `<b>${deaths.length}</b>смертей`)
  .replace(/<b>[\d +]+<\/b>финалов \+ тупиков/, `<b>${nFin} + ${nDead}</b>финалов + тупиков`)
  .replace(/<b>\d+<\/b>фото \(ствол\)/, `<b>${photos}</b>сцен с картинками`)
  .replace(/<div class="meta">\d+ готово · [^<]*<\/div>/, `<div class="meta">все ${fins.length} готовы · Ф7 — кода к любому финалу</div>`)
  .replace(/<span class="chip r"><small>Я-03<\/small>Тальник<\/span>/, `<span class="chip r"><small>Я-03</small>Тальник — развилка</span>`)
  .replace(/<div class="meta">из Т-10 «Рассвет» — семь жизней/, `<div class="meta">из Т-10 «Рассвет» — восемь жизней`);
// «Вокруг сюжета» — по текущей игре
const chips = ["Смерть → надгробие → шок → откат", "Тетрадь Хора", "«Моя жизнь» в тумане", "«Пути»", "Предметы финалов на столе", "Письмо деда", "Режим «Одна жизнь»", "Картины по эпохам", "Музыка Basker по зонам", "Время в острых сценах", "Эхо и ложное эхо", "«Тело помнит»", "«В другом мире всё было не так»", "Корень как смерть", "Статистика игроков", "Титры", "DLC «Трое до рассвета»"];
html = html.replace(/(<h2>Вокруг сюжета<\/h2><div class="meta">[^<]*<\/div>\s*<div class="row">)[\s\S]*?(<\/div>\s*<\/section>)/, (m, a, b) => a + chips.map((c) => `<span class="chip r">${c}</span>`).join("") + b);
// после якоря: арки П1…П4 колонками, у каждой — сцены и её финалы
const ARC = { "П1": ["«Хозяин»", "волк: остаться в 96-м с тем, что знаешь наперёд", "ДРЕЙФ ≥ 50, или воля ≥ 60 и жалость < 40"], "П2": ["«Дом»", "вернуться в свой 2061-й", "ДРЕЙФ < 40"], "П3": ["«Шов»", "не уходить с шва, Хор в лицах", "ДАР ≥ 70"], "П4": ["«Батя»", "остаться в 96-м своим", "ЭМП ≥ 50 и ДРЕЙФ < 50"] };
const arcs = Object.keys(ARC).map((k) => {
  const sc = ids.filter((i) => i.startsWith(k + "-")).sort(ord);
  const outs = [...new Set(sc.flatMap((i) => [...(G.scenes[i].choices || []).flatMap((c) => c.outcomes.map((o) => o.to)), G.scenes[i].next].filter(Boolean)))].filter((t) => /^[Ф⊣]/.test(t)).sort(ord);
  return `<div class="col r"><h3>${k} ${ARC[k][0]}</h3><div class="tag">из «Тальника» · ${ARC[k][2]}</div><p class="q">${ARC[k][1]}</p><ol>${sc.map((i) => `<li><span>${yr(G.scenes[i].date)}</span>${G.scenes[i].title}</li>`).join("")}</ol><div class="sub2 r">финалы</div><ol>${outs.map((t) => `<li><span>${t.replace("⊣К", "⊣")}</span>${G.scenes[t].title}</li>`).join("")}</ol></div>`;
}).join("");
const afterSec = `<section class="stage part"><h2>После якоря</h2><div class="meta">«Тальник» — развилка: двери зависят от того, кем ты пришёл · ещё дверь «Вбок» → Ф-01 всем</div><div class="branches"><div class="cols">${arcs}</div></div></section>\n\n  `;
html = html.replace(/<section class="stage">\s*<h2>Финалы и тупики<\/h2>/, (m) => afterSec + m);
fs.writeFileSync(__dirname + "/index.html", html);
console.log("scenes", ids.length, "deaths", deaths.length, "finals", nFin, "+", nDead, "photos", photos);
console.log(B.map((b) => b.id + ":" + b.parts.map((p) => p.t.split(" ")[0] + "=" + p.s.length).join(",") + " ✝" + b.deaths).join(" | "));
