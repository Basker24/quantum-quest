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
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* без сохранений */ } },
  };
  // мета — сквозная для всех жизней: Хор, схема, увиденное
  let meta = Object.assign({ journal: {}, lives: 0, root: false, visited: {}, taken: {}, shown: {}, extra: {}, guide: {}, seenBlocks: {} }, store.get(META, {}));
  meta.seenBlocks = meta.seenBlocks || {}; // сцена → {ключ абзаца: номер жизни, когда показан впервые}
  meta.guide = meta.guide || {};
  // lived(ID): номер жизни, в которой сцена посещена впервые. Старые сохранения: всё, что уже в visited, — прошлые жизни (0).
  meta.vlife = meta.vlife || {};
  for (const id of Object.keys(meta.visited || {})) if (!(id in meta.vlife)) meta.vlife[id] = 0;
  let guideOn = null; // финал, чей путь подсвечен на схеме
  let guideCut = null; // начатая дорога: подсвечивать только первые N шагов (дальше — туман)
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
      case "kinds": return kindsSeen().size;     // мета-гейт Ф-04 (канон п. 14): разные стихии в Журнале
      case "branches": return branchesLived().size; // разные жизни-ветви, в которых я жил (В2.1 и В2.2 — две)
      case "one_life": return !!(S && S.oneLife);   // режим «Одна жизнь»
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
  // стихии смертей из Журнала (все жизни, включая эту)
  const kindsSeen = () => new Set(Object.keys(meta.journal || {}).map((id) => (G.deaths[id] || {}).stihia).filter(Boolean));
  // ветвь сцены: В1, В3…В7, В2.1, В2.2; общая часть В2 считается отдельно, только если ни в одну из двух не попал
  const branchKey = (id) => { const m = /^В(\d)(?:\.(\d))?-/.exec(id); return m ? "В" + m[1] + (m[2] ? "." + m[2] : "") : null; };
  function branchesLived() {
    const out = new Set();
    for (const id of Object.keys(meta.visited || {})) { const k = branchKey(id); if (k) out.add(k); }
    if (out.has("В2.1") || out.has("В2.2")) out.delete("В2");
    return out;
  }

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
      return; // фон эпохи (шипение плёнки, гул) выключен по решению автора: музыка его заменяет
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
      // «холодок»: очень тихий низкий тон + при ДАРе 60+ хор-шёпоты (qqm_chill через QQM)
      cold() { if (!live()) return; tone(98, { a: 0.5, d: 1.6, g: 0.05 }); tone(73.4, { a: 0.7, d: 1.8, g: 0.035 }); if (window.QQM && S && (S.st["ДАР"] || 0) >= 60) QQM.chill(); },
      clockT: null,
      // тикающие часы острой сцены: осталось secondsLeft — тики ускоряются к нулю и громче
      clock(secondsLeft) {
        if (!live() || secondsLeft == null || secondsLeft > 30) { this.clockStop(); return; }
        const step = () => {
          const left = (S && S.st && S.st[CLK] != null) ? S.st[CLK] : null;
          if (left == null) { this.clockStop(); return; }
          const k = 1 - Math.min(1, left / 30);
          noise(0, 0.012, 0.05 + 0.09 * k, 3400);
          tone(1850, { d: 0.045, g: 0.03 + 0.05 * k, to: 1150 });
        };
        step();
        clearInterval(this.clockT);
        this.clockT = setInterval(() => {
          const left = (S && S.st && S.st[CLK] != null) ? S.st[CLK] : null;
          if (left == null || left <= 0) { this.clockStop(); return; }
          const gap = Math.max(280, Math.min(950, left * 55));
          clearInterval(this.clockT);
          this.clockT = setInterval(step, gap);
          step();
        }, 950);
      },
      clockStop() { if (this.clockT) { clearInterval(this.clockT); this.clockT = null; } },
      // скрип крышки надгробия
      creak() { if (!live()) return; tone(640, { a: 0.06, d: 0.9, g: 0.045, type: "sawtooth", to: 210 }); noise(0.02, 0.5, 0.045, 900); },
      // шелест страниц тетради
      paper() { if (!live()) return; noise(0, 0.16, 0.14, 1100); noise(0.1, 0.1, 0.08, 1600); },
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
  const hasMeta = (e) => !!e && typeof e === "object" && ((e.op === "seen" && !e.life) || e.op === "lived" || e.op === "kinds" || e.op === "branches" || ["a", "l", "r"].some((k) => (Array.isArray(e[k]) ? e[k].some(hasMeta) : hasMeta(e[k]))));

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
  const screens = ["#intro", "#title", "#chapter", "#scene", "#death", "#awake", "#rewind", "#flow", "#journal", "#me", "#howto", "#about", "#guide", "#devstate", "#devstats", "#devjump"];
  let back = "#title";
  function show(id) {
    for (const s of screens) $(s).hidden = s !== id;
    $("#bar").hidden = id !== "#scene";
    document.body.dataset.screen = id.slice(1);
    bgMode(id === "#intro" ? "title" : id === "#scene" || id === "#chapter" ? "dust" : "off");
    snd.screen(id);
    if (id !== "#title") { const f = document.getElementById("cta-float"); if (f) f.classList.add("off"); }
    if (window.QQM) { QQM.setMuted(!snd.on()); QQM.screen(id); } // меню-тема на титуле; сначала узнать, включён ли звук
    if (id !== "#scene") snd.clockStop(); // покидаем сцену — часы молчат
    window.scrollTo(0, 0);
  }

  // ---------- жизнь
  // oneLife — режим «Одна жизнь» (открывается после Ф-04): смерть окончательна, отката нет
  function newLife(oneLife) {
    meta.lives = (meta.lives || 0) + 1; saveMeta();
    S = { oneLife: oneLife === true, scene: C.start, st: initState(), stack: [], trail: [], lifeSeen: {}, lifeBlocks: {}, awake: null, ghost: null, year: null, replay: false, past: {} };
    enter(C.start);
  }
  const save = () => store.set(SAVE, S);
  const visible = (sc, st) => (sc.choices || []).filter((c) => ok(c.visible, st));

  // ---------- Корень: утопление в семь лет показано языком смерти, но без отката (канон п. 26)
  function rootDeath(done) {
    show("#death");
    snd.stop(); buzz(40); if (window.QQM) QQM.stinger();
    $("#death-tc").textContent = "28 ИЮЛЯ 1996, ОКОЛО ПОЛУДНЯ";
    const art = $("#death-text"); art.innerHTML = "";
    art.style.translate = art.style.filter = art.style.transition = "";
    const btn = $("#btn-death-next"); btn.hidden = true;
    const one = !!(S && S.oneLife); // «Одна жизнь»: вытащили за сорок секунд, дар не проснулся
    const lines = one
      ? ["Воздух кончается раньше, чем темнота.", "Сверху, через воду, тонкий девчачий голос считает: «…двадцать девять… тридцать…»", "Потом чья-то рука хватает меня за майку раньше, чем кончается счёт."]
      : ["Воздух кончается раньше, чем темнота.", "Сверху, через воду, тонкий девчачий голос считает: «…сто девяносто… сто девяносто один…»", "Потом не остаётся ничего, даже счёта."];
    let i = 0;
    const step = () => {
      if (i < lines.length) { const p = document.createElement("p"); p.textContent = lines[i++]; art.append(p); setTimeout(step, REDUCED ? 100 : 1100); return; }
      snd.creak(); // скрип крышки надгробия
      art.insertAdjacentHTML("beforeend", `<div class="tomb root-tomb">
        <div class="tomb-cross">✝</div>
        <div class="tomb-name">Андрей Николаевич Самохин</div>
        <div class="tomb-years mono">1989 — 1996</div>
        <p class="tomb-epitaph">7 лет. Чёрная заводь. Утонул у коряги.</p>
      </div>
      <p class="root-line mono">Ника считает: <b class="root-count">${one ? 25 : 200}</b></p>`);
      const cnt = art.querySelector(".root-count"), tomb = art.querySelector(".root-tomb");
      let n = one ? 25 : 200;
      const goal = one ? 40 : 252;
      const tick = () => {
        cnt.textContent = n;
        if (n >= goal) { tomb.classList.add("crack"); buzz([30, 60, 30]); setTimeout(() => { const lab = btn.querySelector(".hold-lbl"); const old = lab && lab.textContent; if (lab) lab.textContent = "▶ держи, чтобы вдохнуть"; btn.hidden = false; holdToRewind(btn, art, () => { if (lab) lab.textContent = old; done(); }); }, REDUCED ? 100 : 1200); return; }
        n++; setTimeout(tick, REDUCED ? 5 : 70);
      };
      setTimeout(tick, REDUCED ? 50 : 900);
    };
    setTimeout(step, REDUCED ? 50 : 600);
  }

  // ---------- вехи для аналитики (без личных данных): Яндекс Метрика, если в _config.json задан metrika_id
  function milestone(name) {
    meta.milestones = meta.milestones || {};
    const firstTime = !meta.milestones[name];
    if (firstTime) { meta.milestones[name] = new Date().toISOString().slice(0, 10); saveMeta(); }
    try { if (C.metrika_id && meta.analytics === true && typeof window.ym === "function") window.ym(+C.metrika_id, "reachGoal", name, { first: firstTime }); } catch (e) { /* аналитика не должна ломать игру */ }
  }
  function milestoneFor(id, sc) {
    if (id === "Т-02б") milestone("root");
    else if (id === "Т-10") milestone("graduation");
    else if (id === "Я-01") milestone("anchor");
    else if (sc.stage === "final") milestone(id.startsWith("⊣") ? "deadend" : "final_" + id);
    else if (/^В[\d.]+-01$/.test(id) || id === "В2.1-00" || id === "В2.2-00" || id === "В1.2-00") milestone("life_" + id.split("-")[0]);
  }
  function loadMetrika() {
    if (!C.metrika_id || meta.analytics !== true || window.__ymLoaded) return; // только после согласия игрока (152-ФЗ)
    window.__ymLoaded = true;
    try {
      window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments); };
      window.ym.l = +new Date();
      const sc = document.createElement("script"); sc.async = true; sc.src = "https://mc.yandex.ru/metrika/tag.js"; document.head.append(sc);
      window.ym(+C.metrika_id, "init", { clickmap: false, trackLinks: true, accurateTrackBounce: true, webvisor: false });
    } catch (e) { /* без аналитики */ }
  }
  loadMetrika();
  function analyticsUi() {
    const has = !!C.metrika_id, b = $("#btn-analytics"), c = $("#consent");
    if (b) { b.hidden = !has; b.textContent = "аналитика: " + (meta.analytics === true ? "вкл" : "выкл"); b.setAttribute("aria-pressed", String(meta.analytics === true)); }
    if (c) c.hidden = !has || meta.analytics != null;
    const pn = $("#privacy-note"); if (pn) pn.hidden = !has;
  }
  const setAnalytics = (on) => { meta.analytics = on; saveMeta(); if (on) loadMetrika(); else if (window.__ymLoaded) location.reload(); analyticsUi(); };
  $("#consent-yes").onclick = () => setAnalytics(true);
  $("#consent-no").onclick = () => setAnalytics(false);
  $("#btn-analytics").onclick = () => setAnalytics(meta.analytics !== true);
  analyticsUi();

  function enter(id, restored) {
    const sc = G.scenes[id];
    if (S.pending) S.pending = null; // «После» прочитано: дальше обычный вход
    if (id === "Т-02б" && !restored && S && !S.rootShown) { S.rootShown = true; save(); return rootDeath(() => enter(id)); }
    S.scene = id;
    if (window.QQM) QQM.scene(id); // фоновой трек зоны (кроссфейд)
    if (!restored) milestoneFor(id, sc);
    document.body.dataset.life = id.startsWith("⊣") ? "К" : id.split("-")[0]; // тон жизни (тихий фон)
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
    { const l = leftOf(sc); if (l != null && snd.on()) snd.clock(l); else snd.clockStop(); } // часы острой сцены
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
      let tag = echoTag(b.if);
      if (b.drift) tag = "≈ в другом мире всё было не так" + (tag ? " · " + tag : ""); // сдвиг мира от ДРЕЙФа (I4)
      blocks.push({ md: b.md, cls: cls.join(" ").trim(), tag: tag !== lastTag ? tag : "", key: bkey(b.md) });
      lastTag = tag;
    }
    const art = $("#text"); art.innerHTML = "";
    $("#choices").innerHTML = "";
    // что из этой сцены уже показывалось в прошлых жизнях (до записи этого показа)
    const sb = meta.seenBlocks[S.scene], life = meta.lives || 0;
    const oldBlock = (b) => !sb || (b.key in sb && sb[b.key] < life); // старые сохранения без seenBlocks: всё считаем виденным
    if (lived && sb) for (const b of blocks) if (b.key && !b.own && !oldBlock(b) && !b.tag) b.tag = "◌ иначе, чем в прошлый раз";
    // что из этой сцены уже показывалось в ЭТОЙ жизни (после отката сворачиваем только это; новые из-за других флагов абзацы — как обычно)
    const legacy = !S.lifeBlocks; // старые сохранения без lifeBlocks: как раньше, всё считаем виденным
    S.lifeBlocks = S.lifeBlocks || {};
    const lb = S.lifeBlocks[S.scene], lkey = (b) => b.key || "~" + bkey(b.md);
    const els = blocks.map((b) => { const p = para(art, b.cls, md(b.md), b.tag); p._own = b.own; p._old = !!b.key && oldBlock(b); p._lifeSeen = legacy || !!(lb && lb[lkey(b)]); return p; });
    const sbNow = (meta.seenBlocks[S.scene] = meta.seenBlocks[S.scene] || {});
    for (const b of blocks) if (b.key && !(b.key in sbNow)) sbNow[b.key] = life;
    saveMeta();
    const lbNow = (S.lifeBlocks[S.scene] = lb || {});
    for (const b of blocks) if (!b.own) lbNow[lkey(b)] = 1;
    save();
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
    let queue = els;
    if (replay || lived) {
      const body = els.filter((p) => !p._own);
      // откат: свёрнуто всё, кроме последнего абзаца; быстрый ствол — только абзацы, виденные в прошлой жизни
      const cand = body.slice(0, -1).filter((p) => (replay ? p._lifeSeen : p._old));
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
      // после отката, но в сцене есть абзацы, которых я в этой жизни ещё не видел: виденное сразу, новое печатается как обычно
      if (!(replay && body.some((p) => !p._lifeSeen))) return finish();
      els.filter((p) => p._own || cand.includes(p) || p._lifeSeen).forEach(reveal);
      queue = els.filter((p) => p.classList.contains("pending"));
    }
    let i = 0;
    const step = () => { if (i >= queue.length) return finish(); reveal(queue[i]); i++; typing = setTimeout(step, REDUCED ? 60 : 420); };
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
    // кадр зависит от сюжета (05_visual.md §6): photo_by: ФЛАГ → сначала img/<ID>~<ЗНАЧЕНИЕ>.jpg, нет файла — img/<ID>.jpg
    // несколько флагов через запятую: сначала все значения вместе, потом поменьше, в порядке записи; bool-флаг = «ДА»
    const vals = !sc.photo_by || !S || !S.st ? [] : String(sc.photo_by).split(",").map((f) => f.trim()).filter(Boolean)
      .map((f) => S.st[f]).map((v) => (v === true ? "ДА" : v == null || v === false ? null : String(v))).filter(Boolean);
    const combos = [];
    for (let k = vals.length; k >= 1; k--) (function rec(start, acc) { if (acc.length === k) return combos.push(acc.join("~")); for (let i = start; i < vals.length; i++) rec(i + 1, acc.concat(vals[i])); })(0, []);
    const remote = C.img_remote || ""; // живые картинки: то, что ZCode уже запушил, но ещё не попало в сборку
    const srcs = combos.map((c) => sid + "~" + c).concat([sid]).map((n) => encodeURIComponent(n) + ".jpg")
      .flatMap((f) => remote ? ["img/" + f, remote + f] : ["img/" + f]);
    ph._img = img; // только последний кадр управляет рамкой (повторный показ той же сцены)
    img.onload = () => { if (ph._img === img) ph.hidden = false; };
    img.onerror = () => {
      if (ph._img !== img) return img.remove();
      if (srcs.length) { img.src = srcs.shift(); return; } // вариант не нарисован — базовый кадр
      img.remove();
      ph.hidden = true;
      if (sc.photo_caption) { pc.textContent = sc.photo_caption; pc.hidden = false; }
    };
    img.src = srcs.shift();
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
      if (devOn) devDecorate(b, c, st);
      else if (DEBUG) b.insertAdjacentHTML("beforeend", `<small class="mono dbg">[${c.id}] ${esc(c.outcomes.map((o) => (o.if_src ? o.if_src + " → " : "") + o.to).join(" | "))}</small>`);
      b.onclick = () => choose(sc, c);
      nav.append(b);
    });
    // Хор знает о чём-то, но не говорит, о какой кнопке
    if (cold && dar < 60) { const k = document.createElement("p"); k.className = "cold-line mono"; k.textContent = "❄ холодок в затылке: здесь что-то не так"; nav.insertBefore(k, nav.querySelector(".choice")); }
    else if (knows && !cold) { const k = document.createElement("p"); k.className = "chorus-knows mono"; k.textContent = "◌ Хор о чём-то знает"; nav.insertBefore(k, nav.querySelector(".choice")); }
    // закрытые варианты: текст не показываем, только чего не хватило
    for (const c of sc.choices || []) {
      const wip = isWip(c);
      if (devOn && !wip && c.visible && !ok(c.visible, st)) { nav.append(devLocked(c, st)); continue; }
      if (!wip && (!c.visible || ok(c.visible, st) || /seen|one_life/.test(JSON.stringify(c.visible)))) continue;
      const b = document.createElement("button");
      b.className = "choice locked" + (wip ? " wip" : ""); b.disabled = true;
      b.innerHTML = `<span class="num mono">·</span><span class="lbl">— — —</span><small>${esc(wip ? "эта жизнь ещё пишется" : lockReason(c.visible, st))}</small>`;
      nav.append(b);
    }
    compactChoices(nav);
    saveMeta();
    if (devOn) devGoals(nav, sc);
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
      f.className = "choice ghost-choice"; f.textContent = "Открыть «Мою жизнь»";
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
    const need = new Set(), too = new Set(); let flags = false, bond = false, drift = false, kinds = false, lives = false;
    (function walk(x, neg) {
      if (!x || typeof x !== "object") return;
      if (x.op === "not") return walk(x.a, !neg);
      if (x.op === "and" || x.op === "or") { for (const y of x.a) if (!ev(y, st) !== neg || x.op === "or") walk(y, neg); return; }
      if (ev(x, st) !== neg) return; // эта часть условия выполнена
      const mop = x.op === "cmp" ? (x.l.op === "kinds" || x.r.op === "kinds" ? "kinds" : x.l.op === "branches" || x.r.op === "branches" ? "branches" : null) : x.op;
      if (mop === "kinds") { kinds = true; return; }
      if (mop === "branches") { lives = true; return; }
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
    if (kinds) parts.push("Хор ещё не знает столько смертей");
    if (lives) parts.push("Хор ещё не прожил столько жизней");
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
    S.st = next;
    if (after) {
      // состояние применено и сохранено уже здесь: закрыл вкладку на «После» — вернёшься сюда же, а не к развилке
      S.pending = { scene: S.scene, choice: c.id, to: o.to, check };
      save();
      return showAfter(c, after.filter((b) => ok(b.if, next)), () => enter(o.to), new Set(setHere), check);
    }
    S.check = check;
    enter(o.to);
  }

  // восстановление на экране «После»: тот же выбор, то же последствие, «Дальше» — в o.to
  function resumeAfter() {
    const p = S.pending, sc = G.scenes[p.scene], c = sc && (sc.choices || []).find((x) => x.id === p.choice);
    const after = sc && sc.after && sc.after[p.choice];
    if (!c || !after || !G.scenes[p.to]) { const to = p.to; S.pending = null; return enter(G.scenes[to] ? to : S.scene, !G.scenes[to]); }
    S.scene = p.scene;
    show("#scene");
    document.body.dataset.drift = Math.min(4, Math.floor((S.st["ДРЕЙФ"] || 0) / 20));
    document.body.dataset.era = sc.photo || "none";
    snd.era(sc.photo || "none");
    renderPhoto(sc);
    $("#meta").textContent = [sc.date, sc.age != null ? `мне ${sc.age}` : "", DEBUG ? S.scene : ""].filter(Boolean).join(" · ");
    $("#when").textContent = sc.date || "";
    $("#text").innerHTML = ""; $("#text").onclick = null;
    tagUsed = new Set();
    const t = (S.trail || [])[S.trail.length - 1];
    const setHere = new Set(t && t.scene === p.scene && t.choice === p.choice ? t.flags || [] : []);
    showAfter(c, after.filter((b) => ok(b.if, S.st)), () => enter(p.to), setHere, p.check || null);
  }

  // компактные капканы на телефоне: когда вариантов много, «Я помню…» и закрытые сворачиваются в одну строку
  function compactChoices(nav) {
    if (devOn || !matchMedia("(max-width: 560px)").matches) return;
    const all = [...nav.querySelectorAll(".choice")];
    if (all.length < 5) return;
    const fold = (list, icon, label, cls) => {
      if (list.length < 2) return;
      const t = document.createElement("button");
      t.className = "choice fold-btn " + cls;
      t.innerHTML = `<span class="num mono">${icon}</span><span class="lbl">${label} <small class="mono">${list.length}</small></span>`;
      nav.insertBefore(t, list[0]);
      list.forEach((b) => (b.hidden = true));
      t.onclick = () => { list.forEach((b) => (b.hidden = false)); t.remove(); list[0].focus && list[0].focus(); };
    };
    fold([...nav.querySelectorAll(".choice.echo:not([disabled]), .choice.meta-echo:not([disabled])")], "⟲", "Я помню…", "mem-fold");
    if (nav.querySelectorAll(".choice:not([hidden])").length >= 5) fold([...nav.querySelectorAll(".choice.locked")], "·", "ещё закрыто", "lock-fold");
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

  // ---------- «поделиться надгробием»: PNG-карточка 1080×1350 без спойлеров сюжета (только эпитафия и «в том мире»)
  function tombCanvas(d) {
    const W = 1080, H = 1350, cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#15130f"); bg.addColorStop(1, "#0b0b0d");
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.strokeStyle = "rgba(233,228,218,.18)"; g.lineWidth = 2; g.strokeRect(60, 60, W - 120, H - 120);
    const serif = '"PT Serif", Georgia, serif', mono = '"PT Mono", Menlo, monospace';
    const wrap = (text, x, y, maxW, lh, font, color) => {
      g.font = font; g.fillStyle = color;
      const words = String(text || "").split(/\s+/); let line = "";
      for (const w of words) {
        const t = line ? line + " " + w : w;
        if (g.measureText(t).width > maxW && line) { g.fillText(line, x, y); y += lh; line = w; } else line = t;
      }
      if (line) { g.fillText(line, x, y); y += lh; }
      return y;
    };
    g.textAlign = "center";
    g.font = `34px ${mono}`; g.fillStyle = "#8d877c"; g.fillText(String(d.date || "").toUpperCase(), W / 2, 170);
    g.font = `120px ${serif}`; g.fillStyle = "#e9e4da"; g.fillText("✝", W / 2, 320);
    g.font = `54px ${serif}`; g.fillText("Андрей Николаевич Самохин", W / 2, 420);
    g.font = `38px ${mono}`; g.fillStyle = "#b9a27a"; g.fillText(`1989 — ${yearOf(d.date) || ""}`, W / 2, 480);
    let y = wrap(d.epitaph, W / 2, 590, W - 260, 54, `italic 40px ${serif}`, "#e9e4da");
    if (d.mourner) {
      y += 30;
      g.font = `28px ${mono}`; g.fillStyle = "#b2463a"; g.fillText("В ТОМ МИРЕ", W / 2, y); y += 54;
      y = wrap(d.mourner, W / 2, y, W - 260, 46, `34px ${serif}`, "#c9c2b5");
    }
    g.font = `44px ${serif}`; g.fillStyle = "#e9e4da"; g.fillText(C.title || "Тот, кто остался", W / 2, H - 190);
    g.font = `26px ${mono}`; g.fillStyle = "#6f8aa0"; g.fillText((C.share_url || "").replace(/^https?:\/\//, ""), W / 2, H - 95);
    return cv;
  }
  if (DEBUG) window.__tombPng = (id) => tombCanvas(G.deaths[id]).toDataURL("image/png"); // для проверки карточки
  function shareTomb(d) {
    const box = $("#death-text").querySelector(".tomb-share");
    const url = C.share_url || location.href;
    const text = `${d.epitaph || ""} — «${C.title || "Тот, кто остался"}»`;
    const cv = tombCanvas(d);
    cv.toBlob(async (blob) => {
      const file = blob && new File([blob], "nadgrobie.png", { type: "image/png" });
      try {
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text, url }); return; }
      } catch (e) { if (e && e.name === "AbortError") return; }
      // запасной путь: картинку сохранить, ссылку отправить
      const href = blob ? URL.createObjectURL(blob) : cv.toDataURL("image/png");
      box.innerHTML = `<span class="mono share-row">
        <a class="link" href="${href}" download="nadgrobie.png">сохранить картинку</a> ·
        <a class="link" target="_blank" rel="noopener" href="https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}">Telegram</a> ·
        <a class="link" target="_blank" rel="noopener" href="https://vk.com/share.php?url=${encodeURIComponent(url)}&title=${encodeURIComponent(text)}">ВКонтакте</a></span>`;
      box.querySelectorAll("a").forEach((a) => a.addEventListener("click", (e) => e.stopPropagation()));
    }, "image/png");
  }

  // ---------- смерть: сама смерть → надгробие → шок пробуждения → (если можно глубже) лента отката
  function die(did) {
    const d = G.deaths[did];
    const first = Object.keys(S.lifeSeen).length === 0;
    const firstEver = Object.keys(meta.journal || {}).length === 0 && !meta.helpShown; // самая первая смерть игрока (Корень не в счёт)
    S.lifeSeen[did] = true;
    milestone(Object.keys(meta.journal || {}).length === 0 ? "first_death" : "death");
    const j = meta.journal[did] || { times: 0, first: new Date().toISOString(), life: meta.lives };
    j.times++; meta.journal[did] = j; saveMeta();
    if (S.oneLife) store.del(SAVE); else save(); // «Одна жизнь»: закрыл вкладку на смерти — к развилке не вернуться
    show("#death");
    snd.stop(); buzz(40);
    if (window.QQM) QQM.stinger(); // стингер смерти поверх приглушённого фона
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
      </div>
      <p class="tomb-share"><button class="link mono" id="btn-share-tomb">↗ поделиться надгробием</button></p>`);
      $("#btn-share-tomb").onclick = (e) => { e.stopPropagation(); shareTomb(d); };
      // одна тихая строка поддержки — один раз за всю игру, после первого надгробия
      if (firstEver) {
        meta.helpShown = true; saveMeta();
        art.insertAdjacentHTML("beforeend", `<p class="help-line">Если тебе сейчас тяжело не только в игре — в разделе <button class="link" id="help-link">«Об игре и помощь»</button> есть телефоны, по которым ответят.</p>`);
        $("#help-link").onclick = (e) => { e.stopPropagation(); openPanel("#about"); };
      }
      const lab = btn.querySelector(".hold-lbl");
      if (lab) { lab.dataset.def = lab.dataset.def || lab.textContent; lab.textContent = S.oneLife ? "■ держи. Отката не будет" : lab.dataset.def; }
      setTimeout(() => { btn.hidden = false; holdToRewind(btn, art, () => (S.oneLife ? oneLifeEnd(did) : awaken(did, first))); }, REDUCED ? 100 : 1400);
    };
    setTimeout(step, REDUCED ? 50 : 700);
  }

  // «Одна жизнь»: после надгробия нет ни шока, ни ленты, ни отката. Сохранение жизни стирается.
  function oneLifeEnd(did) {
    snd.rewStop();
    store.del(SAVE);
    const art = $("#death-text");
    art.style.translate = art.style.filter = art.style.transition = "";
    $("#death").classList.remove("spool");
    $("#btn-death-next").hidden = true;
    art.innerHTML = `<div class="onelife-end"><span class="mono nr-end">Отката нет.</span>
      <p>Хор молчит. Этот я не встанет за минуту до смерти и ничего из неё не вынесет. Так умирают все остальные.</p></div>`;
    const b = document.createElement("button");
    b.className = "choice"; b.textContent = "В главное меню";
    b.onclick = () => { S = null; showTitle(); };
    art.querySelector(".onelife-end").append(b);
    buzz([60, 80, 60]);
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
    if (id === "#journal") snd.paper(); // шелест страниц
    // запоминаем, откуда пришли; из панели в панель — «назад» остаётся прежним
    if (!$("#scene").hidden) back = "#scene";
    else if (!$("#title").hidden) back = "#title";
    else if (!$("#death").hidden) back = "#death"; // строка поддержки на экране смерти: вернуться к надгробию
    renderPanels();
    show(id);
    if (id === "#flow") renderFlow();
    if (id === "#guide") renderGuide();
    if (id === "#journal") snd.chorus();
    if (id === "#devstate") renderDevState();
    if (id === "#devstats") renderDevStats();
    if (id === "#devjump") renderDevJump();
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
  // «Пути»: только финалы, где я был, и те, к которым идёт эта жизнь — шаги ровно до сегодняшней сцены
  function guideProgress(g) {
    if (!S || !g.found) return null;
    const tr = (S.trail || []).filter((t) => !String(t.scene).startsWith("✝"));
    if (![...tr.map((t) => t.scene), S.scene].some((id) => !id.startsWith("Т-"))) return null; // пока я в стволе, дорога ни к чему не выбрана
    const nd = g.steps.filter((x) => x.choice && !x.death); // шаги дороги без «умереть и вернуться»
    if (tr.length >= nd.length) return null;
    for (let i = 0; i < tr.length; i++) if (tr[i].scene !== nd[i].scene || tr[i].choice !== nd[i].choice) return null; // свернул с этой дороги
    if (nd[tr.length].scene !== S.scene) return null;
    return tr.length; // столько моих выборов совпало с дорогой; дальше — не прожито
  }
  function renderGuide() {
    const list = $("#guide-list"); list.innerHTML = "";
    const gs = G.guides || {};
    meta.guideFold = meta.guideFold || {};
    let n = 0;
    for (const [fid, g] of Object.entries(gs)) {
      const done = !!meta.visited[fid];
      const locked = g.secret && !done && !(g.gate && meta.visited[g.gate]);
      const cut = done || devOn ? null : guideProgress(g);
      if (!done && !devOn && (cut == null || locked)) continue; // чужие и непрожитые дороги не показываю
      n++;
      const going = cut != null;
      const max = going ? 2 : 3; // начатая дорога: подсказка и путь до сегодня, без будущих развилок
      const lvl = Math.min(meta.guide[fid] || 0, max), fold = !!meta.guideFold[fid];
      const card = document.createElement("div");
      card.className = "gcard" + (done ? " done" : "") + (going ? " going" : "") + (fold ? " folded" : "");
      let h = `<div class="ghead"><span class="mono gnum">${String(n).padStart(2, "0")}</span><b>${esc(g.title)}</b><span class="mono dim">${esc(g.year)}</span>${done ? `<span class="gdone mono">пройдено</span>` : `<span class="gdone gnow mono">иду сюда</span>`}</div>`;
      const steps = g.steps.filter((x) => x.choice);
      const shown = going ? g.steps.filter((x) => x.choice && !x.death).slice(0, cut) : steps; // начатая: ровно мои выборы
      const stepList = (arr) => `<ol class="gsteps">${arr.map((x) => `<li${x.death ? ' class="gdeath"' : ""}><span class="mono dim">${esc(x.year)}</span> ${esc(x.title)} → «${esc(x.label)}»${x.death ? " <i>умереть и вернуться</i>" : ""}</li>`).join("")}</ol>`;
      if (!fold) {
        if (lvl >= 1) h += `<p class="ghint">${md(g.hint)}</p>`;
        if (!going && lvl >= 2) h += `<ul class="gforks">${g.forks.map((f) => `<li>${md(f)}</li>`).join("")}</ul>`;
        if (going && lvl >= 2) h += (shown.length ? stepList(shown) : "") + `<p class="dim tiny">…и я здесь: ${esc((G.scenes[S.scene] && G.scenes[S.scene].title) || S.scene)}. Дальше — не прожито.</p>`;
        if (!going && lvl >= 3) h += stepList(steps);
      }
      const labels = going ? ["Подсказка: каким стать", "Путь до сегодня"] : ["Подсказка: каким стать", "Главные развилки", "Весь путь"];
      h += `<div class="gbtns">`;
      if (!fold && lvl < max) h += `<button class="choice ghost-choice gmore">${labels[lvl]}</button>`;
      if (lvl >= 1) h += `<button class="choice ghost-choice gfold">${fold ? "Развернуть" : "Свернуть"}</button>`;
      if (!fold && lvl >= max) h += `<button class="choice ghost-choice gflow">Показать в «Моей жизни»</button>`;
      h += `</div>`;
      card.innerHTML = h;
      const more = card.querySelector(".gmore");
      if (more) more.onclick = () => { meta.guide[fid] = lvl + 1; saveMeta(); renderGuide(); };
      const fb = card.querySelector(".gfold");
      if (fb) fb.onclick = () => { meta.guideFold[fid] = !fold; saveMeta(); renderGuide(); };
      const fl = card.querySelector(".gflow");
      if (fl) fl.onclick = () => { guideOn = fid; guideCut = going ? cut : null; openPanel("#flow"); };
      list.append(card);
    }
    if (!n) list.innerHTML = `<p class="dim">Пока ни одной дороги. Проживи — и она появится здесь: финал, до которого дошёл, или тот, к которому идёшь.</p>`;
  }
  function closePanel() { if ((back === "#scene" || back === "#death") && S) show(back); else showTitle(); }

  // доска улик: что я знаю из смертей, пригодилось ли это, что Хор ещё не знает
  function renderClues() {
    const box = $("#clues"); if (!box) return;
    const uses = {}; // смерть → варианты, которые открывает её память
    for (const [sid, sc] of Object.entries(G.scenes)) for (const c of sc.choices || []) {
      if (!c.visible) continue;
      for (const id of [...seenIds(c.visible, true), ...seenIds(c.visible, false)]) (uses[id] = uses[id] || []).push([sid, c.id]);
    }
    const known = Object.keys(meta.journal || {}).filter((id) => G.deaths[id] && G.deaths[id].lesson);
    if (!known.length) { box.innerHTML = ""; return; }
    const used = (id) => (uses[id] || []).some(([sid, cid]) => meta.taken[sid] && meta.taken[sid][cid] != null);
    const cross = (id) => (uses[id] || []).some(([sid]) => !sid.startsWith(id.slice(1).split("-")[0] + "-")); // память работает в другой жизни
    const rows = known.map((id) => {
      const d = G.deaths[id], u = used(id), x = cross(id), n = (uses[id] || []).length;
      const st = u ? "пригодилось" : n ? "ещё не пригодилось" : "просто память";
      return `<div class="clue${u ? " used" : ""}"><b>${esc(d.lesson)}</b><small class="mono">✝ ${esc(yearOf(d.date) || "")} · ${esc(d.title || "")} · ${st}${x ? " · ◌ и в другой жизни" : ""}</small></div>`;
    }).join("");
    const total = Object.keys(G.deaths).length, seenN = Object.keys(meta.journal || {}).length;
    box.innerHTML = `<h3 class="memo-h">Что я знаю</h3><div class="clues">${rows}</div>
      <p class="dim tiny mono">Хор знает ${seenN} смертей из ${total} · стихий ${kindsSeen().size} из ${C.stihii.length} · прожито жизней ${branchesLived().size} из 8</p>`;
  }

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
    renderClues();
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
    z = Math.max(0.1, Math.min(2.5, z));
    const r = wrap.getBoundingClientRect();
    const px = cx == null ? wrap.clientWidth / 2 : cx - r.left, py = cy == null ? wrap.clientHeight / 2 : cy - r.top;
    const ux = (wrap.scrollLeft + px) / flowZoom, uy = (wrap.scrollTop + py) / flowZoom;
    flowZoom = z;
    svg.setAttribute("width", flowSize.w * z); svg.setAttribute("height", flowSize.h * z);
    wrap.scrollLeft = ux * z - px; wrap.scrollTop = uy * z - py;
    flowMini();
  }
  (function initFlowZoom() {
    const wrap = $("#flow-wrap");
    $("#z-in").onclick = () => setFlowZoom(flowZoom * 1.25);
    $("#z-out").onclick = () => setFlowZoom(flowZoom / 1.25);
    $("#z-fit").onclick = () => { setFlowZoom(Math.min((wrap.clientWidth - 4) / flowSize.w, 1)); wrap.scrollLeft = 0; }; // по ширине: все дорожки видны, вниз — прокруткой
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

  // ---------- полная схема: все сцены по дорожкам жизней и годам; неоткрытое — в тумане
  const LANES = [["В1", "Как батя"], ["В1.2", "Участок"], ["В2.1", "Эталон"], ["В2", "Физфак"], ["В2.2", "Сорок два"], ["В3", "Партия"], ["В4", "Сварной"], ["В5", "Куда угодно"], ["В6", "Голоса"], ["В7", "Остаться"]];
  const laneOf = (id) => (id.startsWith("⊣") ? "К" : id.split("-")[0]);
  let flowLayoutCache = null;
  function flowLayout() {
    if (flowLayoutCache) return flowLayoutCache;
    const ids = Object.keys(G.scenes);
    const kids = {}, parents = {}, deathsOf = {};
    for (const id of ids) {
      const sc = G.scenes[id], out = new Set(sc.next ? [sc.next] : []);
      for (const c of sc.choices || []) for (const o of c.outcomes) {
        if (G.scenes[o.to]) out.add(o.to);
        else if (G.deaths[o.to]) { const d = (deathsOf[id] = deathsOf[id] || []); if (!d.includes(o.to)) d.push(o.to); }
      }
      kids[id] = [...out];
      for (const k of out) (parents[k] = parents[k] || []).push(id);
    }
    // топологический порядок (граф ацикличен)
    const indeg = {}; ids.forEach((i) => (indeg[i] = 0)); ids.forEach((i) => kids[i].forEach((k) => indeg[k]++));
    const q = ids.filter((i) => indeg[i] === 0).sort(), topo = {};
    let n = 0;
    while (q.length) { const v = q.shift(); topo[v] = n++; for (const k of kids[v]) if (--indeg[k] === 0) q.push(k); }
    const W = 150, H = 58, ROW = 84, COL = 214, AX = 78, PAD = 30;
    const laneIx = {}; LANES.forEach(([l], i) => (laneIx[l] = i));
    const colX = (i) => AX + PAD + i * COL;
    const midX = colX((LANES.length - 1) / 2);
    const pos = {}, bands = [];
    let y = PAD + 40;
    const place = (id, x, yy, kind) => (pos[id] = { x, y: yy, kind });
    // пролог и ствол — колонкой по центру
    const trunk = ids.filter((id) => laneOf(id) === "Т").sort((a, b) => topo[a] - topo[b]);
    for (const id of trunk) { place(id, midX, y, "scene"); bands.push({ y, label: id === "Т-00" ? "пролог" : yearOf(G.scenes[id].date) || "" }); y += ROW; }
    y += 34;
    const lifeTop = y;
    // жизни: полосы лет, высота — по самой плотной колонке
    const life = ids.filter((id) => laneIx[laneOf(id)] != null);
    const byYear = {};
    for (const id of life) { const yr = +(yearOf(G.scenes[id].date) || 2061); ((byYear[yr] = byYear[yr] || {})[laneOf(id)] = byYear[yr][laneOf(id)] || []).push(id); }
    const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
    let prev = null;
    for (const yr of years) {
      if (prev != null && yr - prev > 1) y += 12; // разрыв на пустых годах
      const lanes = byYear[yr];
      const rows = Math.max(...Object.values(lanes).map((l) => l.length));
      bands.push({ y, label: String(yr) });
      for (const [l, list] of Object.entries(lanes)) list.sort((a, b) => topo[a] - topo[b]).forEach((id, i) => place(id, colX(laneIx[l]), y + i * ROW, "scene"));
      y += rows * ROW; prev = yr;
    }
    const lifeBottom = y;
    // тупики — в конце своей дорожки
    const ends = ids.filter((id) => laneOf(id) === "К").sort((a, b) => topo[a] - topo[b]);
    const endRow = {};
    for (const id of ends) {
      const p = (parents[id] || [])[0], l = p ? laneOf(p) : "Я";
      if (l === "Я") continue;
      const k = (endRow[l] = (endRow[l] || 0) + 1) - 1;
      place(id, colX(laneIx[l]), y + 10 + k * ROW, "end");
    }
    y += Math.max(1, ...Object.values(endRow)) * ROW + 40;
    // якорь и финалы
    bands.push({ y, label: "якорь" });
    const anchor = ids.filter((id) => laneOf(id) === "Я").sort((a, b) => topo[a] - topo[b]);
    for (const id of anchor) {
      place(id, midX, y, "anchor");
      // финалы и тупики прямо из якоря, кроме Я-03, — справа от него
      let k = 0;
      for (const t of kids[id]) if (!pos[t] && (laneOf(t) === "Ф" || laneOf(t) === "К") && id !== anchor[anchor.length - 1]) place(t, midX + COL * (1.2 + k++), y, laneOf(t) === "Ф" ? "final" : "end");
      y += ROW + 6;
    }
    const last = anchor[anchor.length - 1];
    const fin = (kids[last] || []).filter((t) => !pos[t]);
    y += 20;
    fin.forEach((t, i) => place(t, midX + (i - (fin.length - 1) / 2) * COL * 0.86, y, laneOf(t) === "Ф" ? "final" : "end"));
    for (const id of ids) if (!pos[id]) place(id, midX + COL * 2, (y += ROW), laneOf(id) === "Ф" ? "final" : "scene"); // на всякий случай
    y += ROW + PAD;
    const width = colX(LANES.length - 1) + W + 70 + PAD;
    flowLayoutCache = { pos, kids, parents, deathsOf, bands, W, H, ROW, COL, AX, PAD, colX, width, height: y, lifeTop, lifeBottom, laneIx };
    return flowLayoutCache;
  }

  // ---------- пелена тумана (v2.3.1): сеяные органичные клубы вместо сетки ----------
  // ПРНГ с фиксированным зерном: картинка тумана каждый раз одна и та же, но решётки нет.
  function fogRng(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Туман = тоновые банки + три стаи клубов с несоизмеримыми дрейфами + светлые вихряшки,
  // у каждой свой цикл. Фаза берётся от часов: переоткрытие схемы не сбрасывает движение в ноль.
  function makeFog(L, openPts, thin) {
    const rnd = fogRng(20261113);
    const inClearing = (x, y, pad) => openPts.some((p) => x > p.x - pad && x < p.x + L.W + pad && y > p.y - pad * 0.7 && y < p.y + L.H + pad * 0.7);
    const g = ["", "", ""];
    let bank = "", wisps = "";
    for (let i = 0; i < 4; i++) { // банки — крупные пятна плотности, чтобы поле не было ровным
      const cx = L.AX + rnd() * (L.width - L.AX), cy = rnd() * L.height, r = Math.max(L.width, L.height) * (0.26 + rnd() * 0.2);
      bank += `<ellipse class="fbank" cx="${cx | 0}" cy="${cy | 0}" rx="${r | 0}" ry="${(r * (0.5 + rnd() * 0.3)) | 0}" opacity="${(0.6 + rnd() * 0.55).toFixed(2)}" transform="rotate(${(rnd() * 44 - 22) | 0} ${cx | 0} ${cy | 0})"/>`;
    }
    // рыхлая решётка: разброс точки сопоставим с шагом, ряды глазом не собираются; плотность режется по числу мест
    const CAP = 520, cells = Math.ceil((L.width - L.AX) / 136) * Math.ceil(L.height / 100), k = Math.max(0.55, Math.min(1, Math.sqrt(CAP / Math.max(1, cells))));
    const CX = 136 / k, CY = 100 / k;
    let made = 0;
    for (let gy = -0.5; gy * CY < L.height + CY * 0.6; gy++) {
      for (let gx = -0.5; gx * CX < L.width - L.AX + CX * 0.6; gx++) {
        const x = L.AX + 14 + (gx + rnd() * 1.7 - 0.85) * CX, y = -40 + (gy + rnd() * 1.7 - 0.85) * CY;
        if (x < L.AX - 10 || x > L.width + 50 || y < -50 || y > L.height + 50 || made >= CAP) continue;
        const pad = 46 + rnd() * 54; // у каждой поляны свой рваный край
        if (inClearing(x, y, pad)) continue;
        made++;
        const rx = 64 + rnd() * 100, ry = rx * (0.5 + rnd() * 0.22), rot = rnd() * 48 - 24;
        const fill = rnd() < 0.78 ? "fogpuff" : "fogpuffb", o = (thin * (0.5 + rnd() * 0.5)).toFixed(2);
        g[(rnd() * 3) | 0] += `<ellipse class="puff" fill="url(#${fill})" opacity="${o}" cx="${x | 0}" cy="${y | 0}" rx="${rx | 0}" ry="${ry | 0}" transform="rotate(${rot | 0} ${x | 0} ${y | 0})"/>`;
        if (rnd() < 0.34) { // светлый гребень сверху — лунная подсветка клубов
          const cx2 = x + rnd() * 36 - 18, cy2 = y - 14 - rnd() * 24;
          g[0] += `<ellipse class="rim" cx="${cx2 | 0}" cy="${cy2 | 0}" rx="${(rx * 0.6) | 0}" ry="${(ry * 0.5) | 0}" transform="rotate(${((rot + rnd() * 14 - 7) | 0)} ${cx2 | 0} ${cy2 | 0})"/>`;
        }
      }
    }
    for (let w = 0; w < 11; w++) { // вихряшки — каждая живёт собственным циклом
      let x = 0, y = 0, ok = false;
      for (let t = 0; t < 9 && !ok; t++) { x = L.AX + 30 + rnd() * (L.width - L.AX - 60); y = rnd() * L.height; ok = !inClearing(x, y, 34); }
      if (!ok) continue;
      wisps += `<g class="wisp" style="animation-duration:${(26 + rnd() * 36).toFixed(1)}s;animation-delay:${(-rnd() * 120).toFixed(1)}s;--wx:${(rnd() * 44 - 22) | 0}px;--wy:${(rnd() * 22 - 11) | 0}px"><ellipse class="rim" cx="${x | 0}" cy="${y | 0}" rx="${(26 + rnd() * 30) | 0}" ry="${(9 + rnd() * 13) | 0}" transform="rotate(${(rnd() * 50 - 25) | 0} ${x | 0} ${y | 0})"/></g>`;
    }
    const now = performance.now() / 1000, ph = (dur) => (-(now % dur)).toFixed(1);
    const periods = [61, 83.7, 107.3];
    // слои отдаются как отдельные картинки (см. fogHtml): анимация <g> внутри SVG в Chrome
    // перерисовывает весь холст каждый кадр — на большой схеме это мигало
    return [{ cls: "fog-bank-g", delay: ph(173), svg: bank }]
      .concat(g.map((sv, i) => ({ cls: "fog-g f" + i, delay: ph(periods[i]), svg: sv + (i === 0 ? wisps : "") })));
  }
  let fogUrls = [];
  function fogHtml(L, layers, defs) {
    for (const u of fogUrls) URL.revokeObjectURL(u);
    fogUrls = [];
    const imgs = layers.map((ly) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${L.width}" height="${L.height}" viewBox="0 0 ${L.width} ${L.height}">${defs}<style>.rim{fill:url(#fogrim)}.fbank{fill:url(#fogbank)}</style>${ly.svg}</svg>`;
      const u = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      fogUrls.push(u);
      return `<img class="fog-img ${ly.cls}" style="animation-delay:${ly.delay}s" src="${u}" alt="" draggable="false">`;
    }).join("");
    return `<div class="fog-html" aria-hidden="true">${imgs}</div>`;
  }

  function renderFlow() {
    const L = flowLayout(), { pos, kids, deathsOf, W, H } = L;
    const visited = meta.visited, taken = meta.taken, shown = meta.shown;
    const life = new Set(S ? [...S.stack.map((s) => s.scene), S.scene] : []);
    const gp = guideOn && G.guides && G.guides[guideOn];
    const gNd = gp ? gp.steps.filter((x) => x.choice && !x.death) : [];
    const gSteps = gp ? (guideCut != null ? gNd.slice(0, guideCut + 1) : gp.steps) : []; // начатая дорога: мои выборы и сцена, где я стою
    const gScenes = new Set(gp ? [...gSteps.map((s) => s.scene), ...(guideCut != null ? [] : [guideOn])] : []);
    const gChoice = {}; if (gp) for (const s of gSteps.slice(0, guideCut != null ? guideCut : undefined)) if (s.choice && !s.death) gChoice[s.scene] = s.choice;
    const open = (id) => devOn || visited[id] || gScenes.has(id);
    const secretLocked = (id) => { const g = G.guides && G.guides[id]; return g && g.secret && !visited[id] && !(g.gate && visited[g.gate]); };
    const laneOpen = {}; for (const id of Object.keys(visited)) laneOpen[laneOf(id)] = true;
    let edges = "", nodes = "", deaths = "", fog = null, lanes = "", axis = "";
    // фон дорожек и подписи
    LANES.forEach(([l, name], i) => {
      const x = L.colX(i) - 12, nowLane = S && laneOf(S.scene) === l;
      lanes += `<rect class="lane-bg${nowLane ? " now" : ""}" x="${x}" y="${L.lifeTop - 46}" width="${W + 70}" height="${L.lifeBottom - L.lifeTop + 60}" rx="12"/>`;
      const known = devOn || laneOpen[l];
      lanes += `<text class="lane-t${known ? "" : " fogged"}" x="${x + 12}" y="${L.lifeTop - 24}">${known ? esc(l + " · " + name) : "жизнь ?"}</text>`;
    });
    for (const b of L.bands) axis += `<line class="yr-line" x1="${L.AX - 6}" x2="${L.width - 10}" y1="${b.y - 12}" y2="${b.y - 12}"/><text class="yr" x="${L.AX - 12}" y="${b.y + 8}" text-anchor="end">${esc(b.label)}</text>`;
    // рёбра: одно на пару «узел → цель», состояние — лучшее из вариантов
    const curve = (a, b) => {
      const x1 = a.x + W / 2, y1 = a.y + H, x2 = b.x + W / 2, y2 = b.y;
      if (Math.abs(b.y - a.y) < H) { const sx = a.x + W, ex = b.x; return `M${sx} ${a.y + H / 2} C${sx + 30} ${a.y + H / 2} ${ex - 30} ${b.y + H / 2} ${ex} ${b.y + H / 2}`; }
      const my = (y1 + y2) / 2;
      const bend = x1 === x2 && y2 - y1 > L.ROW ? -46 : 0; // через узел в той же колонке — в обход
      return `M${x1} ${y1} C${x1 + bend} ${my} ${x2 + bend} ${my} ${x2} ${y2}`;
    };
    let opened = 0, total = 0;
    for (const [id, sc] of Object.entries(G.scenes)) {
      const a = pos[id]; if (!a) continue;
      total += (sc.choices || []).length;
      const best = {};
      const mark = (t, s) => { const r = { fog: 0, shown: 1, taken: 2 }; if (best[t] == null || r[s] > r[best[t]]) best[t] = s; };
      if (sc.next && pos[sc.next]) mark(sc.next, visited[id] && visited[sc.next] ? "taken" : open(id) ? "shown" : "fog");
      for (const c of sc.choices || []) {
        const tk = !!taken[id] && taken[id][c.id] != null, sh = !!(shown[id] && shown[id][c.id]);
        if (tk) opened++;
        for (const o of c.outcomes) if (pos[o.to]) mark(o.to, tk && visited[o.to] ? "taken" : (sh || tk || devOn) ? "shown" : "fog");
      }
      for (const [t, s] of Object.entries(best)) {
        if (!open(id)) continue; // из тумана не видно ничего
        if (!open(t)) { // ребро уходит в облако и обрывается
          const b = pos[t], x1 = a.x + W / 2, y1 = a.y + H, k = 0.3, ex = x1 + (b.x + W / 2 - x1) * k, ey = y1 + (b.y - y1) * k;
          edges += `<path class="edge stub" d="M${x1} ${y1} Q${x1} ${(y1 + ey) / 2} ${ex.toFixed(1)} ${ey.toFixed(1)}"/>`;
          continue;
        }
        const g = gScenes.has(id) && gScenes.has(t) ? " guide" : "", now = life.has(id) && life.has(t) ? " now" : "";
        edges += `<path class="edge ${s}${now}${g}" d="${curve(a, pos[t])}"/>`;
      }
    }
    // узлы
    for (const [id, p] of Object.entries(pos)) {
      const sc = G.scenes[id]; if (!sc) continue;
      const isOpen = open(id), here = S && S.scene === id;
      if (!isOpen) continue; // туман: сцена не рисуется вовсе, её закрывает облачная пелена ниже
      const kind = p.kind, kick = kind === "final" ? "ФИНАЛ" : kind === "end" ? "⊣ ТУПИК" : kind === "anchor" ? "ЯКОРЬ" : "";
      const chs = sc.choices || [];
      const cw = 16, cg = 3, rowW = chs.length * cw + Math.max(0, chs.length - 1) * cg;
      let chips = "";
      chs.forEach((c, i) => {
        const cx = (W - rowW) / 2 + i * (cw + cg);
        const tk = !!taken[id] && taken[id][c.id] != null, sh = !!(shown[id] && shown[id][c.id]);
        const dead = c.outcomes.some((o) => o.to.startsWith("✝") && meta.journal[o.to]);
        const onGuide = gChoice[id] === c.id;
        const see = isOpen && (tk || sh || onGuide || devOn);
        const cls = !isOpen ? "unk" : (dead && tk ? "dead" : tk ? "taken" : sh || devOn ? "shown" : "unk") + (onGuide ? " guide" : "");
        chips += `<g class="chip ${cls}" transform="translate(${cx},${H - 19})"><rect width="${cw}" height="14" rx="3"/><text x="${cw / 2}" y="11" text-anchor="middle">${see ? (dead && tk ? "✝" : LETTERS[i] || i + 1) : "?"}</text></g>`;
      });
      const hideName = !isOpen || (kind === "final" && secretLocked(id) && !devOn);
      const title = hideName ? "" : esc((sc.title || id).replace(/^Демо\.\s*/, ""));
      const yr = kind === "final" || kind === "end" ? "" : esc(yearOf(sc.date) || "");
      const cls = ["fnode", "k-" + kind, isOpen ? "" : "fog", life.has(id) ? "now" : "", here ? "here" : "", gScenes.has(id) ? "guide" : ""].join(" ").replace(/\s+/g, " ").trim();
      nodes += `<g class="${cls}" data-id="${esc(id)}" tabindex="0" role="button" transform="translate(${p.x},${p.y})"><title>${hideName ? "ещё не прожито" : title}</title>
        <rect width="${W}" height="${H}" rx="${kind === "scene" ? 7 : 3}"/>${kind === "final" ? `<rect class="inner" x="3" y="3" width="${W - 6}" height="${H - 6}" rx="2"/>` : ""}
        ${kick ? `<text x="10" y="13" class="fk">${kick}</text>` : ""}
        <text x="10" y="${kick ? 29 : 19}" class="ft">${hideName ? "?" : title.length > 21 ? title.slice(0, 20) + "…" : title}</text>
        ${yr && kind === "scene" ? `<text x="10" y="${isOpen ? 33 : 40}" class="fd">${yr}${isOpen && sc.age != null ? " · мне " + sc.age : ""}</text>` : ""}
        ${chips}${here ? `<g class="here-flag" transform="translate(0,-8)"><rect width="64" height="15" rx="3"/><text x="32" y="11" text-anchor="middle">я здесь</text></g>` : ""}</g>`;
      // смерти — кружки справа
      (deathsOf[id] || []).forEach((d, k) => {
        const inJ = meta.journal[d], dx = p.x + W + 14 + (k % 2) * 18, dy = p.y + 10 + Math.floor(k / 2) * 18;
        const dd = G.deaths[d];
        deaths += `<line class="dlink${inJ ? " seen" : ""}" x1="${p.x + W}" y1="${p.y + 18}" x2="${dx}" y2="${dy}"/>`;
        deaths += `<g class="dnode${inJ ? " seen" : ""}${isOpen ? "" : " fog"}" data-death="${esc(d)}" transform="translate(${dx},${dy})"><title>${inJ ? esc("✝ " + (yearOf(dd.date) || "") + " · " + (dd.title || "")) : "смерть, которой ещё не было"}</title><circle r="7"/><text y="3.5" text-anchor="middle">${inJ ? "✝" : "?"}</text></g>`;
      });
    }
    // пелена тумана: сеяные клубы, живущие своими циклами; открытым сценам — рваные поляны
    if (!devOn) {
      const openPts = Object.entries(pos).filter(([id]) => open(id)).map(([, p]) => p);
      const thin = 1 - 0.25 * (LANES.filter(([l]) => laneOpen[l]).length / LANES.length); // мир яснеет — туман редеет
      fog = makeFog(L, openPts, thin);
    }
    const defs = `<defs>` +
      `<radialGradient id="fogpuff"><stop offset="0" stop-color="#93aec9" stop-opacity=".15"/><stop offset=".55" stop-color="#7e9bbd" stop-opacity=".085"/><stop offset="1" stop-color="#6f8dab" stop-opacity="0"/></radialGradient>` +
      `<radialGradient id="fogpuffb"><stop offset="0" stop-color="#a9b4c6" stop-opacity=".14"/><stop offset=".6" stop-color="#96a3b6" stop-opacity=".07"/><stop offset="1" stop-color="#8a99ad" stop-opacity="0"/></radialGradient>` +
      `<radialGradient id="fogrim"><stop offset="0" stop-color="#d5e4f4" stop-opacity=".11"/><stop offset=".6" stop-color="#b9cfe6" stop-opacity=".055"/><stop offset="1" stop-color="#a9c2dc" stop-opacity="0"/></radialGradient>` +
      `<radialGradient id="fogbank"><stop offset="0" stop-color="#5f7896" stop-opacity=".13"/><stop offset=".7" stop-color="#51698a" stop-opacity=".06"/><stop offset="1" stop-color="#49607e" stop-opacity="0"/></radialGradient>` +
      `</defs>`;
    $("#flow-canvas").innerHTML = `<svg width="${L.width * flowZoom}" height="${L.height * flowZoom}" viewBox="0 0 ${L.width} ${L.height}" role="img" aria-label="Моя жизнь: схема всех развилок">${defs}<g class="lanes">${lanes}</g><g class="axis">${axis}</g><g class="edges">${edges}</g><g class="deaths">${deaths}</g><g class="nodes">${nodes}</g></svg>${fog ? fogHtml(L, fog, defs) : ""}`;
    flowSize = { w: L.width, h: L.height };
    const lanesOpen = LANES.filter(([l]) => laneOpen[l]).length;
    $("#flow-count").textContent = `${progressLine()} · развилок: ${opened} из ${total} · дорожек открыто: ${lanesOpen} из ${LANES.length}`;
    const fg = $("#flow-guide");
    fg.hidden = !gp;
    if (gp) { fg.innerHTML = `Подсвечен путь к «${esc(gp.title)}». <button class="link" id="btn-guide-off">убрать</button>`; $("#btn-guide-off").onclick = () => { guideOn = null; guideCut = null; renderFlow(); }; }
    $("#flow-card").hidden = true;
    // мини-карта: вся игра точками, рамка — что сейчас на экране
    const mk = (flowMiniK = Math.min(96 / L.width, 230 / L.height));
    let dots = "";
    for (const [id, p] of Object.entries(pos)) if (open(id)) dots += `<rect class="${open(id) ? "o" : "f"}${life.has(id) ? " n" : ""}" x="${(p.x * mk).toFixed(1)}" y="${(p.y * mk).toFixed(1)}" width="${Math.max(2, W * mk).toFixed(1)}" height="${Math.max(1.5, H * mk).toFixed(1)}"/>`;
    $("#flow-mini").innerHTML = `<svg width="${(L.width * mk).toFixed(0)}" height="${(L.height * mk).toFixed(0)}" viewBox="0 0 ${(L.width * mk).toFixed(0)} ${(L.height * mk).toFixed(0)}">${dots}<rect class="vp" x="0" y="0" width="10" height="10"/></svg>`;
    flowMini();
    const jump = (q) => { const t = pos[q]; if (!t) return; const wrap = $("#flow-wrap"); wrap.scrollTo({ left: Math.max(0, (t.x + W / 2) * flowZoom - wrap.clientWidth / 2), top: Math.max(0, t.y * flowZoom - wrap.clientHeight / 3), behavior: REDUCED ? "auto" : "smooth" }); };
    $("#z-anchor").onclick = () => jump("Я-01");
    $("#z-here").onclick = () => jump(S && pos[S.scene] ? S.scene : "Т-01");
    const here = gp ? pos[gp.steps[0] && gp.steps[0].scene] : (S && pos[S.scene]) || pos["Т-01"];
    if (here) { const wrap = $("#flow-wrap"); requestAnimationFrame(() => { wrap.scrollLeft = Math.max(0, (here.x + W / 2) * flowZoom - wrap.clientWidth / 2); wrap.scrollTop = Math.max(0, here.y * flowZoom - wrap.clientHeight / 3); }); }
  }

  let flowMiniK = 0.05;
  function flowMini() {
    const wrap = $("#flow-wrap"), vp = document.querySelector("#flow-mini .vp");
    if (!vp || !flowSize.w) return;
    const mk = flowMiniK, z = flowZoom;
    vp.setAttribute("x", (wrap.scrollLeft / z * mk).toFixed(1)); vp.setAttribute("y", (wrap.scrollTop / z * mk).toFixed(1));
    vp.setAttribute("width", Math.min(flowSize.w * mk, wrap.clientWidth / z * mk).toFixed(1)); vp.setAttribute("height", (wrap.clientHeight / z * mk).toFixed(1));
  }
  (function initFlowMini() {
    const wrap = $("#flow-wrap"), mini = $("#flow-mini");
    wrap.addEventListener("scroll", () => requestAnimationFrame(flowMini), { passive: true });
    mini.addEventListener("click", (e) => {
      const r = mini.querySelector("svg").getBoundingClientRect(), mk = flowMiniK * (r.width / (flowSize.w * flowMiniK));
      const ux = (e.clientX - r.left) / mk, uy = (e.clientY - r.top) / mk;
      wrap.scrollTo({ left: Math.max(0, ux * flowZoom - wrap.clientWidth / 2), top: Math.max(0, uy * flowZoom - wrap.clientHeight / 2), behavior: REDUCED ? "auto" : "smooth" });
    });
  })();

  // карточка узла по тапу
  function openFlowCard(id, isDeath) {
    const card = $("#flow-card");
    let h = "";
    if (isDeath) {
      const d = G.deaths[id], inJ = meta.journal[id];
      h = inJ ? `<p class="mono kicker">смерть · ${esc(yearOf(d.date) || "")}</p><h3>✝ ${esc(d.title || "")}</h3>${d.epitaph ? `<p class="dim">${esc(d.epitaph)}</p>` : ""}${d.lesson ? `<p class="mono tiny">⟲ ${esc(d.lesson)}</p>` : ""}`
        : `<p class="mono kicker">смерть</p><h3>✝ ?</h3><p class="dim">Смерть, которой ещё не было.</p>`;
    } else {
      const sc = G.scenes[id], L = flowLayout(), kind = L.pos[id] && L.pos[id].kind;
      const isOpen = devOn || meta.visited[id];
      const g = G.guides && G.guides[id], locked = g && g.secret && !meta.visited[id] && !(g.gate && meta.visited[g.gate]);
      if (!isOpen) {
        h = `<p class="mono kicker">${kind === "final" ? "финал" : kind === "end" ? "тупик" : esc(yearOf(sc.date) || "")}</p><h3>?</h3><p class="dim">${kind === "final" && locked ? "Этот финал ещё скрыт." : "Ещё не прожито."}</p>${(sc.choices || []).length ? `<p class="mono tiny dim">развилок: ${(sc.choices || []).length}</p>` : ""}`;
      } else {
        const tk = meta.taken[id] || {}, sh = meta.shown[id] || {};
        const rows = (sc.choices || []).map((c, i) => {
          const see = devOn || tk[c.id] != null || sh[c.id];
          const dead = c.outcomes.some((o) => o.to.startsWith("✝") && meta.journal[o.to]);
          const st = tk[c.id] != null ? (dead ? "✝" : "✓") : sh[c.id] ? "·" : "?";
          return `<li><span class="mono">${LETTERS[i] || i + 1} ${st}</span> ${see ? md(c.label) : "— — —"}</li>`;
        }).join("");
        const ds = L.deathsOf[id] || [], dj = ds.filter((d) => meta.journal[d]);
        h = `<p class="mono kicker">${kind === "final" ? "финал · " : kind === "end" ? "тупик · " : ""}${esc(sc.date || "")}${sc.age != null ? " · мне " + sc.age : ""}${devOn ? " · " + esc(id) : ""}</p><h3>${esc(sc.title || id)}</h3>${rows ? `<ul class="fc-ch">${rows}</ul>` : ""}${ds.length ? `<p class="mono tiny">${dj.length ? "в Журнале: " + dj.map((d) => "✝ " + esc(G.deaths[d].title || d)).join(", ") : ""}${ds.length - dj.length ? `${dj.length ? " · " : ""}ещё не найдено смертей: ${ds.length - dj.length}` : ""}</p>` : ""}`;
      }
    }
    card.innerHTML = `<button class="close ghost fc-x" aria-label="Закрыть">×</button>${h}`;
    card.hidden = false;
    card.querySelector(".fc-x").onclick = () => (card.hidden = true);
  }
  (function initFlowTap() {
    const wrap = $("#flow-wrap");
    let st = null, moved = false;
    wrap.addEventListener("pointerdown", (e) => { st = { x: e.clientX, y: e.clientY }; moved = false; });
    wrap.addEventListener("pointermove", (e) => { if (st && Math.hypot(e.clientX - st.x, e.clientY - st.y) > 6) moved = true; });
    wrap.addEventListener("click", (e) => {
      if (moved) return;
      const d = e.target.closest("[data-death]"), n = e.target.closest("[data-id]");
      if (d) openFlowCard(d.dataset.death, true);
      else if (n) openFlowCard(n.dataset.id);
      else $("#flow-card").hidden = true;
    });
    wrap.addEventListener("keydown", (e) => {
      const n = e.target.closest && e.target.closest("[data-id]");
      if (n && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openFlowCard(n.dataset.id); }
      if (e.key === "Escape") $("#flow-card").hidden = true;
    });
  })();

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

  // ================= режим автора (пункт меню или ?dev; хранится в localStorage) =================
  // Подписи на вариантах: куда ведёт, условия, fx; закрытые — с текстом и «не хватило»; панели состояния,
  // справка по статам и прыжок в сцену с реальным состоянием из пути-свидетеля (game/dev.js, tools/dev_presets.py).
  const DEVKEY = "qq_dev";
  if (/[?&]dev(=|&|$)/.test(location.search)) store.set(DEVKEY, true);
  let devOn = !!store.get(DEVKEY, false);
  let devLoading = null;
  function devLoad() {
    if (window.DEV) return Promise.resolve(window.DEV);
    if (devLoading) return devLoading;
    devLoading = new Promise((res) => {
      const sc = document.createElement("script");
      sc.src = "dev.js";
      sc.onload = () => res(window.DEV || null);
      sc.onerror = () => { devLoading = null; res(null); };
      document.head.append(sc);
    });
    return devLoading;
  }
  const exprStr = (e) => {
    if (!e || typeof e !== "object") return String(e);
    switch (e.op) {
      case "num": case "lit": return e.v === null ? "null" : String(e.v);
      case "var": case "truthy": return e.n;
      case "not": return "!" + exprStr(e.a);
      case "and": case "or": return "(" + e.a.map(exprStr).join(e.op === "and" ? " && " : " || ") + ")";
      case "cmp": return `${exprStr(e.l)} ${e.c} ${exprStr(e.r)}`;
      case "seen": return (e.life ? "seen_life(" : "seen(") + e.id + ")";
      case "lived": return "lived(" + e.id + ")";
      case "kinds": case "branches": case "one_life": return e.op + "()";
    }
    return e.op;
  };
  const nameOf = (to) => { const x = G.scenes[to] || G.deaths[to]; return to.startsWith("✝") ? to : `${to} «${(x && x.title) || ""}»`; };
  const fmtFx = (fx) => (fx || []).map(([k, n, v]) => (k === "add" ? `${n} ${v >= 0 ? "+" : ""}${v}` : k === "cap" ? `${n} ≤ ${v}` : `${n} = ${v}`)).join(", ");
  // чего не хватило: невыполненные части условия с текущими значениями
  function lack(e, st) {
    if (!e || ev(e, st)) return [];
    switch (e.op) {
      case "and": return e.a.flatMap((x) => lack(x, st));
      case "or": return [e.a.map((x) => lack(x, st).join(" и ")).filter(Boolean).join(" или ")];
      case "cmp": {
        if (e.l.op === "var" && e.r.op === "num") { const v = st[e.l.n] ?? 0; return [e.c === ">=" || e.c === ">" ? `${e.l.n} ${v}/${e.r.v}` : `${e.l.n} ${v}, нужно ${e.c} ${e.r.v}`]; }
        if (e.l.op === "var") return [`${e.l.n} = ${st[e.l.n] ?? "null"}, нужно ${e.c} ${exprStr(e.r)}`];
        if ((e.l.op === "kinds" || e.l.op === "branches") && e.r.op === "num") return [`${e.l.op}() ${ev(e.l, st)}, нужно ${e.c} ${e.r.v}` + (e.l.op === "kinds" ? ` (${[...kindsSeen()].join(", ") || "—"})` : ` (${[...branchesLived()].join(", ") || "—"})`)];
        return [exprStr(e)];
      }
      case "truthy": return [`${e.n} не стоит`];
      case "seen": return [(e.life ? "не умирал здесь: " : "нет в Журнале: ") + e.id];
      case "lived": return ["не прожито: " + e.id];
      case "one_life": return ["только в режиме «Одна жизнь»"];
      default: return ["нужно: " + exprStr(e)];
    }
  }
  function devCapHtml(c, st) {
    const now = c.outcomes.find((x) => ok(x.if, st));
    const outs = c.outcomes.map((o) => `<span class="${o === now ? "dv-now" : ""}">${o === now ? "▸ " : ""}${o.if_src ? esc(o.if_src) + " " : c.outcomes.length > 1 ? "иначе " : ""}→ ${esc(nameOf(o.to))}${o.fx && o.fx.length ? " · " + esc(fmtFx(o.fx)) : ""}</span>`);
    return `<small class="devcap mono">${outs.join("<br>")}` +
      (c.visible_src ? `<br><span class="dv-vis">видно: ${esc(c.visible_src)}</span>` : "") +
      (c.fx && c.fx.length ? `<br><span class="dv-fx">fx: ${esc(fmtFx(c.fx))}</span>` : "") + `</small>`;
  }
  function devDecorate(b, c, st) {
    b.insertAdjacentHTML("beforeend", devCapHtml(c, st));
    const t = devTailStep();
    if (t && t[1] === c.id) { b.classList.add("dev-path"); b.insertAdjacentHTML("beforeend", `<small class="dv-path mono">▶ путь к ${esc(nameOf(S.dev.target))}${t[2] ? " · сначала умереть здесь" : ""}</small>`); }
  }
  function devLocked(c, st) {
    const b = document.createElement("button");
    b.className = "choice locked dev-locked"; b.disabled = true;
    b.innerHTML = `<span class="num mono">${esc(c.id)}</span><span class="lbl">${md(c.label)}</span><small class="devcap mono dv-lack">не хватило: ${esc(lack(c.visible, st).join(" · ") || c.visible_src)}</small>` + devCapHtml(c, st);
    return b;
  }
  // следующий шаг пути-свидетеля к цели прыжка в этой сцене (смерть-разведка — раньше живого шага)
  function devTailStep() {
    if (!S || !S.dev || !S.dev.tail) return null;
    return S.dev.tail.find((t) => t[0] === S.scene && t[1] && !(t[2] && S.lifeSeen[t[2]])) || null;
  }
  // над вариантами: к каким целям ведёт выбор (по пресетам этой сцены)
  function devGoals(nav, sc) {
    const P = window.DEV && window.DEV.presets[S.scene];
    const box = document.createElement("div"); box.className = "dev-goals mono";
    const by = {};
    if (P) for (const [tid, p] of Object.entries(P)) { const t = p.tail.find((x) => x[0] === S.scene && x[1] && !x[2]); if (t) (by[t[1]] = by[t[1]] || []).push(tid); }
    const parts = Object.entries(by).map(([cid, ts]) => `<b>${esc(cid)}</b> → ${ts.map(esc).join(", ")}`);
    box.innerHTML = `<span>⚙ ${esc(S.scene)}${S.dev ? " · цель " + esc(S.dev.target) : ""}</span>` + (parts.length ? `<span>к целям: ${parts.join(" · ")}</span>` : window.DEV ? "" : `<span class="dim">пресеты грузятся…</span>`);
    nav.insertBefore(box, nav.firstChild);
    if (!window.DEV) devLoad().then((d) => { if (d && S && !$("#scene").hidden && G.scenes[S.scene] === sc) renderChoices(sc); });
  }

  // ---------- панель «Состояние»
  const where = (s) => `<span class="dv-s">${esc(s.y || "")} · ${esc(s.s)}</span> ${esc(s.w)}`;
  const cmpTxt = { ">=": "≥", "<=": "≤", ">": ">", "<": "<", "==": "=", "!=": "≠" };
  function renderDevState() {
    const box = $("#devstate-body");
    if (!S) { box.innerHTML = `<p class="dim">Жизнь не начата. Начни новую или прыгни в сцену.</p>`; return; }
    const st = S.st;
    let h = `<p class="mono tiny dim">сцена ${esc(S.scene)} · жизнь ${meta.lives || 0} · стек: ${esc(S.stack.map((x) => x.scene).join(" › "))}${S.dev ? " · цель " + esc(S.dev.target) : ""}</p><h3>Переменные</h3>`;
    for (const [k, v] of Object.entries(C.vars)) {
      const ch = (G.var_checks || {})[k] || [], fx = (G.var_fx || {})[k] || [];
      h += `<details class="dv-row"><summary><span class="mono">${esc(k)}</span> <b>${esc(st[k])}</b> <span class="dim">${esc(v.name)}${v.tiers ? " · " + esc(tier(k, st[k])) : ""}</span><span class="dv-cnt mono">${ch.length} пров. · ${fx.length} изм.</span></summary>
        <p class="dv-h">проверяется</p><ul>${ch.map((x) => `<li class="${ev({ op: "cmp", c: x.c, l: { op: "var", n: k }, r: { op: "num", v: x.n } }, st) ? "dv-pass" : ""}">${where(x)} · <b>${cmpTxt[x.c] || x.c} ${x.n}</b> · ${esc(x.g)}</li>`).join("") || "<li>нигде</li>"}</ul>
        <p class="dv-h">меняется</p><ul>${fx.map((x) => `<li>${where(x)} · <b>${esc(x.d)}</b></li>`).join("") || "<li>нигде</li>"}</ul></details>`;
    }
    const flagRow = (f) => {
      const src = (G.flag_src || {})[f] || [], rd = (G.flag_reads || {})[f] || [];
      return `<details class="dv-row"><summary><span class="mono">${esc(f)}</span> <b>${esc(st[f] ?? "—")}</b><span class="dv-cnt mono">${src.length} ст. · ${rd.length} чт.</span></summary>
        <p class="dv-h">ставится</p><ul>${src.map((s2) => `<li>${esc(nameOf(s2))}</li>`).join("") || "<li>нигде (не выбором)</li>"}</ul>
        <p class="dv-h">читается</p><ul>${rd.map((x) => `<li>${where(x)} · <code>${esc(x.c)}</code></li>`).join("") || "<li>нигде</li>"}</ul></details>`;
    };
    const fl = Object.keys(C.flags), on = fl.filter((f) => st[f] != null), off = fl.filter((f) => st[f] == null);
    h += `<h3>Флаги: поставлено ${on.length}</h3>${on.map(flagRow).join("")}<details class="dv-off"><summary class="mono">не поставлены (${off.length})</summary>${off.map(flagRow).join("")}</details>`;
    if (st[CLK] != null) h += `<p class="mono tiny">${CLK} = ${esc(st[CLK])} с</p>`;
    box.innerHTML = h;
  }

  // ---------- панель «Справка по статам»
  function renderDevStats() {
    const box = $("#devstats-body");
    box.innerHTML = Object.entries(C.vars).map(([k, v]) => {
      const ch = (G.var_checks || {})[k] || [];
      const ths = [...new Set(ch.map((x) => x.n))].sort((a, b) => a - b);
      return `<details class="dv-row"${v.hidden ? "" : " open"}><summary><span class="mono">${esc(k)}</span> <b>${esc(v.name)}</b><span class="dv-cnt mono">${ch.length} проверок · пороги ${ths.join(", ") || "—"}</span></summary>
        <ul>${ch.map((x) => `<li>${where(x)} · <b>${cmpTxt[x.c] || x.c} ${x.n}</b> · ${esc(x.g)}</li>`).join("") || "<li>нигде не проверяется</li>"}</ul></details>`;
    }).join("");
  }

  // ---------- панель «Прыжок в сцену»: сцена → цель → старт с реальным состоянием пути-свидетеля
  const branchOf = (id) => (/^(Т|Ф|⊣К|Я)-/.test(id) ? { "Т": "Ствол", "Ф": "Финалы", "⊣К": "Тупики", "Я": "Якорь" }[id.split("-")[0]] : id.split("-")[0]);
  let jumpPick = null;
  function renderDevJump() {
    const box = $("#devjump-body"), q = ($("#devjump-q").value || "").trim().toLowerCase();
    if (!window.DEV) { box.innerHTML = `<p class="dim">Пресеты грузятся… (game/dev.js; собери: python3 tools/build.py)</p>`; devLoad().then((d) => { if (d) renderDevJump(); else box.innerHTML = `<p class="dim">Нет game/dev.js. Собери: <code>python3 tools/build.py</code>.</p>`; }); return; }
    const D = window.DEV;
    if (jumpPick) {
      const sc = G.scenes[jumpPick], P = D.presets[jumpPick] || {}, F = D.fail[jumpPick] || [];
      const goals = [...Object.keys(P), ...F].sort();
      box.innerHTML = `<button class="link mono" id="dj-back">← все сцены</button><h3>${esc(jumpPick)} «${esc(sc.title)}» <span class="dim mono tiny">${esc(yearOf(sc.date) || "")}</span></h3>
        <p>Статы под какую дальнейшую историю?</p><div class="dj-goals">${goals.map((t) => {
          const p = P[t], g = G.scenes[t];
          return `<button class="choice dj-goal${p ? "" : " locked"}" data-t="${esc(t)}"${p ? "" : " disabled"}><span class="lbl">${esc(t)} «${esc(g.title)}»</span><small class="mono">${p ? `${p.tail.length} шагов · ${esc(Object.entries(p.st).filter(([k]) => C.vars[k] && !C.vars[k].hidden).map(([k, v]) => k + " " + v).join(" "))}` : "пути не найдено"}</small></button>`;
        }).join("") || `<p class="dim">Отсюда целей нет: это сама цель или конец.</p>`}</div>`;
      $("#dj-back").onclick = () => { jumpPick = null; renderDevJump(); };
      box.querySelectorAll(".dj-goal:not([disabled])").forEach((b) => (b.onclick = () => devJump(jumpPick, b.dataset.t)));
      return;
    }
    const groups = {};
    for (const [id, sc] of Object.entries(G.scenes)) {
      if (q && !(id.toLowerCase().includes(q) || (sc.title || "").toLowerCase().includes(q))) continue;
      (groups[branchOf(id)] = groups[branchOf(id)] || []).push([id, sc]);
    }
    const rank = (g) => ({ "Ствол": "0", "Якорь": "8", "Финалы": "9a", "Тупики": "9b" }[g] || "5" + g);
    box.innerHTML = Object.entries(groups).sort((a, b) => rank(a[0]).localeCompare(rank(b[0]))).map(([g, list]) => `<h3 class="dj-branch mono">${esc(g)}</h3><div class="dj-list">${list.map(([id, sc]) => {
      const n = Object.keys(D.presets[id] || {}).length, f = (D.fail[id] || []).length;
      return `<button class="dj-scene" data-id="${esc(id)}"><span class="mono">${esc(id)}</span> ${esc(sc.title)} <span class="dim mono tiny">${esc(yearOf(sc.date) || "")} · целей ${n}${f ? "/" + (n + f) : ""}</span></button>`;
    }).join("")}</div>`).join("") || `<p class="dim">Ничего не нашлось.</p>`;
    box.querySelectorAll(".dj-scene").forEach((b) => (b.onclick = () => { jumpPick = b.dataset.id; renderDevJump(); window.scrollTo(0, 0); }));
  }
  function devJump(sid, tid) {
    const p = window.DEV && window.DEV.presets[sid] && window.DEV.presets[sid][tid];
    if (!p) return false;
    meta.lives = (meta.lives || 0) + 1; saveMeta();
    const st = initState(); Object.assign(st, p.st);
    S = { scene: sid, st, stack: [], trail: p.tr.map(([scene, choice, flags]) => ({ scene, choice, flags })), lifeSeen: {}, lifeBlocks: {}, awake: null, ghost: null, year: null, replay: false, past: {}, rootShown: true, dev: { target: tid, tail: p.tail } };
    // стек отката: последние шаги до сцены с их настоящими состояниями (отличия от состояния входа)
    for (const [ps, pc, diff, ti] of p.pre) {
      const s2 = clone(st); for (const [k, v] of Object.entries(diff)) s2[k] = v;
      const psc = G.scenes[ps];
      if (psc && visible(psc, s2).length >= 2) S.stack.push({ scene: ps, st: s2, seal: sealOf(psc), taken: pc, trail: ti });
    }
    jumpPick = null;
    enter(sid);
    return true;
  }
  function devApply() {
    document.body.classList.toggle("dev", devOn);
    const b = $("#btn-dev"); b.textContent = devOn ? "режим автора: вкл" : "режим автора: выкл"; b.setAttribute("aria-pressed", String(devOn));
    $("#dev-menu").hidden = !devOn;
    $("#btn-dev-bar").hidden = !devOn;
    const dlc = $("#btn-dlc"); if (dlc) dlc.hidden = !(devOn || dlcUnlocked()); // режим автора открывает DLC сразу
    if (devOn) { devLoad(); window.QQDEV = { jump: devJump, load: devLoad }; }
  }
  function devTitle() { devApply(); }
  $("#btn-dev").onclick = () => { devOn = !devOn; store.set(DEVKEY, devOn); devApply(); buzz(10); };
  for (const [btn, panel] of [["#btn-devjump", "#devjump"], ["#btn-devstate", "#devstate"], ["#btn-devstats", "#devstats"], ["#btn-dev-bar", "#devstate"], ["#dv-to-jump", "#devjump"], ["#dv-to-stats", "#devstats"], ["#dv-to-state", "#devstate"]])
    $(btn).onclick = () => openPanel(panel);
  $("#devjump-q").oninput = () => { jumpPick = null; renderDevJump(); };

  // ---------- титул: продолжение, прогресс, счётчики разделов
  const savedLife = () => {
    const sv = store.get(SAVE, null);
    const sc = sv && G.scenes[sv.scene];
    if (!sc || (!(sc.choices || []).length && !sc.next)) return null; // финал прожит — продолжать нечего
    return { sv, sc };
  };
  let newArmed = null;
  function dlcUnlocked() { return Object.keys(meta.visited || {}).some((id) => id.startsWith("Ф-") || id.startsWith("⊣")); }
  function showTitle() {
    show("#title");
    document.body.dataset.life = "";
    document.body.dataset.era = "none"; // на титуле — натриевый акцент, а не цвет эпохи последней сцены
    const ids = Object.keys(G.scenes), ends = ids.filter((id) => G.scenes[id].stage === "final"), deaths = Object.keys(G.deaths);
    const seenE = ends.filter((id) => meta.visited[id]).length, seenD = deaths.filter((id) => meta.journal[id]).length;
    const lives = meta.lives || 0;
    $("#title-line").textContent = lives
      ? `прожито жизней: ${lives} · концовок ${seenE} из ${ends.length} · смертей ${seenD} из ${deaths.length}`
      : `впереди: ${ends.length} концовок · ${deaths.length} смертей · ${ids.length} сцен`;
    const live = savedLife();
    const cb = $("#btn-continue"), nb = $("#btn-new");
    $("#btn-one").hidden = !meta.visited["Ф-04"]; // «Одна жизнь» — после того, как хоть раз дошёл до Ф-04
    $("#btn-dlc").hidden = !(devOn || dlcUnlocked()); // DLC — после первого финала/тупика; в режиме автора видно сразу (решение автора 14.11)
    cb.hidden = !live;
    nb.classList.toggle("ghost-choice", !!live);
    disarmNew();
    if (live) {
      const y = yearOf(live.sc.date);
      $("#continue-sub").textContent = `${live.sv.oneLife ? "одна жизнь · " : ""}жизнь ${lives || 1}${y ? " · " + y : ""} · «${(live.sc.title || live.sv.scene).replace(/^Демо\.\s*/, "")}»`;
    }
    const jn = Object.keys(meta.journal || {}).length + (meta.root ? 1 : 0);
    $("#m-journal").textContent = jn ? `${jn} ${jn % 10 === 1 && jn % 100 !== 11 ? "строка" : jn % 10 >= 2 && jn % 10 <= 4 && (jn % 100 < 12 || jn % 100 > 14) ? "строки" : "строк"}` : "пусто";
    $("#m-flow").textContent = `${ids.filter((id) => meta.visited[id]).length}/${ids.length}`;
    $("#m-guide").textContent = `${seenE}/${ends.length}`;
    soundBtn();
    devTitle();
    syncStill();
    bootTitle();
    if (window.qqFloat) qqFloat();
  }
  let oneArmed = null;
  function disarmNew() {
    clearTimeout(newArmed); newArmed = null;
    $("#btn-new").classList.remove("armed");
    $("#btn-new .cta-l").textContent = "Новая жизнь";
    $("#new-sub").textContent = "с лета 1996-го, мне семь";
    clearTimeout(oneArmed); oneArmed = null;
    $("#btn-one").classList.remove("armed");
    $("#btn-one .cta-l").textContent = "Одна жизнь";
    $("#one-sub").textContent = "как у всех людей: одна смерть, и отката нет";
  }

  // ---------- кнопки
  // при живом сохранении «Новая жизнь» просит второе нажатие: первое только предупреждает
  $("#btn-new").onclick = () => {
    if (!savedLife() || newArmed) { disarmNew(); return leaveTitle(() => newLife()); }
    $("#btn-new").classList.add("armed");
    $("#btn-new .cta-l").textContent = "Начать заново?";
    $("#new-sub").textContent = "нажми ещё раз: эта жизнь оборвётся, Хор и «Моя жизнь» останутся";
    newArmed = setTimeout(disarmNew, 5000);
  };
  // «Одна жизнь»: новая игра без отката; при живом сохранении — тоже второе нажатие
  $("#btn-one").onclick = () => {
    if (!savedLife() || oneArmed) { disarmNew(); return leaveTitle(() => newLife(true)); }
    $("#btn-one").classList.add("armed");
    $("#btn-one .cta-l").textContent = "Начать одну жизнь?";
    $("#one-sub").textContent = "нажми ещё раз: эта жизнь оборвётся, Хор и «Моя жизнь» останутся";
    oneArmed = setTimeout(disarmNew, 5000);
  };
  $("#btn-continue").onclick = () => leaveTitle(() => { S = store.get(SAVE, null); if (S) { S.year = S.year || null; if (S.pending) resumeAfter(); else enter(S.scene, true); } });
  for (const [btn, panel] of [["#btn-journal", "#journal"], ["#btn-journal2", "#journal"], ["#btn-me", "#me"], ["#btn-flow", "#flow"], ["#btn-flow2", "#flow"], ["#btn-flow3", "#flow"], ["#btn-howto2", "#howto"], ["#btn-guide", "#guide"], ["#btn-guide2", "#guide"], ["#btn-guide3", "#guide"], ["#btn-howto", "#howto"], ["#btn-about", "#about"], ["#btn-about2", "#about"]])
    $(btn).onclick = () => openPanel(panel);
  $("#btn-quit").onclick = showTitle;
  $("#btn-dlc").onclick = () => { location.href = "obyasnenie/obyasnenie.html"; };
  // ---------- перенос прогресса: все ключи игры из localStorage (qq_* и DLC obyasnenie-*) в JSON-файл и обратно
  const IO_TAG = "tot-kto-ostalsya", ownKey = (k) => /^qq_/.test(k) || /^obyasnenie-/.test(k);
  function ioMsg(html, bad) { const m = $("#io-msg"); m.hidden = !html; m.classList.toggle("bad", !!bad); m.innerHTML = html || ""; return m; }
  $("#btn-export").onclick = () => {
    const keys = {};
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (ownKey(k)) keys[k] = localStorage.getItem(k); } } catch (e) { return ioMsg("Браузер не даёт прочитать сохранения.", true); }
    if (!keys[META]) return ioMsg("Сохранять пока нечего: ни одной жизни ещё не прожито.");
    const blob = new Blob([JSON.stringify({ game: IO_TAG, format: 1, saved: new Date().toISOString(), keys }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `tot-kto-ostalsya-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    ioMsg("Прогресс сохранён в файл. Его можно загрузить на другом устройстве.");
  };
  $("#btn-import").onclick = () => { const f = $("#import-file"); f.value = ""; f.click(); };
  $("#import-file").onchange = () => {
    const file = $("#import-file").files[0];
    if (!file) return;
    const r = new FileReader();
    r.onerror = () => ioMsg("Файл не читается.", true);
    r.onload = () => {
      let data = null;
      try { data = JSON.parse(r.result); } catch (e) { /* ниже */ }
      const keys = data && data.game === IO_TAG && data.keys && typeof data.keys === "object" ? data.keys : null;
      let m2 = null;
      try { m2 = keys && typeof keys[META] === "string" ? JSON.parse(keys[META]) : null; } catch (e) { m2 = null; }
      if (!keys || !m2 || typeof m2 !== "object" || Object.keys(keys).some((k) => !ownKey(k) || typeof keys[k] !== "string")) return ioMsg("Это не файл сохранения этой игры.", true);
      const jn = Object.keys(m2.journal || {}).length;
      const msg = ioMsg(`В файле: прожито жизней ${esc(m2.lives || 0)}, строк в Тетради Хора ${esc(jn)}${data.saved ? ", сохранено " + esc(String(data.saved).slice(0, 10)) : ""}. Текущий прогресс на этом устройстве заменится. <br><button class="set-btn" id="io-yes">заменить</button><button class="set-btn" id="io-no">не надо</button>`);
      msg.querySelector("#io-no").onclick = () => ioMsg("");
      msg.querySelector("#io-yes").onclick = () => {
        try {
          const old = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (ownKey(k)) old.push(k); }
          old.forEach((k) => localStorage.removeItem(k));
          for (const [k, v] of Object.entries(keys)) localStorage.setItem(k, v);
        } catch (e) { return ioMsg("Браузер не даёт записать сохранения.", true); }
        location.reload();
      };
    };
    r.readAsText(file);
  };
  function soundBtn() { for (const b of document.querySelectorAll("#btn-sound, #btn-sound2")) { b.textContent = snd.on() ? "звук: вкл" : "звук: выкл"; b.setAttribute("aria-pressed", String(snd.on())); } if (window.QQM) QQM.setMuted(!snd.on()); }
  for (const id of ["#btn-sound", "#btn-sound2"]) $(id).onclick = () => { snd.toggle(); soundBtn(); buzz(10); };
  document.querySelectorAll(".close").forEach((b) => (b.onclick = closePanel));
  // ---------- натюрморт в меню: пункт ↔ предмет на столе
  // «Новая жизнь» / «Продолжить»: лампа гаснет, и только потом — первая сцена
  let leaving = false;
  function leaveTitle(go) {
    if (leaving) return;
    const t = $("#title");
    if (REDUCED || t.hidden) return go();
    leaving = true; t.classList.add("leaving");
    setTimeout(() => { leaving = false; go(); t.classList.remove("leaving"); }, 520);
  }
  (function initStill() {
    const still = $("#still"), frame = $("#still-frame"), cap = $("#still-cap");
    if (!still) return;
    const hs = [...still.querySelectorAll(".hs")];
    let cur = null, idleT = null;
    const light = (bid) => {
      const btn = document.getElementById(bid), h = hs.find((x) => x.dataset.btn === bid);
      if (!btn || !h || btn.hidden || h.hidden) return dark();
      cur = bid;
      const fr = frame.getBoundingClientRect(), hr = h.getBoundingClientRect();
      const x = hr.left - fr.left + hr.width / 2, y = hr.top - fr.top + hr.height / 2, fw = frame.clientWidth, fh = frame.clientHeight;
      frame.style.setProperty("--sx", x + "px"); frame.style.setProperty("--sy", y + "px");
      frame.style.setProperty("--sr", Math.round(Math.max(44, Math.max(hr.width, hr.height) * 0.5)) + "px"); // луч — по размеру предмета
      if (cap) { // подпись: над предметом, если влезает, иначе под ним; по горизонтали — в пределах картины
        cap.textContent = (btn.querySelector(".m-t, .cta-l") || btn).textContent.trim();
        const cw = cap.offsetWidth, ch = cap.offsetHeight, pad = 10;
        let cy = hr.top - fr.top - ch - 8; if (cy < pad) cy = hr.bottom - fr.top + 8;
        cy = Math.max(pad, Math.min(fh - ch - pad, cy));
        const cx = Math.max(pad, Math.min(fw - cw - pad, x - cw / 2));
        cap.style.left = cx + "px"; cap.style.top = cy + "px"; cap.classList.add("show");
      }
      still.classList.add("lit");
      hs.forEach((x) => x.classList.toggle("on", x === h));
      document.querySelectorAll("#title [data-thing]").forEach((b) => b.classList.toggle("on", b.id === bid));
    };
    const dark = () => { cur = null; still.classList.remove("lit"); hs.forEach((x) => x.classList.remove("on")); document.querySelectorAll("#title [data-thing].on").forEach((b) => b.classList.remove("on")); };
    const mouse = (e) => e.pointerType === "mouse" || e.pointerType === "pen";
    for (const b of document.querySelectorAll("#title [data-thing]")) {
      b.addEventListener("pointerenter", (e) => { if (!mouse(e)) return; clearTimeout(idleT); light(b.id); });
      b.addEventListener("pointerleave", (e) => { if (!mouse(e)) return; idleT = setTimeout(dark, 250); });
      b.addEventListener("focus", () => { if (b.matches(":focus-visible")) light(b.id); });
      b.addEventListener("blur", () => { idleT = setTimeout(dark, 250); });
    }
    for (const h of hs) {
      h.addEventListener("pointerenter", (e) => { if (!mouse(e)) return; clearTimeout(idleT); light(h.dataset.btn); });
      h.addEventListener("pointerleave", (e) => { if (!mouse(e)) return; idleT = setTimeout(dark, 250); });
      h.addEventListener("click", (e) => { // предмет — та же кнопка, что и пункт меню
        e.stopPropagation();
        const btn = document.getElementById(h.dataset.btn);
        if (btn && !btn.hidden) btn.click();
      });
    }
    frame.addEventListener("click", () => dark());
    window.addEventListener("resize", () => cur && light(cur));
    // плавающая главная кнопка (телефон): видна, пока настоящая за краем экрана
    const fl = $("#cta-float");
    if (fl && "IntersectionObserver" in window) {
      let real = null, seen = false;
      const io = new IntersectionObserver((es) => { for (const e of es) if (e.target === real) { seen = e.isIntersecting; upd(); } });
      const upd = () => fl.classList.toggle("off", !real || seen || $("#title").hidden);
      fl.onclick = () => real && real.click();
      window.qqFloat = () => {
        const c = $("#btn-continue"); const n = c && !c.hidden ? c : $("#btn-new");
        if (real !== n) { if (real) io.unobserve(real); real = n; seen = false; io.observe(real); }
        fl.querySelector(".cf-l").textContent = real.querySelector(".cta-l").textContent; upd();
      };
    }
    const help = $("#warn-help"); if (help) help.onclick = (e) => { e.preventDefault(); e.stopPropagation(); $("#btn-about2").click(); };
  })();
  function bootTitle() { // первый вход за сессию: лампа щёлкает, картина проявляется
    let first = true;
    try { first = !sessionStorage.getItem("qq_boot"); sessionStorage.setItem("qq_boot", "1"); } catch (e) { first = false; }
    if (!first || REDUCED) return;
    const t = $("#title"); t.classList.add("boot"); setTimeout(() => t.classList.remove("boot"), 2600);
  }
  function syncStill() { // предметы спрятанных пунктов не светятся
    document.querySelectorAll("#still .hs").forEach((h) => { const b = document.getElementById(h.dataset.btn); h.hidden = !b || b.hidden; });
  }

  // ---------- сброс всего прогресса (Хор, «Моя жизнь», сохранения, вступление): как будто играешь впервые
  function wipeAll() {
    try { for (const k of Object.keys(localStorage)) if (k.startsWith("qq_")) localStorage.removeItem(k); } catch (e) { /* хранилище недоступно */ }
    try { sessionStorage.clear(); } catch (e) { /* ничего */ }
    location.replace(location.pathname + location.search.replace(/([?&])reset(=[^&]*)?&?/, "$1").replace(/[?&]$/, "") + location.hash);
  }
  if (/[?&]reset\b/.test(location.search)) { wipeAll(); return; }
  (function initWipe() {
    const b = $("#btn-wipe"); if (!b) return;
    let armed = null;
    b.onclick = () => {
      if (armed) { clearTimeout(armed); return wipeAll(); }
      b.textContent = "точно? нажми ещё раз — всё сотрётся";
      armed = setTimeout(() => { armed = null; b.textContent = "начать всё заново (стереть прогресс)"; }, 5000);
    };
  })();

  // вступление: теория и крючок до меню, каждый запуск (тесты и режим автора — сразу в меню)
  function showIntro() {
    const done = () => { document.body.classList.remove("itext"); meta.introSeen = true; saveMeta(); document.removeEventListener("keydown", key); showTitle(); };
    const key = (e) => { if ($("#intro").hidden) return; if (e.key === "Enter" || e.key === " " || e.key === "Escape") { e.preventDefault(); done(); } };
    $("#intro-next .cta-l").textContent = "В меню";
    $("#intro-next").onclick = done; // этот тап — жест: браузер разрешает музыку, тема меню стартует сразу
    document.addEventListener("keydown", key);
    show("#intro");
    document.body.classList.add("itext"); // фон-картинка приглушена, чтобы не лезла под буквы
  }
  $("#btn-intro-again").onclick = () => showIntro();
  if (/[?&](debug|dev|nointro)\b/.test(location.search)) showTitle(); else showIntro();
})();
