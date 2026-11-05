/* Тот, кто остался — движок. Без рандома: всё решают переменные и выборы.
   Анимация фона детерминированная (псевдошум от времени), на ход игры не влияет. */
(() => {
  "use strict";
  const G = window.GRAPH, C = G.config;
  const $ = (s) => document.querySelector(s);
  const DEBUG = /[?&]debug/.test(location.search);
  const SAVE = "qq_save_v1", META = "qq_meta_v1";
  const REDUCED = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- хранилище (может быть недоступно)
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* без сохранений */ } },
  };
  // мета — сквозная для всех жизней: Хор, схема, увиденное
  let meta = Object.assign({ journal: {}, lives: 0, root: false, visited: {}, taken: {}, shown: {}, extra: {}, guide: {} }, store.get(META, {}));
  meta.guide = meta.guide || {};
  let guideOn = null; // финал, чей путь подсвечен на схеме
  const saveMeta = () => store.set(META, meta);
  let S = null; // текущая жизнь

  // ---------- выражения (AST собирает tools/build.py)
  function ev(e, st) {
    switch (e.op) {
      case "num": case "lit": return e.v;
      case "var": return st[e.n] ?? null;
      case "truthy": return !!st[e.n];
      case "not": return !ev(e.a, st);
      case "and": return e.a.every((x) => ev(x, st));
      case "or": return e.a.some((x) => ev(x, st));
      case "seen": return e.life ? !!(S && S.lifeSeen[e.id]) : !!meta.journal[e.id];
      case "cmp": {
        const l = ev(e.l, st), r = ev(e.r, st);
        if (e.c === "==") return l === r;
        if (e.c === "!=") return l !== r;
        const a = l || 0, b = r || 0;
        return e.c === ">=" ? a >= b : e.c === "<=" ? a <= b : e.c === ">" ? a > b : a < b;
      }
    }
    throw new Error("op " + e.op);
  }
  const ok = (e, st) => !e || ev(e, st);

  function initState() {
    const st = {};
    for (const [k, v] of Object.entries(C.vars)) st[k] = v.start;
    for (const k of Object.keys(C.flags)) st[k] = null;
    return st;
  }
  function applyFx(fx, st) {
    for (const [kind, name, val] of fx) {
      if (kind === "add") { const v = C.vars[name]; st[name] = Math.max(v.min, Math.min(v.max, st[name] + val)); }
      else if (kind === "cap") st[name] = Math.min(st[name], val);
      else st[name] = val;
    }
  }
  const depthFor = (dar) => C.rollback.reduce((d, [lo, n]) => (dar >= lo ? n : d), 1);
  const sealOf = (sc) => C.seal_groups[sc.stage] || sc.stage;
  const tier = (name, val) => { const t = C.vars[name].tiers; let w = t[0][1]; for (const [lo, word] of t) if (val >= lo) w = word; return w; };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>").replace(/\n/g, "<br>");
  const yearOf = (d) => { const m = /(\d{4})/.exec(d || ""); return m ? m[1] : null; };
  const WORDS = ["", "один шаг", "два шага", "три шага", "четыре шага", "пять шагов"];
  const LETTERS = "АБВГДЕЖЗ";
  const hash = (n) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

  // ---------- экраны
  const screens = ["#title", "#chapter", "#scene", "#death", "#awake", "#rewind", "#flow", "#journal", "#me", "#howto", "#about", "#guide"];
  let back = "#title";
  function show(id) {
    for (const s of screens) $(s).hidden = s !== id;
    $("#bar").hidden = id !== "#scene";
    document.body.dataset.screen = id.slice(1);
    bgMode(id === "#title" ? "title" : id === "#scene" || id === "#chapter" ? "dust" : "off");
    window.scrollTo(0, 0);
  }

  // ---------- жизнь
  function newLife() {
    meta.lives = (meta.lives || 0) + 1; saveMeta();
    S = { scene: C.start, st: initState(), stack: [], lifeSeen: {}, awake: null, ghost: null, year: null };
    enter(C.start);
  }
  const save = () => store.set(SAVE, S);
  const visible = (sc, st) => (sc.choices || []).filter((c) => ok(c.visible, st));

  function enter(id, restored) {
    const sc = G.scenes[id];
    S.scene = id;
    meta.visited[id] = true;
    if (id === "Т-02б") meta.root = true;
    for (const m of C.meta_entries || []) if (m.scene === id && ok(m.if, S.st)) meta.extra[m.id] = true;
    saveMeta();
    if (!restored && visible(sc, S.st).length >= 2) S.stack.push({ scene: id, st: clone(S.st), seal: sealOf(sc), taken: null });
    const y = yearOf(sc.date);
    const newYear = y && y !== S.year;
    if (y) S.year = y;
    save();
    if (newYear && !restored) chapter(sc, () => render(sc));
    else render(sc);
  }

  // ---------- карточка главы: ракорд киноплёнки 3-2-1 и год
  let chTimer = null;
  function chapter(sc, done) {
    show("#chapter");
    $("#ch-year").textContent = yearOf(sc.date);
    $("#ch-age").textContent = sc.age != null ? `мне ${sc.age}` : "";
    $("#ch-title").textContent = sc.title || "";
    document.body.dataset.era = sc.photo || "none";
    const cnt = $("#ch-count");
    let n = 3;
    const finish = () => { clearTimeout(chTimer); chTimer = null; $("#chapter").onclick = null; done(); };
    $("#chapter").onclick = finish;
    const tick = () => {
      cnt.textContent = n; cnt.classList.remove("pulse"); void cnt.offsetWidth; cnt.classList.add("pulse");
      if (n-- <= 1) { chTimer = setTimeout(finish, REDUCED ? 700 : 900); return; }
      chTimer = setTimeout(tick, REDUCED ? 250 : 420);
    };
    tick();
  }

  // ---------- сцена
  let typing = null;
  function render(sc) {
    show("#scene");
    const st = S.st;
    document.body.dataset.drift = Math.min(4, Math.floor((st["ДРЕЙФ"] || 0) / 20));
    document.body.dataset.era = sc.photo || "none";
    renderPhoto(sc);
    $("#meta").textContent = [sc.date, sc.age != null ? `мне ${sc.age}` : "", DEBUG ? S.scene : ""].filter(Boolean).join(" · ");
    $("#when").textContent = sc.date || "";

    const blocks = [];
    if (S.awake) { for (const b of S.awake) if (ok(b.if, st)) blocks.push({ md: b.md, cls: "awake" }); S.awake = null; }
    let first = true;
    for (const b of sc.text) {
      if (!ok(b.if, st)) continue;
      if (b.kind === "chorus") { chorusLines().forEach((l) => blocks.push({ md: l, cls: "chorus talk" })); continue; }
      if (b.kind === "norewind") { blocks.push({ md: "", cls: "norewind" }); continue; }
      const talk = /^—\s/.test(b.md);
      const cls = [b.drift ? "drift" : "", b.kind || "", talk ? "talk" : ""];
      if (first && !b.kind && !talk) { cls.push("first"); first = false; }
      blocks.push({ md: b.md, cls: cls.join(" ").trim() });
    }
    const art = $("#text"); art.innerHTML = "";
    $("#choices").innerHTML = "";
    const els = blocks.map((b) => { const p = document.createElement("p"); p.className = b.cls; p.innerHTML = md(b.md); p.classList.add("pending"); art.append(p); return p; });
    // «последний откат, которого нет»: привычная лента, которая рассыпается
    els.filter((p) => p.classList.contains("norewind")).forEach((p) => {
      p.innerHTML = `<button class="choice notch nr-btn"><span class="mono">◀◀</span> Хор помнит…</button>`;
      p.querySelector("button").onclick = (e) => {
        e.stopPropagation();
        p.classList.add("crumble");
        setTimeout(() => { p.innerHTML = `<span class="mono nr-end">Отката нет. И не надо.</span>`; }, REDUCED ? 50 : 1600);
      };
    });
    const finish = () => { clearTimeout(typing); typing = null; els.forEach((p) => p.classList.remove("pending")); renderChoices(sc); };
    let i = 0;
    const step = () => { if (i >= els.length) return finish(); els[i].classList.remove("pending"); i++; typing = setTimeout(step, REDUCED ? 60 : 420); };
    art.onclick = () => typing && finish();
    step();
  }

  // голоса Рыбаков на якоре: эпитафии смертей, которые видел именно этот игрок
  function chorusLines() {
    // голоса от первого лица, в порядке смертей; первая смерть звучит всегда, остальные — равномерно
    const seen = Object.entries(G.deaths).filter(([id, d]) => meta.journal[id] && d.epitaph)
      .sort((a, b) => String(meta.journal[a[0]].first).localeCompare(String(meta.journal[b[0]].first)));
    if (!seen.length) return ["Рыбаки молчат. Я почти никого из них не знаю, и они меня, кажется, тоже."];
    const voice = (ep) => {
      const m = /^(\d+)\s+(год|года|лет)\.\s*(.*)$/.exec(ep);
      return "— " + (m ? `Мне было ${m[1]}. ${m[3]}` : ep);
    };
    const N = 7, pick = [];
    if (seen.length <= N) pick.push(...seen);
    else for (let i = 0; i < N; i++) pick.push(seen[Math.round(i * (seen.length - 1) / (N - 1))]);
    return pick.map(([, d]) => voice(d.epitaph));
  }

  function renderPhoto(sc) {
    const ph = $("#photo");
    ph.className = "photo era-" + (sc.photo || "none");
    ph.innerHTML = "";
    if (!sc.photo) return;
    const img = new Image();
    img.alt = sc.photo_caption || "";
    img.onerror = () => { img.remove(); ph.classList.add("empty"); };
    img.src = "img/" + encodeURIComponent(sc.id || S.scene) + ".jpg";
    const cap = document.createElement("figcaption");
    cap.textContent = sc.photo_caption || "";
    const holder = document.createElement("div");
    holder.className = "placeholder";
    holder.innerHTML = `<span>место для фото</span><small>${esc(C.photo_eras[sc.photo] || "")}</small>`;
    ph.append(img, holder, cap);
    if (sc.photo === "color" || sc.photo === "bw") {
      const stamp = document.createElement("span");
      stamp.className = "stamp mono";
      stamp.textContent = dateStamp(sc.date);
      ph.append(stamp);
    }
    if (sc.photo === "digital" || sc.photo === "phone") {
      const osd = document.createElement("span");
      osd.className = "osd mono";
      osd.textContent = sc.photo === "digital" ? "▮▮▮  IMG_" + String(1000 + Math.floor(hash(sc.id.length * 7 + sc.id.charCodeAt(2)) * 8999)) : "● ●";
      ph.append(osd);
    }
  }

  function dateStamp(date) {
    const m = /(\d{1,2})\s+(\S+)\s+(\d{4})/.exec(date || "");
    const months = { января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6, июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12 };
    if (m) return `'${m[3].slice(2)}  ${months[m[2]] || ""}  ${m[1]}`;
    const y = yearOf(date);
    return y ? `'${y.slice(2)}` : "";
  }

  function renderChoices(sc) {
    const nav = $("#choices"); nav.innerHTML = "";
    const st = S.st;
    const top = S.stack[S.stack.length - 1];
    const ghost = S.ghost; S.ghost = null;
    const vis = visible(sc, st);
    meta.shown[S.scene] = meta.shown[S.scene] || {};
    vis.forEach((c, i) => {
      meta.shown[S.scene][c.id] = true;
      const b = document.createElement("button");
      b.className = "choice";
      b.style.setProperty("--i", i);
      b.innerHTML = `<span class="num mono">${LETTERS[i] || i + 1}</span><span class="lbl">${md(c.label)}</span>`;
      if (ghost && ghost === c.id && top && top.scene === S.scene) {
        b.classList.add("ghosted");
        b.insertAdjacentHTML("beforeend", `<small>в другом мире я выбрал это</small>`);
      }
      if (c.visible && /seen/.test(JSON.stringify(c.visible))) b.classList.add("echo");
      if (DEBUG) b.insertAdjacentHTML("beforeend", `<small class="mono dbg">[${c.id}] ${esc(c.outcomes.map((o) => (o.if_src ? o.if_src + " → " : "") + o.to).join(" | "))}</small>`);
      b.onclick = () => choose(sc, c);
      nav.append(b);
    });
    // закрытые варианты: текст не показываем, только чего не хватило
    for (const c of sc.choices || []) {
      if (!c.visible || ok(c.visible, st) || /seen/.test(JSON.stringify(c.visible))) continue;
      const b = document.createElement("button");
      b.className = "choice locked"; b.disabled = true;
      b.innerHTML = `<span class="num mono">·</span><span class="lbl">— — —</span><small>${esc(lockReason(c.visible, st))}</small>`;
      nav.append(b);
    }
    saveMeta();
    if (!vis.length && sc.next) {
      const b = document.createElement("button");
      b.className = "choice next"; b.textContent = "Дальше";
      b.onclick = () => enter(sc.next);
      nav.append(b);
    }
    if (!vis.length && !sc.next) {
      nav.insertAdjacentHTML("beforeend", `<p class="progress mono tiny">${progressLine()}</p>`);
      const j = document.createElement("button");
      j.className = "choice ghost-choice"; j.textContent = "Открыть Хор";
      j.onclick = () => openPanel("#journal");
      const f = document.createElement("button");
      f.className = "choice ghost-choice"; f.textContent = "Открыть схему";
      f.onclick = () => openPanel("#flow");
      const b = document.createElement("button");
      b.className = "choice"; b.textContent = "Новая жизнь";
      b.onclick = newLife;
      nav.append(b, j, f);
    }
    renderDebug();
  }

  // почему вариант закрыт — словами, без цифр
  const LACK = { ТЕЛ: "силы", РАЗ: "ума", ЭМП: "чуткости", ВОЛ: "воли", ДАР: "дара" };
  const TOO = { ТЕЛ: "сил", РАЗ: "ума", ЭМП: "чуткости", ВОЛ: "упрямства", ДАР: "дара" };
  function lockReason(e, st) {
    const need = new Set(), too = new Set(); let flags = false, bond = false, drift = false;
    (function walk(x, neg) {
      if (!x || typeof x !== "object") return;
      if (x.op === "not") return walk(x.a, !neg);
      if (x.op === "and" || x.op === "or") { for (const y of x.a) if (!ev(y, st) !== neg || x.op === "or") walk(y, neg); return; }
      if (ev(x, st) !== neg) return; // эта часть условия выполнена
      if (x.op === "cmp" && x.l.op === "var" && x.r.op === "num" && C.vars[x.l.n]) {
        const n = x.l.n, up = (x.c === ">=" || x.c === ">") !== neg;
        if (n === "ДРЕЙФ") drift = true; else if (n.startsWith("СВЯЗЬ")) bond = true;
        else (up ? need : too).add(n);
      } else flags = true;
    })(e, false);
    const parts = [];
    const j = e.op === "or" ? " или " : " и ";
    if (need.size) parts.push("не хватает " + [...need].map((n) => LACK[n] || n).join(j));
    if (too.size) parts.push("слишком много " + [...too].map((n) => TOO[n] || n).join(" и "));
    if (bond) parts.push("не хватает близости");
    if (drift) parts.push("мир слишком сдвинулся");
    if (flags && !parts.length) parts.push("в этой жизни этого не было");
    return parts.join(" · ") || "закрыто";
  }

  function choose(sc, c) {
    const st = S.st;
    const o = c.outcomes.find((x) => ok(x.if, st));
    const top = S.stack[S.stack.length - 1];
    if (top && top.scene === S.scene) top.taken = c.id;
    meta.taken[S.scene] = meta.taken[S.scene] || {};
    meta.taken[S.scene][c.id] = true;
    saveMeta();
    if (o.to.startsWith("✝")) return die(o.to);
    const next = clone(st);
    applyFx(c.fx, next);
    if (o.fx) applyFx(o.fx, next);
    const after = sc.after && sc.after[c.id];
    if (after) return showAfter(c, after.filter((b) => ok(b.if, next)), () => { S.st = next; enter(o.to); });
    S.st = next;
    enter(o.to);
  }

  // ---------- «что было дальше»: последствие выбора сразу, на том же экране
  function showAfter(c, blocks, go) {
    const nav = $("#choices"); nav.innerHTML = "";
    const art = $("#text");
    const picked = document.createElement("p");
    picked.className = "picked mono";
    picked.innerHTML = "▸ " + md(c.label);
    art.append(picked);
    const els = blocks.map((b) => {
      const p = document.createElement("p");
      p.className = ["after", b.kind || "", /^—\s/.test(b.md) ? "talk" : ""].join(" ").trim();
      p.innerHTML = md(b.md); p.classList.add("pending"); art.append(p); return p;
    });
    picked.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });
    const done = () => {
      clearTimeout(typing); typing = null;
      els.forEach((p) => p.classList.remove("pending"));
      const b = document.createElement("button");
      b.className = "choice next"; b.textContent = "Дальше";
      b.onclick = go;
      nav.append(b);
    };
    let i = 0;
    const step = () => { if (i >= els.length) return done(); els[i].classList.remove("pending"); i++; typing = setTimeout(step, REDUCED ? 60 : 520); };
    art.onclick = () => typing && done();
    step();
  }

  // ---------- смерть: сама смерть → надгробие → шок пробуждения → (если можно глубже) лента отката
  function die(did) {
    const d = G.deaths[did];
    const first = Object.keys(S.lifeSeen).length === 0;
    S.lifeSeen[did] = true;
    const j = meta.journal[did] || { times: 0, first: new Date().toISOString(), life: meta.lives };
    j.times++; meta.journal[did] = j; saveMeta();
    save();
    show("#death");
    $("#death-tc").textContent = (d.date || "").toUpperCase();
    const art = $("#death-text"); art.innerHTML = "";
    const blocks = d.text.filter((b) => ok(b.if, S.st));
    const btn = $("#btn-death-next"); btn.hidden = true;
    let i = 0;
    const step = () => {
      if (i < blocks.length) { const p = document.createElement("p"); p.innerHTML = md(blocks[i].md); art.append(p); i++; setTimeout(step, REDUCED ? 100 : 1000); return; }
      // надгробие: чтобы не оставалось сомнений, что это была смерть
      art.insertAdjacentHTML("beforeend", `<div class="tomb">
        <div class="tomb-cross">✝</div>
        <div class="tomb-name">Андрей Николаевич Самохин</div>
        <div class="tomb-years mono">1989 — ${esc(yearOf(d.date) || "")}</div>
        <p class="tomb-epitaph">${esc(d.epitaph || "")}</p>
        ${d.mourner ? `<p class="tomb-mourner"><span class="mono">в том мире</span> ${esc(d.mourner)}</p>` : ""}
      </div>`);
      setTimeout(() => { btn.hidden = false; btn.textContent = "…"; btn.onclick = () => awaken(did, first); }, REDUCED ? 100 : 1400);
    };
    setTimeout(step, REDUCED ? 50 : 700);
  }

  function rewindOptions() {
    const depth = depthFor(S.st["ДАР"] || 0);
    const cur = G.scenes[S.scene];
    if (!S.stack.length || S.stack[S.stack.length - 1].scene !== S.scene) S.stack.push({ scene: S.scene, st: clone(S.st), seal: sealOf(cur), taken: null });
    const opts = [];
    const sealNow = S.stack[S.stack.length - 1].seal;
    for (let k = 0; k < depth; k++) {
      const idx = S.stack.length - 1 - k;
      if (idx < 0 || S.stack[idx].seal !== sealNow) break;
      opts.push(idx);
    }
    return { depth, opts };
  }

  function restore(idx, n) {
    const snap = S.stack[idx];
    S.stack = S.stack.slice(0, idx + 1);
    S.st = clone(snap.st);
    S.awake = n === 0
      ? [{ md: "Та же минута. Только теперь я знаю, чем она кончается." }]
      : [{ md: "…и я снова здесь, на несколько шагов раньше. Тело ещё помнит, как умирало, а голова уже прикидывает, где я ошибся." }];
    S.ghost = snap.taken;
    enter(snap.scene, true);
  }

  // шок: герой стоит живой за минуту до смерти и помнит её, как воспоминание
  function awaken(did, first) {
    const d = G.deaths[did];
    show("#awake");
    $("#awake-tc").textContent = (G.scenes[S.scene].date || "").toUpperCase();
    const art = $("#awake-text"); art.innerHTML = "";
    const nav = $("#awake-btns"); nav.innerHTML = "";
    // порядок: возвращение в ту же минуту → шок (первая смерть в жизни — длинный) → конкретная память этой смерти
    const own = (d.awake || []).filter((b) => ok(b.if, S.st));
    const paras = [];
    if (own[0]) paras.push({ md: own[0].md, cls: "back" });
    ((first ? C.shock_first : C.shock_again) || []).forEach((s) => paras.push({ md: s, cls: "shock" }));
    own.slice(1).forEach((b) => paras.push({ md: b.md, cls: "" }));
    const els = paras.map((x) => { const p = document.createElement("p"); p.className = x.cls; p.innerHTML = md(x.md); p.classList.add("pending"); art.append(p); return p; });
    let finished = false, startT = null;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(startT); clearTimeout(typing); typing = null;
      els.forEach((p) => p.classList.remove("pending"));
      const { depth, opts } = rewindOptions();
      if (opts.length <= 1) {
        const b = document.createElement("button");
        b.className = "choice"; b.textContent = "Вдохнуть";
        b.onclick = () => restore(opts[0], 0);
        nav.append(b);
      } else {
        const s = document.createElement("button");
        s.className = "choice"; s.textContent = "Вдохнуть и остаться в этой минуте";
        s.onclick = () => restore(opts[0], 0);
        const b = document.createElement("button");
        b.className = "choice ghost-choice"; b.innerHTML = `<span class="lbl">Хор помнит больше. Вернуться ещё дальше назад</span>`;
        b.onclick = () => showTape(depth, opts);
        nav.append(s, b);
      }
    };
    let i = 0;
    const step = () => { if (finished) return; if (i >= els.length) return done(); els[i].classList.remove("pending"); i++; typing = setTimeout(step, REDUCED ? 60 : 1100); };
    art.onclick = done;
    startT = setTimeout(step, REDUCED ? 30 : 500);
  }

  // ---------- лента отката
  function showTape(depth, opts) {
    show("#rewind");
    $("#rew-depth").textContent = WORDS[opts.length] || "";
    const tape = $("#tape"); tape.innerHTML = "";
    opts.forEach((idx, n) => {
      const snap = S.stack[idx];
      const sc = G.scenes[snap.scene];
      const b = document.createElement("button");
      b.className = "notch choice";
      b.innerHTML = `<span class="mono">${"◀".repeat(n + 1)}</span> ${esc(sc.title || snap.scene)}<small class="mono">${esc(sc.date || "")}</small>`;
      b.onclick = () => restore(idx, n);
      tape.append(b);
    });
    tape.insertAdjacentHTML("beforeend", `<p class="dim tiny mono">${opts.length < depth ? "дальше лента засвечена" : "дальше Хор не помнит"}</p>`);
  }

  // ---------- панели
  function openPanel(id) {
    // запоминаем, откуда пришли; из панели в панель — «назад» остаётся прежним
    if (!$("#scene").hidden) back = "#scene";
    else if (!$("#title").hidden) back = "#title";
    renderPanels();
    show(id);
    if (id === "#flow") renderFlow();
    if (id === "#guide") renderGuide();
  }

  // ---------- итог: сколько открыто
  function progressLine() {
    const ids = Object.keys(G.scenes);
    const ends = ids.filter((id) => G.scenes[id].stage === "final");
    const seenS = ids.filter((id) => meta.visited[id]).length;
    const seenE = ends.filter((id) => meta.visited[id]).length;
    const deaths = Object.keys(G.deaths), seenD = deaths.filter((id) => meta.journal[id]).length;
    return `Открыто сцен: ${seenS} из ${ids.length} · концовок: ${seenE} из ${ends.length} · смертей: ${seenD} из ${deaths.length}`;
  }

  // ---------- путеводитель: три ступени подсказок к каждому финалу
  function renderGuide() {
    const list = $("#guide-list"); list.innerHTML = "";
    const gs = G.guides || {};
    let n = 0;
    for (const [fid, g] of Object.entries(gs)) {
      n++;
      const done = !!meta.visited[fid];
      const locked = g.secret && !done && !(g.gate && meta.visited[g.gate]);
      const lvl = meta.guide[fid] || 0;
      const card = document.createElement("div");
      card.className = "gcard" + (done ? " done" : "") + (locked ? " locked" : "");
      let h = `<div class="ghead"><span class="mono gnum">${String(n).padStart(2, "0")}</span><b>${locked ? "Секрет" : esc(g.title)}</b><span class="mono dim">${locked ? "????" : esc(g.year)}</span>${done ? `<span class="gdone mono">пройдено</span>` : ""}</div>`;
      if (locked) h += `<p class="dim tiny">Это утро откроется, когда ты хотя бы раз дойдёшь до тальника у заводи.</p>`;
      else {
        if (lvl >= 1) h += `<p class="ghint">${md(g.hint)}</p>`;
        if (lvl >= 2) h += `<ul class="gforks">${g.forks.map((f) => `<li>${md(f)}</li>`).join("")}</ul>`;
        if (lvl >= 3) h += `<ol class="gsteps">${g.steps.filter((s) => s.choice).map((s) => `<li${s.death ? ' class="gdeath"' : ""}><span class="mono dim">${esc(s.year)}</span> ${esc(s.title)} → «${esc(s.label)}»${s.death ? " <i>умереть и вернуться</i>" : ""}</li>`).join("")}</ol>`;
        if (!g.found) h += `<p class="dim tiny">Дорога сюда пока не построена.</p>`;
        const labels = ["Подсказка: каким стать", "Главные развилки", "Весь путь"];
        h += `<div class="gbtns">`;
        if (lvl < 3 && g.found) h += `<button class="choice ghost-choice gmore">${labels[lvl]}</button>`;
        if (lvl >= 3) h += `<button class="choice ghost-choice gflow">Показать на схеме</button>`;
        h += `</div>`;
      }
      card.innerHTML = h;
      const more = card.querySelector(".gmore");
      if (more) more.onclick = () => { meta.guide[fid] = lvl + 1; saveMeta(); renderGuide(); };
      const fl = card.querySelector(".gflow");
      if (fl) fl.onclick = () => { guideOn = fid; openPanel("#flow"); };
      list.append(card);
    }
    if (!n) list.innerHTML = `<p class="dim">Путеводитель пока пуст.</p>`;
  }
  function closePanel() { if (back === "#scene" && S) show("#scene"); else showTitle(); }

  function renderPanels() {
    // Тетрадь Хора
    const list = $("#journal-list"); list.innerHTML = "";
    const row = (n, when, how, who, cls = "") =>
      `<div class="nb-row ${cls}"><span class="nb-n">${n}</span><span class="nb-when">${when}</span><span class="nb-how">${how}</span><span class="nb-who">${who}</span></div>`;
    let any = false;
    if (meta.root) { any = true; list.insertAdjacentHTML("beforeend", row("0", "28.07.1996<br>около полудня", "Чёрная заводь. Утонул в семь лет. Вытащили через 252 секунды.", "Ника считала вслух.", "root")); }
    for (const m of C.meta_entries || []) if (meta.extra[m.id]) { any = true; list.insertAdjacentHTML("beforeend", row("·", esc(m.date), `<b>${esc(m.title)}</b><br>${esc(m.text)}`, "—", "echo")); }
    const seenSt = new Set();
    let n = 1;
    for (const [id, d] of Object.entries(G.deaths)) {
      const j = meta.journal[id];
      if (!j) continue;
      any = true;
      if (d.stihia) seenSt.add(d.stihia);
      const [day, time] = String(d.date || "").split(",");
      list.insertAdjacentHTML("beforeend", row(n++, `${esc(day)}${time ? "<br>" + esc(time.trim()) : ""}`, esc(d.epitaph), esc(d.mourner)) );
    }
    if (!any) list.innerHTML = `<p class="nb-empty">Тетрадь пока пустая.</p>`;
    $("#stihii").innerHTML = C.stihii.map((s) => `<span class="${seenSt.has(s) ? "on" : ""}" title="${s.toLowerCase()}">●</span>`).join(" ");
    // Я
    const me = $("#me-list"); me.innerHTML = "";
    if (S) for (const [k, v] of Object.entries(C.vars)) {
      if (v.hidden) continue;
      me.insertAdjacentHTML("beforeend", `<div class="row"><span>${esc(v.name)}</span><b>${esc(tier(k, S.st[k]))}</b></div>`);
    }
    if (S) {
      // «Что со мной было»: поднятые флаги словами героя
      const items = [];
      for (const [f, m] of Object.entries(G.memos || {})) {
        const v = S.st[f];
        if (!m || v === null || v === undefined || v === false) continue;
        const t = typeof m === "string" ? m : m[v];
        if (t) items.push(t);
      }
      if (items.length) me.insertAdjacentHTML("beforeend", `<h3 class="memo-h">Что со мной было</h3><ul class="memo">${items.map((t) => `<li>${md(t)}</li>`).join("")}</ul><p class="dim tiny">Это помнит не только тот, кто это пережил. Это помнит сюжет.</p>`);
    }
    if (!S) me.innerHTML = `<p class="dim">Жизнь ещё не начата.</p>`;
    renderDebug();
  }
  function renderDebug() {
    const dbg = $("#debug");
    if (!DEBUG || !S) return;
    dbg.hidden = false;
    dbg.textContent = Object.entries(S.st).filter(([, v]) => v !== null).map(([k, v]) => `${k}=${v}`).join("  ") + `  | стек: ${S.stack.map((s) => s.scene).join(" › ")}`;
  }

  // ---------- схема ветвлений
  function layout() {
    const ids = Object.keys(G.scenes);
    const kids = {};
    for (const id of ids) {
      const sc = G.scenes[id];
      const out = new Set(sc.next ? [sc.next] : []);
      for (const c of sc.choices || []) for (const o of c.outcomes) if (G.scenes[o.to]) out.add(o.to);
      kids[id] = [...out];
    }
    // ранг — самый длинный путь от старта (граф ацикличен)
    const rank = { [C.start]: 0 }, order = [];
    const indeg = {}; ids.forEach((i) => (indeg[i] = 0));
    ids.forEach((i) => kids[i].forEach((k) => indeg[k]++));
    const q = ids.filter((i) => indeg[i] === 0);
    while (q.length) {
      const v = q.shift(); order.push(v);
      for (const k of kids[v]) {
        if (rank[v] != null) rank[k] = Math.max(rank[k] ?? 0, rank[v] + 1);
        if (--indeg[k] === 0) q.push(k);
      }
    }
    const rows = {};
    for (const id of order) if (rank[id] != null) (rows[rank[id]] = rows[rank[id]] || []).push(id);
    return { kids, rank, rows };
  }

  // ---------- зум и перетаскивание схемы (прокрутка в обе стороны — сам #flow-wrap)
  let flowZoom = 1, flowSize = { w: 1, h: 1 };
  function setFlowZoom(z, cx, cy) {
    const wrap = $("#flow-wrap"), svg = $("#flow-canvas svg");
    if (!svg) return;
    z = Math.max(0.25, Math.min(2.5, z));
    const r = wrap.getBoundingClientRect();
    const px = cx == null ? wrap.clientWidth / 2 : cx - r.left, py = cy == null ? wrap.clientHeight / 2 : cy - r.top;
    const ux = (wrap.scrollLeft + px) / flowZoom, uy = (wrap.scrollTop + py) / flowZoom;
    flowZoom = z;
    svg.setAttribute("width", flowSize.w * z); svg.setAttribute("height", flowSize.h * z);
    wrap.scrollLeft = ux * z - px; wrap.scrollTop = uy * z - py;
  }
  (function initFlowZoom() {
    const wrap = $("#flow-wrap");
    $("#z-in").onclick = () => setFlowZoom(flowZoom * 1.25);
    $("#z-out").onclick = () => setFlowZoom(flowZoom / 1.25);
    $("#z-fit").onclick = () => setFlowZoom(Math.min(wrap.clientWidth / flowSize.w, wrap.clientHeight / flowSize.h, 1));
    wrap.addEventListener("wheel", (e) => { if (!e.ctrlKey) return; e.preventDefault(); setFlowZoom(flowZoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX, e.clientY); }, { passive: false });
    const pts = new Map(); let pinch = null, drag = null;
    wrap.addEventListener("pointerdown", (e) => {
      pts.set(e.pointerId, e);
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: flowZoom }; drag = null; }
      else { drag = { x: e.clientX, y: e.clientY, l: wrap.scrollLeft, t: wrap.scrollTop }; wrap.classList.add("grab"); }
    });
    wrap.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, e);
      if (pinch && pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); setFlowZoom(pinch.z * d / pinch.d, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2); }
      else if (drag) { wrap.scrollLeft = drag.l - (e.clientX - drag.x); wrap.scrollTop = drag.t - (e.clientY - drag.y); }
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; drag = null; wrap.classList.remove("grab"); };
    wrap.addEventListener("pointerup", up); wrap.addEventListener("pointercancel", up); wrap.addEventListener("pointerleave", up);
  })();

  function renderFlow() {
    const { kids, rows } = layout();
    const visited = meta.visited, taken = meta.taken, shown = meta.shown;
    const life = new Set(S ? [...S.stack.map((s) => s.scene), S.scene] : []);
    const frontier = new Set();
    for (const id of Object.keys(visited)) for (const k of kids[id] || []) if (!visited[k]) frontier.add(k);
    const gp = guideOn && G.guides && G.guides[guideOn];
    const gScenes = new Set(gp ? [...gp.steps.map((s) => s.scene), guideOn] : []);
    const gChoice = {}; if (gp) for (const s of gp.steps) if (s.choice && !s.death) gChoice[s.scene] = s.choice;
    const showNode = (id) => visited[id] || frontier.has(id) || gScenes.has(id);
    const W = 176, H = 92, GX = 26, GY = 70, PAD = 24;
    const pos = {};
    let maxW = 0, y = PAD;
    const rankKeys = Object.keys(rows).map(Number).sort((a, b) => a - b);
    for (const r of rankKeys) {
      const list = rows[r].filter(showNode);
      if (!list.length) continue;
      // порядок по среднему x родителей
      list.sort((a, b) => avgParentX(a) - avgParentX(b));
      list.forEach((id, i) => (pos[id] = { i, n: list.length, y }));
      maxW = Math.max(maxW, list.length);
      y += H + GY;
    }
    function avgParentX(id) {
      const xs = [];
      for (const [p, ks] of Object.entries(kids)) if (ks.includes(id) && pos[p]) xs.push(pos[p].i - pos[p].n / 2);
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
    }
    const width = Math.max(1, maxW) * (W + GX) - GX + PAD * 2;
    const height = y - GY + PAD;
    for (const p of Object.values(pos)) p.x = PAD + (width - PAD * 2 - (p.n * (W + GX) - GX)) / 2 + p.i * (W + GX);

    let edges = "", nodes = "";
    let opened = 0, total = 0;
    for (const [id, sc] of Object.entries(G.scenes)) total += (sc.choices || []).length;
    for (const id of Object.keys(pos)) {
      const p = pos[id], sc = G.scenes[id];
      if (!visited[id] && !gScenes.has(id)) {
        nodes += `<g class="fnode unk" transform="translate(${p.x},${p.y})"><rect width="${W}" height="${H}" rx="8"/><text x="${W / 2}" y="${H / 2 + 6}" text-anchor="middle" class="q">?</text></g>`;
        continue;
      }
      const chs = sc.choices || [];
      const cw = 20, cg = 4, rowW = chs.length * cw + (chs.length - 1) * cg;
      let chips = "";
      chs.forEach((c, i) => {
        const cx = (W - rowW) / 2 + i * (cw + cg);
        const isTaken = taken[id] && taken[id][c.id];
        const isShown = shown[id] && shown[id][c.id];
        const deathSeen = c.outcomes.some((o) => o.to.startsWith("✝") && meta.journal[o.to]);
        if (isTaken) opened++;
        const onGuide = gChoice[id] === c.id;
        const cls = (deathSeen && isTaken ? "dead" : isTaken ? "taken" : isShown ? "shown" : "unk") + (onGuide ? " guide" : "");
        const label = !onGuide && !isTaken && !isShown ? "?" : deathSeen && isTaken ? "✝" : LETTERS[i] || i + 1;
        const tip = isShown || isTaken || onGuide ? esc(c.label) : "ещё не видел";
        chips += `<g class="chip ${cls}" transform="translate(${cx},${H - 28})"><title>${tip}</title><rect width="${cw}" height="20" rx="4"/><text x="${cw / 2}" y="14" text-anchor="middle">${label}</text></g>`;
        // рёбра от фишки к сцене
        if (isTaken || isShown || onGuide) {
          for (const o of c.outcomes) {
            const t = o.to;
            if (!pos[t]) continue;
            if (onGuide && !(isTaken || isShown) && !gScenes.has(t)) continue;
            const x1 = p.x + cx + cw / 2, y1 = p.y + H - 8, x2 = pos[t].x + W / 2, y2 = pos[t].y;
            const my = (y1 + y2) / 2;
            edges += `<path class="edge ${isTaken && visited[t] ? "taken" : "shown"} ${life.has(id) && life.has(t) ? "now" : ""} ${onGuide && gScenes.has(t) ? "guide" : ""}" d="M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}"/>`;
          }
        }
      });
      if (sc.next && pos[sc.next]) {
        const x1 = p.x + W / 2, y1 = p.y + H, x2 = pos[sc.next].x + W / 2, y2 = pos[sc.next].y, my = (y1 + y2) / 2;
        edges += `<path class="edge taken ${life.has(id) && life.has(sc.next) ? "now" : ""} ${gScenes.has(id) && gScenes.has(sc.next) ? "guide" : ""}" d="M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}"/>`;
      }
      const title = esc((sc.title || id).replace(/^Демо\.\s*/, ""));
      nodes += `<g class="fnode ${gScenes.has(id) ? "guide" : ""} ${life.has(id) ? "now" : ""} ${S && S.scene === id ? "here" : ""} fe-${sc.photo || "none"}" transform="translate(${p.x},${p.y})">
        <rect width="${W}" height="${H}" rx="8"/>
        <text x="12" y="22" class="ft">${title.length > 22 ? title.slice(0, 21) + "…" : title}</text>
        <text x="12" y="40" class="fd">${esc(yearOf(sc.date) || "")}${sc.age != null ? " · " + sc.age : ""}</text>
        ${chips}</g>`;
    }
    $("#flow-canvas").innerHTML = `<svg width="${width * flowZoom}" height="${height * flowZoom}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Схема ветвлений">${edges}${nodes}</svg>`;
    flowSize = { w: width, h: height };
    $("#flow-count").textContent = `${progressLine()} · развилок: ${opened} из ${total} · жизней: ${meta.lives || 0}`;
    const fg = $("#flow-guide");
    fg.hidden = !gp;
    if (gp) { fg.innerHTML = `Подсвечен путь к «${esc(gp.title)}». <button class="link" id="btn-guide-off">убрать</button>`; $("#btn-guide-off").onclick = () => { guideOn = null; renderFlow(); }; }
    const here = gp ? pos[gp.steps[0] && gp.steps[0].scene] : S && pos[S.scene];
    if (here) { const wrap = $("#flow-wrap"); wrap.scrollLeft = Math.max(0, (here.x + W / 2) * flowZoom - wrap.clientWidth / 2); wrap.scrollTop = Math.max(0, here.y * flowZoom - 120); }
  }

  // ---------- живой фон
  const cv = $("#bg"), cx = cv.getContext && cv.getContext("2d");
  let mode = "off", raf = null, t0 = performance.now();
  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    cv.style.width = innerWidth + "px"; cv.style.height = innerHeight + "px";
    if (cx) cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (REDUCED) draw(0);
  }
  function bgMode(m) {
    if (m === mode) return;
    mode = m;
    cv.style.opacity = m === "off" ? 0 : 1;
    if (!cx) return;
    if (REDUCED) { draw(0); return; }
    if (!raf && m !== "off") raf = requestAnimationFrame(loop);
  }
  function loop(now) {
    raf = null;
    if (mode === "off") return;
    draw((now - t0) / 1000);
    raf = requestAnimationFrame(loop);
  }
  function draw(t) {
    const w = innerWidth, h = innerHeight;
    cx.clearRect(0, 0, w, h);
    if (mode === "title") drawTitle(t, w, h);
    else if (mode === "dust") drawDust(t, w, h);
  }
  function drawTitle(t, w, h) {
    // звёзды
    for (let i = 0; i < 90; i++) {
      const x = hash(i) * w, y = hash(i + 300) * h * 0.55;
      const a = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * (0.5 + hash(i + 9)) + i));
      cx.fillStyle = `rgba(233,228,218,${a * 0.6})`;
      cx.fillRect(x, y, 1.2, 1.2);
    }
    // комета
    const kx = w * 0.78, ky = h * 0.16;
    const g = cx.createLinearGradient(kx, ky, kx - w * 0.55, ky + h * 0.22);
    g.addColorStop(0, "rgba(220,236,255,.55)"); g.addColorStop(1, "rgba(220,236,255,0)");
    cx.strokeStyle = g; cx.lineWidth = 3; cx.beginPath(); cx.moveTo(kx, ky); cx.lineTo(kx - w * 0.55, ky + h * 0.22); cx.stroke();
    cx.lineWidth = 1; cx.beginPath(); cx.moveTo(kx, ky); cx.lineTo(kx - w * 0.5, ky + h * 0.27); cx.stroke();
    cx.fillStyle = "rgba(240,248,255,.9)"; cx.beginPath(); cx.arc(kx, ky, 2.4, 0, Math.PI * 2); cx.fill();
    // заводь и круги
    const px = w * 0.5, py = h * 0.86, rx = Math.min(w * 0.46, 340), ry = rx * 0.18;
    cx.fillStyle = "#050506"; cx.beginPath(); cx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2); cx.fill();
    for (let k = 0; k < 3; k++) {
      const ph = ((t / 4.5) + k / 3) % 1;
      cx.strokeStyle = `rgba(110,150,148,${0.35 * (1 - ph)})`; cx.lineWidth = 1;
      cx.beginPath(); cx.ellipse(px + rx * 0.35, py - ry * 0.1, rx * 0.12 + ph * rx * 0.55, ry * 0.12 + ph * ry * 0.55, 0, 0, Math.PI * 2); cx.stroke();
    }
    // коряга-рука
    cx.strokeStyle = "rgba(232,226,210,.8)"; cx.lineCap = "round";
    const bx = px + rx * 0.35, by = py - ry * 0.15;
    const sway = Math.sin(t * 0.7) * 1.5;
    const br = (x1, y1, x2, y2, lw) => { cx.lineWidth = lw; cx.beginPath(); cx.moveTo(x1, y1); cx.lineTo(x2 + sway, y2); cx.stroke(); };
    br(bx, by, bx - 6, by - 46, 4); br(bx - 5, by - 40, bx - 20, by - 62, 2.5); br(bx - 5, by - 42, bx - 4, by - 70, 2.2);
    br(bx - 5, by - 40, bx + 10, by - 64, 2.2); br(bx - 3, by - 30, bx + 16, by - 44, 1.8);
  }
  function drawDust(t, w, h) {
    const era = document.body.dataset.era;
    const base = era === "future" ? "200,220,255" : era === "bw" ? "233,228,218" : "217,164,65";
    for (let i = 0; i < 46; i++) {
      const sp = 6 + hash(i + 50) * 14;
      const x = (hash(i) * w + t * sp * (hash(i + 7) > 0.5 ? 1 : -1) + w * 10) % w;
      const y = (hash(i + 100) * h + t * (3 + hash(i + 20) * 6)) % h;
      const a = 0.05 + 0.12 * hash(i + 200) * (0.6 + 0.4 * Math.sin(t + i));
      cx.fillStyle = `rgba(${base},${a})`;
      const s = 0.8 + hash(i + 400) * 1.8;
      cx.fillRect(x, y, s, s);
    }
  }
  addEventListener("resize", resize);
  resize();

  function showTitle() {
    show("#title");
    $("#btn-continue").hidden = !store.get(SAVE, null);
  }

  // ---------- кнопки
  $("#btn-new").onclick = newLife;
  $("#btn-continue").onclick = () => { S = store.get(SAVE, null); if (S) { S.year = S.year || null; enter(S.scene, true); } };
  for (const [btn, panel] of [["#btn-journal", "#journal"], ["#btn-journal2", "#journal"], ["#btn-me", "#me"], ["#btn-flow", "#flow"], ["#btn-flow2", "#flow"], ["#btn-howto2", "#howto"], ["#btn-guide", "#guide"], ["#btn-guide2", "#guide"], ["#btn-guide3", "#guide"], ["#btn-howto", "#howto"], ["#btn-about", "#about"]])
    $(btn).onclick = () => openPanel(panel);
  $("#btn-quit").onclick = showTitle;
  document.querySelectorAll(".close").forEach((b) => (b.onclick = closePanel));
  showTitle();
})();
