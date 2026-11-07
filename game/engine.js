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
  let meta = Object.assign({ journal: {}, lives: 0, root: false, visited: {}, taken: {}, shown: {}, extra: {}, guide: {}, seenBlocks: {} }, store.get(META, {}));
  meta.seenBlocks = meta.seenBlocks || {}; // сцена → {ключ абзаца: номер жизни, когда показан впервые}
  meta.guide = meta.guide || {};
  // lived(ID): номер жизни, в которой сцена посещена впервые. Старые сохранения: всё, что уже в visited, — прошлые жизни (0).
  meta.vlife = meta.vlife || {};
  for (const id of Object.keys(meta.visited || {})) if (!(id in meta.vlife)) meta.vlife[id] = 0;
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
      case "lived": return e.id in meta.vlife && meta.vlife[e.id] < (meta.lives || 0);
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
  // ключ абзаца для быстрого ствола: хеш текста (правка абзаца = новый абзац)
  const bkey = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
  const buzz = (pat) => { try { if (navigator.vibrate) navigator.vibrate(pat); } catch (e) { /* нет вибрации */ } };

  // ---------- звук: только синтез Web Audio, без файлов и без рандома.
  // Шум — детерминированный генератор (LCG от счётчика). Контекст создаётся по первому жесту игрока.
  // По умолчанию звук включён, но тихий; кнопка в панели «Я», выбор хранится в meta.sound.
  const snd = (() => {
    const AC = window.AudioContext || window.webkitAudioContext;
    const VOL = 0.55; // общий уровень: тихо
    let ctx = null, master = null, amb = null, ambNodes = null, wantEra = "none", wantScreen = "title";
    let heartT = null, rew = null, lastChorus = -1e9;
    const on = () => meta.sound !== false;
    const lcg = (seed) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
    const bufs = {};
    function buf(kind) {
      if (bufs[kind]) return bufs[kind];
      const sr = ctx.sampleRate, n = Math.floor(sr * 4), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
      const r = lcg({ white: 7, bw: 1896, color: 1999, digital: 2009, rew: 252 }[kind] || 1);
      let br = 0, click = 0, sign = 1;
      for (let i = 0; i < n; i++) {
        const w = r() * 2 - 1;
        if (kind === "bw") { // треск плёнки: тихое шипение и редкие щелчки
          if (click < 0.01 && r() < 0.00022) { click = 0.35 + 0.5 * r(); sign = -sign; }
          d[i] = w * 0.05 + sign * click * (r() * 0.6 + 0.4); click *= 0.93;
        } else if (kind === "color") { br = (br + w * 0.02) * 0.995; d[i] = br * 3; } // тёплый «коричневый» шум
        else if (kind === "digital") { const gate = (Math.floor(i / (sr * 0.09)) * 2654435761 >>> 0) % 7 === 0; d[i] = w * (gate ? 0.06 : 0.018); }
        else d[i] = w;
      }
      return (bufs[kind] = b);
    }
    function unlock() {
      if (!AC || !on()) return;
      try {
        if (!ctx) {
          ctx = new AC();
          master = ctx.createGain(); master.gain.value = VOL; master.connect(ctx.destination);
          amb = ctx.createGain(); amb.gain.value = 0; amb.connect(master);
          applyEra(); applyScreen();
        }
        if (ctx.state === "suspended") ctx.resume();
      } catch (e) { ctx = null; }
    }
    const live = () => ctx && on() && ctx.state !== "closed";
    const ramp = (p, v, t = 0.4) => { const n = ctx.currentTime; p.cancelScheduledValues(n); p.setValueAtTime(p.value, n); p.linearRampToValueAtTime(v, n + t); };
    function applyEra() {
      if (!ctx) return;
      if (ambNodes) { const old = ambNodes; ramp(old.g.gain, 0, 1.2); setTimeout(() => old.stop.forEach((x) => { try { x.stop(); } catch (e) {} }), 1400); ambNodes = null; }
      const era = wantEra;
      if (!["bw", "color", "digital"].includes(era)) return; // phone/future/none — почти тишина
      const g = ctx.createGain(); g.gain.value = 0; g.connect(amb);
      const src = ctx.createBufferSource(); src.buffer = buf(era); src.loop = true;
      const f = ctx.createBiquadFilter();
      const stop = [src];
      if (era === "bw") { f.type = "highpass"; f.frequency.value = 500; }
      else if (era === "color") {
        f.type = "lowpass"; f.frequency.value = 380;
        for (const [hz, a] of [[50, 0.018], [100.4, 0.012]]) { const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.value = hz; og.gain.value = a; o.connect(og).connect(g); o.start(); stop.push(o); }
      } else { f.type = "highpass"; f.frequency.value = 5200; }
      src.connect(f).connect(g); src.start();
      ramp(g.gain, { bw: 0.22, color: 0.5, digital: 0.18 }[era], 1.5);
      ambNodes = { g, stop };
    }
    function applyScreen() {
      if (!ctx) return;
      const s = wantScreen;
      ramp(amb.gain, s === "scene" || s === "chapter" ? 1 : s === "death" || s === "awake" || s === "rewind" ? 0 : 0.35, s === "death" ? 0.05 : 0.8);
    }
    // короткий тон с огибающей
    function tone(hz, { at = 0, a = 0.01, d = 0.3, g = 0.1, type = "sine", to = null, dest = null } = {}) {
      const t = ctx.currentTime + at, o = ctx.createOscillator(), v = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(hz, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + a + d);
      v.gain.setValueAtTime(0.0001, t); v.gain.linearRampToValueAtTime(g, t + a); v.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
      o.connect(v).connect(dest || master); o.start(t); o.stop(t + a + d + 0.05);
    }
    function noise(at, dur, g, hp) {
      const t = ctx.currentTime + at, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), v = ctx.createGain();
      s.buffer = buf("white"); f.type = "highpass"; f.frequency.value = hp;
      v.gain.setValueAtTime(g, t); v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f).connect(v).connect(master); s.start(t, (at * 997) % 3); s.stop(t + dur + 0.02);
    }
    return {
      unlock,
      on,
      pause(h) { try { if (!ctx) return; if (h) ctx.suspend(); else if (on()) ctx.resume(); } catch (e) { /* ничего */ } },
      state: () => (ctx ? ctx.state : "none"),
      toggle() {
        meta.sound = !on(); saveMeta();
        if (on()) { unlock(); if (ctx) ramp(master.gain, VOL, 0.3); }
        else if (ctx) { ramp(master.gain, 0, 0.2); this.heart(false); this.rewStop(); }
        return on();
      },
      era(e) { if (e === wantEra) return; wantEra = e; if (ctx) applyEra(); },
      screen(id) { wantScreen = id.replace("#", ""); if (ctx) applyScreen(); if (wantScreen !== "scene") this.heart(false); if (wantScreen !== "death") this.rewStop(); },
      // STOP кассетной деки: два механических щелчка и глухой удар
      stop() {
        if (!live()) return;
        noise(0, 0.025, 0.35, 2500); tone(150, { d: 0.09, g: 0.22, to: 60 });
        noise(0.08, 0.018, 0.18, 3500);
      },
      // перемотка ленты: шорох и вой мотора, высота растёт с удержанием
      rewStart() {
        if (!live() || rew) return;
        const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), o = ctx.createOscillator(), og = ctx.createGain(), g = ctx.createGain();
        s.buffer = buf("white"); s.loop = true; f.type = "bandpass"; f.Q.value = 3; f.frequency.value = 400;
        o.type = "sawtooth"; o.frequency.value = 70; og.gain.value = 0.02;
        g.gain.value = 0; s.connect(f).connect(g); o.connect(og).connect(g); g.connect(master);
        s.start(); o.start(); ramp(g.gain, 0.16, 0.08);
        rew = { s, o, f, g };
      },
      rewSet(k) { if (!rew) return; const n = ctx.currentTime; rew.f.frequency.setTargetAtTime(400 + k * 3200, n, 0.05); rew.o.frequency.setTargetAtTime(70 + k * 520, n, 0.05); },
      rewFinish(fast) {
        if (!live()) return;
        if (!rew) this.rewStart();
        if (!rew) return;
        const n = ctx.currentTime, d = fast ? 0.24 : 0.05;
        rew.f.frequency.linearRampToValueAtTime(3800, n + d); rew.o.frequency.linearRampToValueAtTime(640, n + d);
        const r = rew; rew = null;
        r.g.gain.setValueAtTime(0.16, n + d); r.g.gain.exponentialRampToValueAtTime(0.0001, n + d + 0.35);
        r.s.stop(n + d + 0.4); r.o.stop(n + d + 0.4);
        noise(d + 0.02, 0.02, 0.2, 3000); // защёлка «PLAY»
      },
      rewStop() {
        if (!rew || !ctx) return;
        const r = rew; rew = null; const n = ctx.currentTime;
        r.g.gain.cancelScheduledValues(n); r.g.gain.setValueAtTime(r.g.gain.value, n); r.g.gain.linearRampToValueAtTime(0, n + 0.12);
        r.s.stop(n + 0.15); r.o.stop(n + 0.15);
      },
      // Хор: тихий аккорд, слоёв столько, сколько записей в Тетради (до 8); голоса входят по одному
      chorus() {
        const n = Math.min(8, Object.keys(meta.journal || {}).length || (meta.root ? 1 : 0));
        if (!live() || !n || ctx.currentTime - lastChorus < 6) return;
        lastChorus = ctx.currentTime;
        const HZ = [110, 164.81, 220, 261.63, 329.63, 392, 440, 523.25];
        const g = 0.07 / Math.sqrt(n), lp = ctx.createBiquadFilter();
        lp.type = "lowpass"; lp.frequency.value = 1200; lp.connect(master);
        for (let i = 0; i < n; i++) for (const det of [-0.0025, 0.0025]) {
          const t = ctx.currentTime + i * 0.35, o = ctx.createOscillator(), v = ctx.createGain();
          o.type = i % 2 ? "triangle" : "sine"; o.frequency.value = HZ[i] * (1 + det * (1 + (i % 3)));
          v.gain.setValueAtTime(0.0001, t); v.gain.linearRampToValueAtTime(g / 2, t + 1.6); v.gain.setValueAtTime(g / 2, t + 4); v.gain.linearRampToValueAtTime(0.0001, t + 7.5);
          o.connect(v).connect(lp); o.start(t); o.stop(t + 7.7);
        }
      },
      // «холодок»: очень тихий низкий тон, когда в выборе есть смерть
      cold() { if (!live()) return; tone(98, { a: 0.5, d: 1.6, g: 0.05 }); tone(73.4, { a: 0.7, d: 1.8, g: 0.035 }); },
      // сердцебиение, пока часы острой сцены на исходе
      heart(want) {
        if (!want) { clearInterval(heartT); heartT = null; return; }
        if (heartT || !live()) return;
        const beat = () => { if (!live()) return; tone(90, { d: 0.16, g: 0.3, to: 45 }); tone(80, { at: 0.26, d: 0.14, g: 0.18, to: 42 }); };
        beat(); buzz([18, 230, 12]);
        heartT = setInterval(beat, 950);
      },
    };
  })();
  for (const t of ["pointerdown", "keydown", "touchstart"]) addEventListener(t, () => snd.unlock(), { capture: true, passive: true });
  document.addEventListener("visibilitychange", () => snd.pause(document.hidden));
  // сцены-заглушки: варианты туда видны, но закрыты
  const WIP = new Set(C.wip_scenes || ["Ж-00"]);
  const isWip = (c) => c.outcomes.length > 0 && c.outcomes.every((o) => WIP.has(o.to));
  // «время» (канон п. 30): остаток секунд живёт в состоянии под служебным ключом, поэтому откат возвращает и его
  const CLK = "_clock";
  const leftOf = (sc) => (sc.clock != null && S && S.st[CLK] != null ? S.st[CLK] : null);
  const late = (sc, c) => { const l = leftOf(sc); return l != null && (c.cost || 0) > l; };
  // мета-эхо: вариант открыт смертью из Журнала (seen без _life) — память другой жизни
  // память смертей как инвентарь (п. 10 разбора): какие смерти открыли вариант и что из них вынесено
  function seenIds(e, life, acc = []) {
    if (!e || typeof e !== "object") return acc;
    if (e.op === "seen" && !!e.life === life) acc.push(e.id);
    for (const k of ["a", "l", "r"]) { const x = e[k]; if (Array.isArray(x)) x.forEach((y) => seenIds(y, life, acc)); else seenIds(x, life, acc); }
    return acc;
  }
  const lessonsFor = (e, life) => [...new Set(seenIds(e, life).filter((id) => (life ? S && S.lifeSeen[id] : meta.journal[id])).map((id) => (G.deaths[id] || {}).lesson).filter(Boolean))];
  const hasMeta = (e) => !!e && typeof e === "object" && ((e.op === "seen" && !e.life) || e.op === "lived" || ["a", "l", "r"].some((k) => (Array.isArray(e[k]) ? e[k].some(hasMeta) : hasMeta(e[k]))));

  // ---------- метка «↩ год · сцена»: абзац зависит от флага, который поставил мой выбор в этой жизни
  function flagsIn(e, acc = new Set()) {
    if (!e || typeof e !== "object") return acc;
    if ((e.op === "var" || e.op === "truthy") && /^F_/.test(e.n) && e.n !== "F_ПУТЬ") acc.add(e.n);
    for (const k of ["a", "l", "r"]) { const x = e[k]; if (Array.isArray(x)) x.forEach((y) => flagsIn(y, acc)); else flagsIn(x, acc); }
    return acc;
  }
  // метка = МОЙ выбор, а не название сцены. Не метим выбор минуту назад и тот же год; одна метка на источник за сцену (tagUsed).
  let tagUsed = new Set();
  function echoTag(cond, skip) {
    if (!cond || !S || !S.trail) return "";
    const out = [];
    const curY = yearOf((G.scenes[S.scene] || {}).date);
    // выбор «минуту назад»: последняя запись следа не из этой сцены
    let prev = -1;
    for (let i = S.trail.length - 1; i >= 0; i--) if (S.trail[i].scene !== S.scene) { prev = i; break; }
    for (const f of flagsIn(cond)) {
      if (skip && skip.has(f)) continue;
      const src = (G.flag_src || {})[f];
      if (!src) continue;
      for (let i = S.trail.length - 1; i >= 0; i--) {
        const t = S.trail[i];
        if (t.scene === S.scene || !(t.flags || []).includes(f) || !src.includes(t.scene)) continue;
        const sc = G.scenes[t.scene], y = yearOf(sc && sc.date);
        if (i === prev || (y && y === curY)) break;
        const ch = ((sc && sc.choices) || []).find((c) => c.id === t.choice);
        const key = t.scene + "/" + t.choice;
        if (!tagUsed.has(key)) { tagUsed.add(key); out.push("↩ " + (y ? y + " · " : "") + (ch ? "▸ " + short(ch.label) : ((sc && sc.title) || t.scene))); }
        break;
      }
    }
    // встреча ветвей: абзац зависит от другой прожитой жизни
    (function walk(e) {
      if (!e || typeof e !== "object") return;
      if (e.op === "lived" && ev(e, S.st)) {
        const sc = G.scenes[e.id], key = "lived/" + e.id;
        if (sc && !tagUsed.has(key)) { tagUsed.add(key); const y = yearOf(sc.date); out.push("◌ другая жизнь · " + (y ? y + " · " : "") + (sc.title || e.id).replace(/^Демо\.\s*/, "")); }
      }
      for (const k of ["a", "l", "r"]) { const x = e[k]; if (Array.isArray(x)) x.forEach(walk); else walk(x); }
    })(cond);
    return out.join("   ");
  }
  // абзацы с меткой: метка — отдельной строкой над абзацем, вне текста
  function para(art, cls, html, tag) {
    let t = null;
    if (tag) { t = document.createElement("div"); t.className = "echo-tag mono pending" + (/^◌/.test(tag) ? " other-life" : ""); t.textContent = tag; art.append(t); }
    const p = document.createElement("p"); p.className = cls; p.innerHTML = html; p.classList.add("pending"); p._tag = t; art.append(p);
    return p;
  }
  const reveal = (p) => { p.classList.remove("pending"); if (p._tag) p._tag.classList.remove("pending"); };

  // ---------- экраны
  const screens = ["#title", "#chapter", "#scene", "#death", "#awake", "#rewind", "#flow", "#journal", "#me", "#howto", "#about", "#guide"];
  let back = "#title";
  function show(id) {
    for (const s of screens) $(s).hidden = s !== id;
    $("#bar").hidden = id !== "#scene";
    document.body.dataset.screen = id.slice(1);
    bgMode(id === "#title" ? "title" : id === "#scene" || id === "#chapter" ? "dust" : "off");
    snd.screen(id);
    window.scrollTo(0, 0);
  }

  // ---------- жизнь
  function newLife() {
    meta.lives = (meta.lives || 0) + 1; saveMeta();
    S = { scene: C.start, st: initState(), stack: [], trail: [], lifeSeen: {}, awake: null, ghost: null, year: null, replay: false, past: {} };
    enter(C.start);
  }
  const save = () => store.set(SAVE, S);
  const visible = (sc, st) => (sc.choices || []).filter((c) => ok(c.visible, st));

  // ---------- Корень: утопление в семь лет показано языком смерти, но без отката (канон п. 26)
  function rootDeath(done) {
    show("#death");
    snd.stop(); buzz(40);
    $("#death-tc").textContent = "28 ИЮЛЯ 1996, ОКОЛО ПОЛУДНЯ";
    const art = $("#death-text"); art.innerHTML = "";
    art.style.translate = art.style.filter = art.style.transition = "";
    const btn = $("#btn-death-next"); btn.hidden = true;
    const lines = ["Воздух кончается раньше, чем темнота.", "Сверху, через воду, тонкий девчачий голос считает: «…сто девяносто… сто девяносто один…»", "Потом не остаётся ничего, даже счёта."];
    let i = 0;
    const step = () => {
      if (i < lines.length) { const p = document.createElement("p"); p.textContent = lines[i++]; art.append(p); setTimeout(step, REDUCED ? 100 : 1100); return; }
      art.insertAdjacentHTML("beforeend", `<div class="tomb root-tomb">
        <div class="tomb-cross">✝</div>
        <div class="tomb-name">Андрей Николаевич Самохин</div>
        <div class="tomb-years mono">1989 — 1996</div>
        <p class="tomb-epitaph">7 лет. Чёрная заводь. Утонул у коряги.</p>
      </div>
      <p class="root-line mono">Ника считает: <b class="root-count">200</b></p>`);
      const cnt = art.querySelector(".root-count"), tomb = art.querySelector(".root-tomb");
      let n = 200;
      const tick = () => {
        cnt.textContent = n;
        if (n >= 252) { tomb.classList.add("crack"); buzz([30, 60, 30]); setTimeout(() => { const lab = btn.querySelector(".hold-lbl"); const old = lab && lab.textContent; if (lab) lab.textContent = "▶ держи, чтобы вдохнуть"; btn.hidden = false; holdToRewind(btn, art, () => { if (lab) lab.textContent = old; done(); }); }, REDUCED ? 100 : 1200); return; }
        n++; setTimeout(tick, REDUCED ? 5 : 70);
      };
      setTimeout(tick, REDUCED ? 50 : 900);
    };
    setTimeout(step, REDUCED ? 50 : 600);
  }

  function enter(id, restored) {
    const sc = G.scenes[id];
    if (id === "Т-02б" && !restored && S && !S.rootShown) { S.rootShown = true; save(); return rootDeath(() => enter(id)); }
    S.scene = id;
    S.trail = S.trail || []; // старые сохранения: следа выборов ещё не было
    // счётчик секунд: первая сцена цепочки с clock заводит его, следующие продолжают, сцена без clock сбрасывает
    if (!restored) { if (sc.clock == null) delete S.st[CLK]; else if (S.st[CLK] == null) S.st[CLK] = sc.clock; }
    // быстрый ствол (п. 9 разбора): сцену ствола, прожитую в прошлой жизни, не печатаем заново
    S.past = S.past || {};
    if (!restored && !(id in S.past)) S.past[id] = (meta.lives || 0) >= 2 && !!meta.visited[id];
    meta.visited[id] = true;
    if (!(id in meta.vlife)) meta.vlife[id] = meta.lives || 0;
    if (id === "Т-02б") meta.root = true;
    for (const m of C.meta_entries || []) if (m.scene === id && ok(m.if, S.st)) meta.extra[m.id] = true;
    saveMeta();
    if (!restored && visible(sc, S.st).length >= 2) S.stack.push({ scene: id, st: clone(S.st), seal: sealOf(sc), taken: null, trail: S.trail.length });
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
    snd.era(sc.photo || "none");
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
    snd.era(sc.photo || "none");
    snd.heart(false);
    if (sc.stage === "anchor") snd.chorus();
    renderPhoto(sc);
    $("#meta").textContent = [sc.date, sc.age != null ? `мне ${sc.age}` : "", DEBUG ? S.scene : ""].filter(Boolean).join(" · ");
    $("#when").textContent = sc.date || "";
    // после отката сцена уже прочитана: последний абзац и выбор сразу, остальное свёрнуто
    const replay = !!S.replay; S.replay = false;
    // вторая жизнь: ствол уже прожит — свёрнут так же, полный текст по тапу (канон п. 29: ничего не удаляем)
    const lived = !replay && livedTrunk(sc);

    const blocks = [];
    tagUsed = new Set();
    if (S.check) { blocks.push({ md: S.check, cls: "check", own: true }); S.check = null; }
    if (S.awake) { for (const b of S.awake) if (ok(b.if, st)) blocks.push({ md: b.md, cls: "awake", own: true }); S.awake = null; }
    let first = true, lastTag = "";
    for (const b of sc.text) {
      if (!ok(b.if, st)) continue;
      if (b.kind === "chorus") { chorusLines().forEach((l) => blocks.push({ md: l, cls: "chorus talk" })); lastTag = ""; continue; }
      if (b.kind === "norewind") { blocks.push({ md: "", cls: "norewind" }); lastTag = ""; continue; }
      const talk = /^—\s/.test(b.md);
      const cls = [b.drift ? "drift" : "", b.kind || "", talk ? "talk" : ""];
      if (first && !b.kind && !talk) { cls.push("first"); first = false; }
      const tag = echoTag(b.if);
      blocks.push({ md: b.md, cls: cls.join(" ").trim(), tag: tag !== lastTag ? tag : "", key: bkey(b.md) });
      lastTag = tag;
    }
    const art = $("#text"); art.innerHTML = "";
    $("#choices").innerHTML = "";
    // что из этой сцены уже показывалось в прошлых жизнях (до записи этого показа)
    const sb = meta.seenBlocks[S.scene], life = meta.lives || 0;
    const oldBlock = (b) => !sb || (b.key in sb && sb[b.key] < life); // старые сохранения без seenBlocks: всё считаем виденным
    if (lived && sb) for (const b of blocks) if (b.key && !b.own && !oldBlock(b) && !b.tag) b.tag = "◌ иначе, чем в прошлый раз";
    const els = blocks.map((b) => { const p = para(art, b.cls, md(b.md), b.tag); p._own = b.own; p._old = !!b.key && oldBlock(b); return p; });
    const sbNow = (meta.seenBlocks[S.scene] = meta.seenBlocks[S.scene] || {});
    for (const b of blocks) if (b.key && !(b.key in sbNow)) sbNow[b.key] = life;
    saveMeta();
    // «последний откат, которого нет»: привычная лента, которая рассыпается
    els.filter((p) => p.classList.contains("norewind")).forEach((p) => {
      p.innerHTML = `<button class="choice nr-btn"><span class="mono">◀◀</span> Хор помнит…</button>`;
      p.querySelector("button").onclick = (e) => {
        e.stopPropagation();
        p.classList.add("crumble");
        setTimeout(() => { p.innerHTML = `<span class="mono nr-end">Отката нет. И не надо.</span>`; }, REDUCED ? 50 : 1600);
      };
    });
    const finish = () => { clearTimeout(typing); typing = null; els.forEach(reveal); renderChoices(sc); };
    if (replay || lived) {
      const body = els.filter((p) => !p._own);
      // откат: свёрнуто всё, кроме последнего абзаца; быстрый ствол — только абзацы, виденные в прошлой жизни
      const cand = body.slice(0, -1).filter((p) => replay || p._old);
      // складки по сплошным кускам свёрнутого
      const runs = [];
      for (const p of body) { if (cand.includes(p)) { const r = runs[runs.length - 1]; if (r && r.end === body.indexOf(p) - 1) { r.ps.push(p); r.end++; } else runs.push({ ps: [p], end: body.indexOf(p) }); } }
      for (const { ps: hide } of runs) {
        const fold = document.createElement("button");
        fold.className = "seen-fold mono" + (lived ? " lived" : "");
        fold.textContent = lived ? "⋯ ты это уже прожил" : "⋯ ты это уже видел";
        fold.setAttribute("aria-expanded", "false");
        hide.forEach((p) => { p.classList.add("folded"); if (p._tag) p._tag.classList.add("folded"); });
        fold.onclick = (e) => {
          e.stopPropagation();
          hide.forEach((p) => { p.classList.remove("folded"); if (p._tag) p._tag.classList.remove("folded"); });
          fold.remove();
        };
        art.insertBefore(fold, hide[0]._tag || hide[0]);
      }
      art.onclick = null;
      return finish();
    }
    let i = 0;
    const step = () => { if (i >= els.length) return finish(); reveal(els[i]); i++; typing = setTimeout(step, REDUCED ? 60 : 420); };
    art.onclick = () => typing && finish();
    step();
  }

  const livedTrunk = (sc) => !!(S && S.past && S.past[S.scene]) && (sc.stage === "trunk" || sc.stage === "prologue");

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
    const ph = $("#photo"), pc = $("#photo-cap");
    const sid = sc.id || S.scene;
    ph.className = "photo era-" + (sc.photo || "none");
    ph.innerHTML = "";
    ph.hidden = true; // фото показываем, только когда оно есть: без заглушек
    ph.dataset.sid = sid;
    pc.hidden = true; pc.textContent = "";
    if (!sc.photo) return;
    const img = new Image();
    img.alt = sc.photo_caption || "";
    img.onload = () => { if (ph.dataset.sid === sid) ph.hidden = false; };
    img.onerror = () => {
      img.remove();
      if (ph.dataset.sid !== sid) return;
      ph.hidden = true;
      if (sc.photo_caption) { pc.textContent = sc.photo_caption; pc.hidden = false; }
    };
    img.src = "img/" + encodeURIComponent(sid) + ".jpg";
    const cap = document.createElement("figcaption");
    cap.textContent = sc.photo_caption || "";
    ph.append(img, cap);
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
    const vis = visible(sc, st).filter((c) => !isWip(c));
    const dar = st["ДАР"] || 0;
    meta.shown[S.scene] = meta.shown[S.scene] || {};
    const left = leftOf(sc);
    if (left != null && vis.length) {
      const full = Math.max(1, sc.clock || left);
      nav.insertAdjacentHTML("beforeend", `<div class="clock mono${left <= full * 0.34 ? " low" : ""}" role="timer" aria-label="осталось ${left} секунд, ${esc(sc.clock_label || "")}">
        <span class="clock-n">⏱ ${left} с</span><span class="clock-l">· ${esc(sc.clock_label || "")}</span>
        <span class="clock-bar"><i style="transform:scaleX(${(left / full).toFixed(3)})"></i></span></div>`);
    }
    // смерти-разведка: их ✝ открывает в этой же сцене вариант через seen_life — холодок от них не отводит
    const unlockers = new Set();
    for (const c of sc.choices || []) seenIds(c.visible, true).forEach((id) => unlockers.add(id));
    const pastTaken = (S.past && S.past[S.scene]) ? meta.taken[S.scene] || {} : {};
    const life = meta.lives || 0;
    let knows = false, cold = false;
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
      const mem = lessonsFor(c.visible, true);
      if (mem.length) b.insertAdjacentHTML("beforeend", `<small class="mem-cap mono">⟲ память: ${esc(mem.join(" · "))}</small>`);
      if (hasMeta(c.visible)) { const mm = lessonsFor(c.visible, false); b.classList.add("meta-echo"); b.insertAdjacentHTML("beforeend", `<small class="meta-cap mono">◌ память другой жизни${mm.length ? ": " + esc(mm.join(" · ")) : ""}</small>`); }
      const tooLate = late(sc, c);
      if (left != null && c.cost) b.insertAdjacentHTML("beforeend", `<small class="cost mono">${tooLate ? "не успеть · " : ""}−${c.cost} с</small>`);
      if (tooLate) { b.classList.add("locked", "late"); b.disabled = true; nav.append(b); return; }
      // «холодок»: дар чует смертельный исход при нынешнем состоянии (тот же выбор исхода, что в choose)
      const o = c.outcomes.find((x) => ok(x.if, st));
      const pt = pastTaken[c.id];
      if (pt === true || (typeof pt === "number" && pt < life)) b.insertAdjacentHTML("beforeend", `<small class="past-cap mono">в прошлой жизни я выбрал это</small>`);
      // «холодок» (баланс v1.9): ДАР 20–59 — одна строка над вариантами, без указания кнопки;
      // ДАР ≥ 60 — метка на конкретной смертельной кнопке. Ложное эхо (вариант памяти, ведущий в смерть) дар не метит никогда.
      const deadly = !!o && o.to.startsWith("✝");
      const falseEcho = deadly && (seenIds(c.visible, true).length > 0 || seenIds(c.visible, false).length > 0);
      if (deadly) {
        if (dar < 20) { if (unlockers.has(o.to) && !S.lifeSeen[o.to]) knows = true; } // эхо возможно, а дар ещё молчит
        else if (!falseEcho) {
          cold = true;
          if (dar >= 60) { b.classList.add("cold", "shiver"); b.insertAdjacentHTML("beforeend", `<small class="whisper">не надо</small>`); }
        }
      }
      if (DEBUG) b.insertAdjacentHTML("beforeend", `<small class="mono dbg">[${c.id}] ${esc(c.outcomes.map((o) => (o.if_src ? o.if_src + " → " : "") + o.to).join(" | "))}</small>`);
      b.onclick = () => choose(sc, c);
      nav.append(b);
    });
    // Хор знает о чём-то, но не говорит, о какой кнопке
    if (cold && dar < 60) { const k = document.createElement("p"); k.className = "cold-line mono"; k.textContent = "❄ холодок в затылке: здесь что-то не так"; nav.insertBefore(k, nav.querySelector(".choice")); }
    else if (knows && !cold) { const k = document.createElement("p"); k.className = "chorus-knows mono"; k.textContent = "◌ Хор о чём-то знает"; nav.insertBefore(k, nav.querySelector(".choice")); }
    // закрытые варианты: текст не показываем, только чего не хватило
    for (const c of sc.choices || []) {
      const wip = isWip(c);
      if (!wip && (!c.visible || ok(c.visible, st) || /seen/.test(JSON.stringify(c.visible)))) continue;
      const b = document.createElement("button");
      b.className = "choice locked" + (wip ? " wip" : ""); b.disabled = true;
      b.innerHTML = `<span class="num mono">·</span><span class="lbl">— — —</span><small>${esc(wip ? "эта жизнь ещё пишется" : lockReason(c.visible, st))}</small>`;
      nav.append(b);
    }
    saveMeta();
    if (cold) { snd.cold(); buzz(8); }
    snd.heart(left != null && vis.length > 0 && left <= Math.max(1, sc.clock || left) * 0.34);
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
    if (late(sc, c)) return; // не успеть: кнопка закрыта, клавиатура тоже не проведёт
    const st = S.st;
    const o = c.outcomes.find((x) => ok(x.if, st));
    const top = S.stack[S.stack.length - 1];
    if (top && top.scene === S.scene) top.taken = c.id;
    meta.taken[S.scene] = meta.taken[S.scene] || {};
    if (!meta.taken[S.scene][c.id]) meta.taken[S.scene][c.id] = meta.lives || 0;
    saveMeta();
    if (o.to.startsWith("✝")) { S.deathIf = [o.if, c.visible].filter(Boolean); return die(o.to); }
    const check = statCheck(c, o, st);
    const next = clone(st);
    if (sc.clock != null && next[CLK] != null) next[CLK] = Math.max(0, next[CLK] - (c.cost || 0));
    applyFx(c.fx, next);
    if (o.fx) applyFx(o.fx, next);
    // след выборов этой жизни: какие флаги поставил этот выбор (для меток «↩»)
    const setHere = [...(c.fx || []), ...(o.fx || [])].filter(([k, n]) => k === "set" && C.flags[n]).map((x) => x[1]);
    (S.trail = S.trail || []).push({ scene: S.scene, choice: c.id, flags: setHere });
    const after = sc.after && sc.after[c.id];
    if (after) return showAfter(c, after.filter((b) => ok(b.if, next)), () => { S.st = next; enter(o.to); }, new Set(setHere), check);
    S.st = next;
    S.check = check;
    enter(o.to);
  }

  // плашка проверки (п. 4.3 разбора): исход решил стат-порог — словами, без цифр
  function statCheck(c, o, st) {
    const statCmp = (e, acc = []) => {
      if (!e || typeof e !== "object") return acc;
      if (e.op === "cmp" && e.l && e.l.op === "var" && e.r && e.r.op === "num" && C.vars[e.l.n] && !C.vars[e.l.n].hidden) acc.push(e);
      for (const k of ["a", "l", "r"]) { const x = e[k]; if (Array.isArray(x)) x.forEach((y) => statCmp(y, acc)); else statCmp(x, acc); }
      return acc;
    };
    const gate = c.outcomes.find((x) => statCmp(x.if).length);
    if (!gate) return null;
    const passed = gate === o;
    const names = [...new Set(statCmp(gate.if).filter((e) => ev(e, st) === passed).map((e) => C.vars[e.l.n].name.toUpperCase()))];
    if (!names.length) return null;
    return names.join(" · ") + " · " + (passed ? "хватило" : "не хватило");
  }

  // ---------- «что было дальше»: последствие выбора сразу, на том же экране
  function showAfter(c, blocks, go, setHere, check) {
    const nav = $("#choices"); nav.innerHTML = "";
    const art = $("#text");
    art.querySelectorAll(".seen-fold").forEach((f) => f.remove()); // складка не остаётся кнопкой над «Дальше»
    const picked = document.createElement("p");
    picked.className = "picked mono";
    picked.innerHTML = "▸ " + md(c.label);
    art.append(picked);
    if (check) { const k = document.createElement("p"); k.className = "check mono"; k.textContent = check; art.append(k); }
    let lastTag = "";
    const els = blocks.map((b) => {
      const tag = echoTag(b.if, setHere);
      const p = para(art, ["after", b.kind || "", /^—\s/.test(b.md) ? "talk" : ""].join(" ").trim(), md(b.md), tag !== lastTag ? tag : "");
      lastTag = tag;
      return p;
    });
    picked.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });
    const done = () => {
      clearTimeout(typing); typing = null;
      els.forEach(reveal);
      const b = document.createElement("button");
      b.className = "choice next"; b.textContent = "Дальше";
      b.onclick = go;
      nav.append(b);
    };
    if (livedTrunk(G.scenes[S.scene])) return done(); // прожитый ствол: последствие сразу целиком
    let i = 0;
    const step = () => { if (i >= els.length) return done(); reveal(els[i]); i++; typing = setTimeout(step, REDUCED ? 60 : 520); };
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
    snd.stop(); buzz(40);
    $("#death-tc").textContent = (d.date || "").toUpperCase();
    const art = $("#death-text"); art.innerHTML = "";
    art.style.translate = art.style.filter = art.style.transition = "";
    $("#death").classList.remove("spool");
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
      setTimeout(() => { btn.hidden = false; holdToRewind(btn, art, () => awaken(did, first)); }, REDUCED ? 100 : 1400);
    };
    setTimeout(step, REDUCED ? 50 : 700);
  }

  // «держи, чтобы перемотать»: ~700 мс, полоса заполняется, текст смерти уезжает вверх лентой.
  // Короткий тап, Enter и пробел тоже срабатывают (click) — для доступности.
  const HOLD_MS = 700;
  function holdToRewind(btn, art, go) {
    const scr = $("#death"), fill = btn.querySelector(".hold-fill");
    let t0 = null, raf = null, gone = false;
    const set = (k) => {
      if (fill) fill.style.transform = `scaleX(${k})`;
      snd.rewSet(k);
      if (!REDUCED) { art.style.translate = `0 ${(-k * 40).toFixed(1)}vh`; art.style.filter = k ? `blur(${(k * 1.6).toFixed(2)}px)` : ""; }
    };
    const reset = () => { snd.rewStop(); t0 = null; cancelAnimationFrame(raf); art.style.transition = ""; set(0); btn.classList.remove("holding"); scr.classList.remove("spool"); };
    const finish = () => {
      if (gone) return;
      gone = true; cancelAnimationFrame(raf);
      buzz([25, 35, 50]);
      scr.classList.add("spool");
      const fast = t0 == null || performance.now() - t0 < HOLD_MS; // тап: доматываем быстро
      snd.rewFinish(fast);
      if (fast && !REDUCED) art.style.transition = "translate .24s ease-in, filter .24s ease-in";
      set(1);
      setTimeout(() => { btn.onclick = btn.onpointerdown = btn.onpointerleave = btn.onpointercancel = null; go(); }, REDUCED || !fast ? 0 : 240);
    };
    const tick = (now) => { const k = Math.min(1, (now - t0) / HOLD_MS); set(k); if (k >= 1) return finish(); raf = requestAnimationFrame(tick); };
    btn.onpointerdown = (e) => {
      if (gone || (e.button != null && e.button > 0)) return;
      t0 = performance.now(); art.style.transition = "";
      btn.classList.add("holding"); scr.classList.add("spool"); buzz(12);
      snd.unlock(); snd.rewStart();
      raf = requestAnimationFrame(tick);
    };
    btn.onpointerleave = btn.onpointercancel = () => { if (!gone && t0 != null) reset(); };
    btn.oncontextmenu = (e) => e.preventDefault();
    btn.onclick = finish;
    reset();
  }

  function rewindOptions() {
    const depth = depthFor(S.st["ДАР"] || 0);
    const cur = G.scenes[S.scene];
    if (!S.stack.length || S.stack[S.stack.length - 1].scene !== S.scene) S.stack.push({ scene: S.scene, st: clone(S.st), seal: sealOf(cur), taken: null, trail: (S.trail || []).length });
    const opts = [], all = [];
    const sealNow = S.stack[S.stack.length - 1].seal;
    // all — засечки этой главы жизни (до 8), opts — те, до которых дотягивается дар
    for (let k = 0; k < 8; k++) {
      const idx = S.stack.length - 1 - k;
      if (idx < 0 || S.stack[idx].seal !== sealNow) break;
      all.push(idx);
      if (k < depth) opts.push(idx);
    }
    return { depth, opts, all };
  }

  function restore(idx, n) {
    const snap = S.stack[idx];
    S.stack = S.stack.slice(0, idx + 1);
    S.trail = (S.trail || []).slice(0, snap.trail ?? 0);
    S.replay = true;
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
    // первый шок первой жизни — полный; первая смерть следующих жизней — короткий shock_later; дальше одна строка: игрок уже знает, что происходит
    ((first ? ((meta.lives || 0) >= 2 && C.shock_later && C.shock_later.length ? C.shock_later : C.shock_first) : (C.shock_again || []).slice(0, 1)) || []).forEach((s) => paras.push({ md: s, cls: "shock" }));
    own.slice(1).forEach((b) => paras.push({ md: b.md, cls: "" }));
    const els = paras.map((x) => { const p = document.createElement("p"); p.className = x.cls; p.innerHTML = md(x.md); p.classList.add("pending"); art.append(p); return p; });
    let finished = false, startT = null;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(startT); clearTimeout(typing); typing = null;
      els.forEach((p) => p.classList.remove("pending"));
      const { depth, opts, all } = rewindOptions();
      const cause = causeOf(did);
      if (d.lesson) art.insertAdjacentHTML("beforeend", `<p class="mem-new mono">+ в памяти: ${esc(d.lesson)}</p>`);
      if (opts.length <= 1) {
        const b = document.createElement("button");
        b.className = "choice"; b.textContent = "Вдохнуть";
        b.onclick = () => restore(opts[0], 0);
        nav.append(b);
        // ловушка с причиной в прошлом, а дар не дотягивается: ленту всё равно можно посмотреть
        if (cause && all.some((i) => S.stack[i].scene === cause)) {
          const t = document.createElement("button");
          t.className = "choice ghost-choice"; t.innerHTML = `<span class="lbl">Посмотреть ленту</span>`;
          t.onclick = () => showTape(depth, opts, all, did);
          nav.append(t);
        }
      } else {
        const s = document.createElement("button");
        s.className = "choice"; s.textContent = "Вдохнуть и остаться в этой минуте";
        s.onclick = () => restore(opts[0], 0);
        const b = document.createElement("button");
        b.className = "choice ghost-choice"; b.innerHTML = `<span class="lbl">Хор помнит больше. Вернуться ещё дальше назад</span>`;
        b.onclick = () => showTape(depth, opts, all, did);
        nav.append(s, b);
      }
    };
    let i = 0;
    const step = () => { if (finished) return; if (i >= els.length) return done(); els[i].classList.remove("pending"); i++; typing = setTimeout(step, REDUCED ? 60 : 1100); };
    art.onclick = done;
    startT = setTimeout(step, REDUCED ? 30 : 500);
  }

  // ---------- лента отката: кассета с засечками (п. 11 разбора)
  // ловушка с причиной в прошлом: у смерти cause {if, scene}; при выполненном условии засечка scene — «здесь началось»
  function causeOf(did) {
    const c = (G.deaths[did] || {}).cause;
    return c && S && ok(c.if, S.st) ? c.scene : null;
  }
  const short = (s, n = 46) => { s = String(s || "").replace(/\*\*|\*/g, "").replace(/^«[^»]*»\.?\s*/, "").trim(); return s.length > n ? s.slice(0, n - 1).replace(/[\s,.;:—-]+\S*$/, "") + "…" : s; };
  function showTape(depth, opts, all, did) {
    show("#rewind");
    all = all && all.length ? all : opts;
    const cause = causeOf(did);
    $("#rew-depth").textContent = WORDS[opts.length] || "";
    const tape = $("#tape"); tape.innerHTML = "";
    const cas = document.createElement("div"); cas.className = "cassette";
    cas.innerHTML = `<div class="reels" aria-hidden="true"><i class="reel"></i><span class="mono tiny">◀◀ тяни ленту или тронь засечку</span><i class="reel"></i></div>`;
    const film = document.createElement("div"); film.className = "film"; film.setAttribute("role", "listbox"); film.setAttribute("aria-label", "лента этой жизни");
    const strip = document.createElement("div"); strip.className = "strip";
    const head = document.createElement("div"); head.className = "head"; head.setAttribute("aria-hidden", "true");
    const notches = [];
    // флаги, на которых держится эта смерть: условие cause и условия исхода/варианта, который убил
    const dflags = new Set();
    const dc = (G.deaths[did] || {}).cause;
    if (dc) flagsIn(dc.if, dflags);
    for (const e of S.deathIf || []) flagsIn(e, dflags);
    const pulls = (snap) => { const t = (S.trail || [])[snap.trail ?? -1]; return !!t && t.scene === snap.scene && (t.flags || []).some((f) => dflags.has(f) && ((G.flag_src || {})[f] || []).includes(snap.scene)); };
    // слева старое, справа — эта минута
    [...all].reverse().forEach((idx) => {
      const n = all.indexOf(idx); // сколько шагов назад
      const snap = S.stack[idx], sc = G.scenes[snap.scene] || {};
      const pick = (sc.choices || []).find((c) => c.id === snap.taken);
      const can = opts.includes(idx);
      const b = document.createElement("button");
      b.className = "notch" + (can ? " on" : " burnt") + (n === 0 ? " now" : "") + (cause && snap.scene === cause ? " cause" : "");
      b.disabled = !can;
      b.dataset.idx = idx; b.dataset.n = n;
      const y = yearOf(sc.date);
      b.innerHTML = `<i class="tick"></i><span class="n-when mono">${n === 0 ? "сейчас" : esc(y || "")}</span>` +
        `<span class="n-title">${esc((sc.title || snap.scene).replace(/^Демо\.\s*/, ""))}</span>` +
        `<span class="n-pick">${pick ? "▸ " + esc(short(pick.label)) : "—"}</span>` +
        (cause && snap.scene === cause ? `<small class="n-cause mono">↩ здесь началось</small>` : n > 0 && pulls(snap) ? `<small class="n-pull mono">◌ отсюда тянется</small>` : "") +
        (can ? "" : `<small class="n-burnt mono">дар не дотягивается</small>`);
      b.onclick = () => { if (!film.dragged) spin(b); };
      strip.append(b); notches.push(b);
    });
    film.append(strip, head); cas.append(film);
    const info = document.createElement("p"); info.className = "tape-info dim tiny mono";
    const burnt = all.length - opts.length;
    info.textContent = burnt > 0 ? `дар дотягивается на ${WORDS[opts.length] || opts.length}, дальше лента засвечена` : all.length >= 8 ? "дальше лента склеена" : "дальше Хор не помнит";
    if (cause && !opts.some((i) => S.stack[i].scene === cause) && all.some((i) => S.stack[i].scene === cause)) info.textContent = "туда, где всё началось, дар пока не дотягивается";
    cas.append(info); tape.append(cas);
    const stay = document.createElement("button");
    stay.className = "choice ghost-choice"; stay.textContent = "Остаться в этой минуте";
    stay.onclick = () => restore(opts[0], 0);
    tape.append(stay);
    // головка стоит на «сейчас»; лента прокручена к правому краю
    const xOf = (b) => b.offsetLeft + b.offsetWidth / 2;
    const place = (x) => { head.style.transform = `translateX(${x.toFixed(1)}px)`; };
    const nowB = notches[notches.length - 1];
    // видно «сейчас», яркие засечки и край засвеченной ленты
    requestAnimationFrame(() => { film.scrollLeft = film.scrollWidth; place(xOf(nowB)); });
    let busy = false;
    function spin(b) {
      if (busy || b.disabled) return;
      busy = true; tape.classList.add("spinning"); b.classList.add("pick");
      const idx = +b.dataset.idx, n = +b.dataset.n;
      const x0 = xOf(nowB), x1 = xOf(b), dur = REDUCED ? 0 : 380 + 260 * n;
      snd.unlock(); snd.rewStart(); buzz(14);
      const passed = new Set();
      const t0 = performance.now();
      const step = (now) => {
        const k = dur ? Math.min(1, (now - t0) / dur) : 1, e = 1 - Math.pow(1 - k, 2);
        const x = x0 + (x1 - x0) * e; place(x); snd.rewSet(k);
        film.scrollLeft = x - film.clientWidth / 2;
        for (const o of notches) if (!passed.has(o) && o !== nowB && xOf(o) >= x) { passed.add(o); buzz(6); }
        if (k < 1) return requestAnimationFrame(step);
        snd.rewFinish(n > 0); buzz([25, 35, 50]);
        setTimeout(() => restore(idx, n), REDUCED ? 0 : 260);
      };
      requestAnimationFrame(step);
    }
    // перетаскивание: тянешь ленту вправо — головка уходит в прошлое; отпустил у яркой засечки — перемотка туда
    let drag = null;
    film.onpointerdown = (e) => {
      if (busy || (e.button != null && e.button > 0)) return;
      drag = { x: e.clientX, h: xOf(nowB), on: null }; film.dragged = false;
    };
    film.onpointermove = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (!film.dragged && Math.abs(dx) < 8) return;
      if (!film.dragged) { film.dragged = true; try { film.setPointerCapture(e.pointerId); } catch (err) { /* нет захвата */ } snd.unlock(); snd.rewStart(); }
      const x = Math.max(xOf(notches[0]), Math.min(xOf(nowB), drag.h - dx * 1.4));
      place(x);
      snd.rewSet(Math.min(1, Math.abs(xOf(nowB) - x) / Math.max(1, xOf(nowB) - xOf(notches[0]))));
      let best = null, bd = 1e9;
      for (const o of notches) { const d = Math.abs(xOf(o) - x); if (d < bd) { bd = d; best = o; } }
      if (best !== drag.on) { if (drag.on) drag.on.classList.remove("under"); best.classList.add("under"); drag.on = best; buzz(best.disabled ? [4, 20, 4] : 8); }
    };
    film.onpointerup = film.onpointercancel = () => {
      if (!drag) return;
      const d = drag; drag = null;
      if (d.on) d.on.classList.remove("under");
      if (!film.dragged) return;
      setTimeout(() => { film.dragged = false; }, 0);
      if (d.on && !d.on.disabled && d.on !== nowB) { snd.rewStop(); return spin(d.on); }
      snd.rewStop(); place(xOf(nowB));
    };
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
    if (id === "#journal") snd.chorus();
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
    let n = 1, curLife = null;
    // по жизням, внутри жизни — по порядку смертей
    const dead = Object.entries(G.deaths).filter(([id]) => meta.journal[id])
      .sort((a, b) => ((meta.journal[a[0]].life || 1) - (meta.journal[b[0]].life || 1)) || String(meta.journal[a[0]].first).localeCompare(String(meta.journal[b[0]].first)));
    const lifeNo = (j) => j.life || 1;
    const many = new Set(dead.map(([id]) => lifeNo(meta.journal[id]))).size > 1 || (meta.lives || 0) > 1;
    for (const [id, d] of dead) {
      const j = meta.journal[id];
      any = true;
      if (many && lifeNo(j) !== curLife) { curLife = lifeNo(j); list.insertAdjacentHTML("beforeend", `<div class="nb-life mono">Жизнь ${curLife}</div>`); }
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
      // «Что я вынес»: карточки знаний из смертей этой жизни (lesson у ✝)
      const cards = Object.keys(S.lifeSeen || {}).map((id) => [id, G.deaths[id]]).filter(([, d]) => d && d.lesson);
      if (cards.length) me.insertAdjacentHTML("beforeend", `<h3 class="memo-h">Что я вынес</h3><div class="lessons">${cards.map(([, d]) =>
        `<div class="lesson"><b>${esc(d.lesson)}</b><small class="mono">✝ ${esc(yearOf(d.date) || "")} · ${esc(d.title || "")}</small></div>`).join("")}</div><p class="dim tiny">Это осталось от смертей этой жизни. Эхо-выбор, открытый такой памятью, подписан ⟲.</p>`);
      if (items.length) me.insertAdjacentHTML("beforeend", `<h3 class="memo-h">Что со мной было</h3><ul class="memo">${items.map((t) => `<li>${md(t)}</li>`).join("")}</ul><p class="dim tiny">Это помнит не только тот, кто это пережил. Это помнит сюжет.</p>`);
    }
    if (!S) me.innerHTML = `<p class="dim">Жизнь ещё не начата.</p>`;
    soundBtn();
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
    const wide = w >= 960, px = wide ? w * 0.3 : w * 0.5, py = h * (wide ? 0.88 : 0.94), rx = Math.min(w * (wide ? 0.26 : 0.46), 340), ry = rx * 0.18;
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

  // ---------- титул: продолжение, прогресс, счётчики разделов
  const savedLife = () => {
    const sv = store.get(SAVE, null);
    const sc = sv && G.scenes[sv.scene];
    if (!sc || (!(sc.choices || []).length && !sc.next)) return null; // финал прожит — продолжать нечего
    return { sv, sc };
  };
  let newArmed = null;
  function showTitle() {
    show("#title");
    document.body.dataset.era = "none"; // на титуле — натриевый акцент, а не цвет эпохи последней сцены
    const ids = Object.keys(G.scenes), ends = ids.filter((id) => G.scenes[id].stage === "final"), deaths = Object.keys(G.deaths);
    const seenE = ends.filter((id) => meta.visited[id]).length, seenD = deaths.filter((id) => meta.journal[id]).length;
    const lives = meta.lives || 0;
    $("#title-line").textContent = lives
      ? `прожито жизней: ${lives} · концовок ${seenE} из ${ends.length} · смертей ${seenD} из ${deaths.length}`
      : `впереди: ${ends.length} концовок · ${deaths.length} смертей · ${ids.length} сцен`;
    const live = savedLife();
    const cb = $("#btn-continue"), nb = $("#btn-new");
    cb.hidden = !live;
    nb.classList.toggle("ghost-choice", !!live);
    disarmNew();
    if (live) {
      const y = yearOf(live.sc.date);
      $("#continue-sub").textContent = `жизнь ${lives || 1}${y ? " · " + y : ""} · «${(live.sc.title || live.sv.scene).replace(/^Демо\.\s*/, "")}»`;
    }
    const jn = Object.keys(meta.journal || {}).length + (meta.root ? 1 : 0);
    $("#m-journal").textContent = jn ? `${jn} ${jn % 10 === 1 && jn % 100 !== 11 ? "строка" : jn % 10 >= 2 && jn % 10 <= 4 && (jn % 100 < 12 || jn % 100 > 14) ? "строки" : "строк"}` : "пусто";
    $("#m-flow").textContent = `${ids.filter((id) => meta.visited[id]).length}/${ids.length}`;
    $("#m-guide").textContent = `${seenE}/${ends.length}`;
    soundBtn();
    if (typeof devTitle === "function") devTitle();
  }
  function disarmNew() {
    clearTimeout(newArmed); newArmed = null;
    $("#btn-new").classList.remove("armed");
    $("#btn-new .cta-l").textContent = "Новая жизнь";
    $("#new-sub").textContent = "с лета 1996-го, мне семь";
  }

  // ---------- кнопки
  // при живом сохранении «Новая жизнь» просит второе нажатие: первое только предупреждает
  $("#btn-new").onclick = () => {
    if (!savedLife() || newArmed) { disarmNew(); return newLife(); }
    $("#btn-new").classList.add("armed");
    $("#btn-new .cta-l").textContent = "Начать заново?";
    $("#new-sub").textContent = "нажми ещё раз: эта жизнь оборвётся, Хор и схема останутся";
    newArmed = setTimeout(disarmNew, 5000);
  };
  $("#btn-continue").onclick = () => { S = store.get(SAVE, null); if (S) { S.year = S.year || null; enter(S.scene, true); } };
  for (const [btn, panel] of [["#btn-journal", "#journal"], ["#btn-journal2", "#journal"], ["#btn-me", "#me"], ["#btn-flow", "#flow"], ["#btn-flow2", "#flow"], ["#btn-howto2", "#howto"], ["#btn-guide", "#guide"], ["#btn-guide2", "#guide"], ["#btn-guide3", "#guide"], ["#btn-howto", "#howto"], ["#btn-about", "#about"], ["#btn-about2", "#about"]])
    $(btn).onclick = () => openPanel(panel);
  $("#btn-quit").onclick = showTitle;
  function soundBtn() { for (const b of document.querySelectorAll("#btn-sound, #btn-sound2")) { b.textContent = snd.on() ? "звук: вкл" : "звук: выкл"; b.setAttribute("aria-pressed", String(snd.on())); } }
  for (const id of ["#btn-sound", "#btn-sound2"]) $(id).onclick = () => { snd.toggle(); soundBtn(); buzz(10); };
  document.querySelectorAll(".close").forEach((b) => (b.onclick = closePanel));
  showTitle();
})();
