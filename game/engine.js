/* Тот, кто остался — движок прототипа. Без рандома: всё решают переменные и выборы. */
(() => {
  "use strict";
  const G = window.GRAPH, C = G.config;
  const $ = (s) => document.querySelector(s);
  const DEBUG = /[?&]debug/.test(location.search);
  const SAVE = "qq_save_v1", META = "qq_meta_v1";

  // ---------- хранилище (может быть недоступно)
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* без сохранений */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  let meta = store.get(META, { journal: {}, lives: 0, root: false });
  let S = null; // состояние жизни

  // ---------- выражения (AST собирает tools/build.py)
  function ev(e, st) {
    switch (e.op) {
      case "num": case "lit": return e.v;
      case "var": return st[e.n] ?? null;
      case "truthy": return !!st[e.n];
      case "not": return !ev(e.a, st);
      case "and": return e.a.every((x) => ev(x, st));
      case "or": return e.a.some((x) => ev(x, st));
      case "seen": return e.life ? !!S.lifeSeen[e.id] : !!meta.journal[e.id];
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
      else st[name] = val;
    }
  }
  const depthFor = (dar) => C.rollback.reduce((d, [lo, n]) => (dar >= lo ? n : d), 1);
  const sealOf = (sc) => C.seal_groups[sc.stage] || sc.stage;
  const tier = (name, val) => { const t = C.vars[name].tiers; let w = t[0][1]; for (const [lo, word] of t) if (val >= lo) w = word; return w; };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>").replace(/\n/g, "<br>");
  const WORDS = ["", "один шаг", "два шага", "три шага", "четыре шага", "пять шагов"];

  // ---------- экраны
  const screens = ["#title", "#scene", "#death", "#rewind", "#journal", "#me", "#about"];
  let back = "#scene";
  function show(id) {
    for (const s of screens) $(s).hidden = s !== id;
    $("#bar").hidden = !(id === "#scene");
    window.scrollTo(0, 0);
  }

  // ---------- жизнь
  function newLife() {
    meta.lives = (meta.lives || 0) + 1; store.set(META, meta);
    S = { scene: C.start, st: initState(), stack: [], lifeSeen: {}, awake: null, ghost: null };
    enter(C.start);
  }
  function save() { store.set(SAVE, S); }

  function visible(sc, st) { return (sc.choices || []).filter((c) => ok(c.visible, st)); }

  function enter(id, restored) {
    const sc = G.scenes[id];
    S.scene = id;
    if (id === "Т-02б" && !meta.root) { meta.root = true; store.set(META, meta); }
    if (!restored && visible(sc, S.st).length >= 2) S.stack.push({ scene: id, st: clone(S.st), seal: sealOf(sc), taken: null });
    save();
    render(sc);
  }

  // ---------- отрисовка сцены
  let typing = null;
  function render(sc) {
    show("#scene");
    const st = S.st;
    document.body.dataset.drift = Math.min(4, Math.floor((st["ДРЕЙФ"] || 0) / 20));
    // фото-«альбом»: вид зависит от эпохи
    const ph = $("#photo");
    ph.className = "photo era-" + (sc.photo || "none");
    ph.innerHTML = "";
    if (sc.photo) {
      const img = new Image();
      img.alt = sc.photo_caption || "";
      img.onerror = () => { img.remove(); ph.classList.add("empty"); };
      img.src = "img/" + encodeURIComponent(sc.id || S.scene) + ".jpg";
      const cap = document.createElement("figcaption");
      cap.textContent = sc.photo_caption || "";
      const ph2 = document.createElement("div");
      ph2.className = "placeholder";
      ph2.innerHTML = `<span>место для фото</span><small>${esc(C.photo_eras[sc.photo] || "")}</small>`;
      ph.append(img, ph2, cap);
      if (sc.photo === "color" || sc.photo === "bw") {
        const stamp = document.createElement("span");
        stamp.className = "stamp mono";
        stamp.textContent = dateStamp(sc.date);
        ph.append(stamp);
      }
    }
    $("#meta").textContent = [sc.date, sc.age != null ? `мне ${sc.age}` : "", DEBUG ? S.scene : ""].filter(Boolean).join(" · ");
    $("#when").textContent = sc.date || "";

    const blocks = [];
    if (S.awake) { for (const b of S.awake) if (ok(b.if, st)) blocks.push({ md: b.md, cls: "awake" }); S.awake = null; }
    for (const b of sc.text) if (ok(b.if, st)) blocks.push({ md: b.md, cls: b.drift ? "drift" : "" });
    const art = $("#text"); art.innerHTML = "";
    const nav = $("#choices"); nav.innerHTML = "";
    const els = blocks.map((b) => { const p = document.createElement("p"); p.className = b.cls; p.innerHTML = md(b.md); p.style.opacity = 0; art.append(p); return p; });

    const finish = () => { clearTimeout(typing); typing = null; els.forEach((p) => (p.style.opacity = 1)); renderChoices(sc); };
    let i = 0;
    const step = () => { if (i >= els.length) return finish(); els[i].style.opacity = 1; i++; typing = setTimeout(step, 450); };
    art.onclick = () => typing && finish();
    step();
  }

  function dateStamp(date) {
    const m = /(\d{1,2})\s+(\S+)\s+(\d{4})/.exec(date || "");
    if (!m) return "";
    const months = { января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6, июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12 };
    return `'${m[3].slice(2)}  ${months[m[2]] || ""}  ${m[1]}`;
  }

  function renderChoices(sc) {
    const nav = $("#choices"); nav.innerHTML = "";
    const st = S.st;
    const top = S.stack[S.stack.length - 1];
    const ghost = S.ghost; S.ghost = null;
    const vis = visible(sc, st);
    for (const c of vis) {
      const b = document.createElement("button");
      b.className = "choice";
      b.innerHTML = `<span class="lbl">${md(c.label)}</span>`;
      if (ghost && ghost === c.id && top && top.scene === S.scene) {
        b.classList.add("ghosted");
        b.insertAdjacentHTML("beforeend", `<small>в другом мире я выбрал это</small>`);
      }
      if (c.visible && /seen/.test(JSON.stringify(c.visible))) b.classList.add("echo");
      if (DEBUG) b.insertAdjacentHTML("beforeend", `<small class="mono">[${c.id}] ${c.outcomes.map((o) => (o.if_src ? o.if_src + " → " : "") + o.to).join(" | ")}</small>`);
      b.onclick = () => choose(sc, c);
      nav.append(b);
    }
    if (!vis.length && sc.next) {
      const b = document.createElement("button");
      b.className = "choice next"; b.textContent = "Дальше";
      b.onclick = () => enter(sc.next);
      nav.append(b);
    }
    if (!vis.length && !sc.next) {
      const b = document.createElement("button");
      b.className = "choice"; b.textContent = "Новая жизнь";
      b.onclick = newLife;
      const j = document.createElement("button");
      j.className = "choice ghost-choice"; j.textContent = "Открыть Хор";
      j.onclick = () => openPanel("#journal");
      nav.append(j, b);
    }
    renderDebug();
  }

  function choose(sc, c) {
    const st = S.st;
    const o = c.outcomes.find((x) => ok(x.if, st));
    const top = S.stack[S.stack.length - 1];
    if (top && top.scene === S.scene) top.taken = c.id;
    if (o.to.startsWith("✝")) return die(o.to);
    applyFx(c.fx, st);
    if (o.fx) applyFx(o.fx, st);
    enter(o.to);
  }

  // ---------- смерть
  function die(did) {
    const d = G.deaths[did];
    S.lifeSeen[did] = true;
    const j = meta.journal[did] || { times: 0, first: new Date().toISOString(), life: meta.lives };
    j.times++; meta.journal[did] = j; store.set(META, meta);
    save();
    show("#death");
    $("#death-tc").textContent = (d.date || "").toUpperCase();
    const art = $("#death-text"); art.innerHTML = "";
    const blocks = d.text.filter((b) => ok(b.if, S.st));
    const btn = $("#btn-death-next"); btn.hidden = true;
    let i = 0;
    const step = () => {
      if (i < blocks.length) { const p = document.createElement("p"); p.innerHTML = md(blocks[i].md); art.append(p); i++; setTimeout(step, 900); }
      else { btn.hidden = false; btn.textContent = "…"; btn.onclick = () => rewind(did); }
    };
    setTimeout(step, 600);
  }

  // ---------- откат
  function rewind(did) {
    const d = G.deaths[did];
    const dar = S.st["ДАР"] || 0;
    const depth = depthFor(dar);
    const cur = G.scenes[S.scene];
    // текущая сцена должна быть вершиной стека
    if (!S.stack.length || S.stack[S.stack.length - 1].scene !== S.scene) S.stack.push({ scene: S.scene, st: clone(S.st), seal: sealOf(cur), taken: null });
    const opts = [];
    const sealNow = S.stack[S.stack.length - 1].seal;
    for (let k = 0; k < depth; k++) {
      const idx = S.stack.length - 1 - k;
      if (idx < 0) break;
      if (S.stack[idx].seal !== sealNow) break;
      opts.push(idx);
    }
    show("#rewind");
    $("#rew-depth").textContent = WORDS[opts.length] || "";
    const tape = $("#tape"); tape.innerHTML = "";
    opts.forEach((idx, n) => {
      const snap = S.stack[idx];
      const sc = G.scenes[snap.scene];
      const b = document.createElement("button");
      b.className = "notch choice";
      b.innerHTML = `<span class="mono">${"◀".repeat(n + 1)}</span> ${esc(sc.title || snap.scene)}<small class="mono">${esc(sc.date || "")}</small>`;
      b.onclick = () => {
        S.stack = S.stack.slice(0, idx + 1);
        S.st = clone(snap.st);
        S.awake = n === 0 ? d.awake || null : null;
        if (n > 0) S.awake = [{ md: "…и я снова здесь. Раньше. Хор отпускает меня в этот миг, как отпускают руку на переправе." }];
        S.ghost = snap.taken;
        enter(snap.scene, true);
      };
      tape.append(b);
    });
    const lost = depth - opts.length;
    if (lost > 0 && opts.length < depth) tape.insertAdjacentHTML("beforeend", `<p class="dim tiny mono">дальше лента засвечена</p>`);
  }

  // ---------- панели
  function openPanel(id) { back = $("#scene").hidden ? "#title" : "#scene"; renderPanels(); show(id); }
  function closePanel() { if (back === "#scene" && S) show("#scene"); else showTitle(); }
  function renderPanels() {
    const list = $("#journal-list"); list.innerHTML = "";
    if (meta.root) list.insertAdjacentHTML("beforeend", `<div class="entry root"><b>№ 0 · Корень</b><span class="mono dim">Чёрная заводь, 28 июля 1996</span><p>Двести пятьдесят две секунды. С этой записи всё начинается.</p></div>`);
    const seenSt = new Set();
    let n = 1;
    for (const [id, d] of Object.entries(G.deaths)) {
      const j = meta.journal[id];
      if (!j) continue;
      if (d.stihia) seenSt.add(d.stihia);
      list.insertAdjacentHTML("beforeend", `<div class="entry"><b>№ ${n++} · ${esc(d.title || "")}</b><span class="mono dim">${esc(d.date || "")} · ${esc(d.stihia || "")}</span><p>${esc(d.epitaph || "")}</p><p class="dim"><i>${esc(d.mourner || "")}</i></p></div>`);
    }
    if (n === 1 && !meta.root) list.innerHTML = `<p class="dim">Хор молчит. Пока.</p>`;
    $("#stihii").innerHTML = C.stihii.map((s) => `<span class="${seenSt.has(s) ? "on" : ""}" title="${s}">●</span>`).join(" ");
    const me = $("#me-list"); me.innerHTML = "";
    if (S) for (const [k, v] of Object.entries(C.vars)) {
      if (v.hidden) continue;
      me.insertAdjacentHTML("beforeend", `<div class="row"><span>${esc(v.name)}</span><b>${esc(tier(k, S.st[k]))}</b></div>`);
    }
    renderDebug();
  }
  function renderDebug() {
    const dbg = $("#debug");
    if (!DEBUG || !S) return;
    dbg.hidden = false;
    dbg.textContent = Object.entries(S.st).filter(([, v]) => v !== null).map(([k, v]) => `${k}=${v}`).join("  ") + `  | стек: ${S.stack.map((s) => s.scene).join(" › ")}`;
  }

  function showTitle() {
    show("#title");
    $("#btn-continue").hidden = !store.get(SAVE, null);
  }

  // ---------- кнопки
  $("#btn-new").onclick = newLife;
  $("#btn-continue").onclick = () => { S = store.get(SAVE, null); if (S) enter(S.scene, true); };
  $("#btn-journal").onclick = () => openPanel("#journal");
  $("#btn-journal2").onclick = () => openPanel("#journal");
  $("#btn-me").onclick = () => openPanel("#me");
  $("#btn-about").onclick = () => show("#about");
  $("#btn-quit").onclick = showTitle;
  document.querySelectorAll(".close").forEach((b) => (b.onclick = closePanel));
  showTitle();
})();
