// Английская версия в браузере (канон п. 39): вступление → меню → ствол Т-00…Т-10 → выпускной → «Обычная жизнь».
// На каждом экране собирает видимую кириллицу (непереведённый интерфейс) и ошибки JS.
// Запуск: node tools/e2e_en.js [папка_для_скриншотов] [вариант: 0..3 — какой по счёту выбор брать в детстве]
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null;
  const pick = +(process.argv[3] || 0);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 420, height: 900 } });
  const errs = [], cyr = new Map();
  p.on('pageerror', (e) => errs.push(e.message));
  const url = 'file://' + require('path').resolve(__dirname, '../game/index.html');
  await p.goto(url + '?lang=en');
  const shot = async (name) => { if (out) await p.screenshot({ path: `${out}/en-${name}.png`, fullPage: true }); };
  // видимая кириллица вне служебных панелей и вне текста непереведённых сцен
  const scan = async (where) => {
    const found = await p.evaluate(() => {
      const res = [], CYR = /[А-Яа-яЁё]/;
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const t = n.nodeValue.trim();
        if (!t || !CYR.test(t)) continue;
        const el = n.parentElement;
        if (!el || el.closest('[hidden], .dev-panel, #dev-menu, #lore, script, style, .dbg, #btn-lang')) continue;
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        if (getComputedStyle(el).visibility === 'hidden') continue;
        res.push(t.slice(0, 120));
      }
      return res;
    });
    for (const t of found) if (!cyr.has(t)) cyr.set(t, where);
  };
  await p.waitForSelector('#askstats:not([hidden]), #intro:not([hidden])', { timeout: 15000 });
  if (await p.$('#askstats:not([hidden])')) { await scan('askstats'); await shot('askstats'); await p.click('#ask-no'); }
  await p.waitForSelector('#intro:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(500); await scan('intro'); await shot('intro');
  await p.click('#intro-next');
  await p.waitForSelector('#title:not([hidden])', { timeout: 15000 });
  await p.waitForTimeout(800); await scan('title'); await shot('title');
  const lang = await p.evaluate(() => [window.QQ_LANG, window.GRAPH.lang, document.title]);
  console.log('язык:', lang.join(' · '));
  for (const id of ['#btn-howto2', '#btn-about2']) {
    await p.click(id); await p.waitForTimeout(400); await scan(id); await shot(id.slice(1));
    await p.click('.screen:not([hidden]) .close'); await p.waitForTimeout(300);
  }
  await p.click('#btn-new');
  const meta = () => p.$eval('#meta', (e) => e.textContent).catch(() => '');
  let steps = 0, afters = 0, deaths = 0; const tried = {};
  const FULL = process.argv.includes('--full'); // пройти «Обычную жизнь» до конца, а не останавливаться на В7-01
  while (steps++ < 120) {
    await p.waitForSelector('#scene:not([hidden]), #death:not([hidden]), #chapter:not([hidden])', { timeout: 30000 });
    if (await p.$('#chapter:not([hidden])')) { await p.waitForSelector('#scene:not([hidden])', { timeout: 20000 }); }
    if (await p.$('#death:not([hidden])')) {
      await p.waitForSelector('#btn-death-next:not([hidden])', { timeout: 30000 });
      const root = !!(await p.$('#death .root-tomb'));
      await scan(root ? 'root' : 'death'); await shot(root ? 'root' : 'death-' + deaths);
      await p.click('#btn-death-next'); console.log(root ? '   ✝ Root' : '   ✝ death');
      if (!root) { // пробуждение: шок, затем «вдохнуть и остаться в этой минуте»
        deaths++;
        await p.waitForSelector('#awake:not([hidden]), #rewind:not([hidden]), #scene:not([hidden])', { timeout: 30000 });
        await p.click('#awake-text').catch(() => {}); await p.waitForTimeout(500);
        await scan('awake'); if (deaths === 1) await shot('awake');
        const bs = await p.$$('#awake-btns button'); if (bs.length) await bs[0].click();
        await p.waitForTimeout(500);
        if (await p.$('#rewind:not([hidden])')) { await scan('rewind'); const t = await p.$$('#tape button, #rewind button.choice'); if (t.length) await t[t.length - 1].click(); }
      }
      await p.waitForSelector('#scene:not([hidden])', { timeout: 20000 });
      continue;
    }
    await p.click('#text').catch(() => {}); await p.waitForTimeout(700);
    const m = await meta();
    const id = await p.evaluate(() => (window.__qqScene ? window.__qqScene() : null));
    await scan(m);
    const ls = await p.$$eval('#choices button:not([hidden])', (bs) => bs.map((x) => (x.querySelector('.lbl') || x).innerText.trim()));
    const title = await p.$eval('#text', (e) => (e.querySelector('h2, h1') || {}).innerText || '').catch(() => '');
    if (/^[^А-Яа-я]*$/.test(ls.join('')) === false && !/Next/.test(ls.join(''))) { console.log(m.padEnd(36), '| русский текст: стоп'); break; }
    if (steps === 3) await shot('scene');
    // после смерти в этой сцене — не тот же вариант: сперва эхо-выбор («I remember…», «I've seen…»), иначе следующий по счёту
    tried[m] = tried[m] || [];
    let i = ls.length > 1 ? Math.min(pick, ls.length - 1) : 0;
    if (tried[m].length) {
      const echo = ls.findIndex((l, k) => /^"I('ve| remember| know)/.test(l) && !tried[m].includes(k));
      i = echo >= 0 ? echo : ls.findIndex((l, k) => !tried[m].includes(k));
      if (i < 0) i = 0;
    }
    tried[m].push(i);
    console.log(m.padEnd(36), '→', (ls[i] || '?').slice(0, 60));
    if (/Stay\. A job/.test(ls.join('|'))) { // выпускной: идём в «Обычную жизнь»
      const g = ls.findIndex((l) => /^Stay\./.test(l));
      await shot('graduation');
      await (await p.$$('#choices button:not([hidden])'))[g].click(); await p.waitForTimeout(600);
      await p.waitForSelector('#scene:not([hidden])', { timeout: 20000 }); await p.click('#text').catch(() => {}); await p.waitForTimeout(700);
      await scan('В7-01'); console.log((await meta()).padEnd(36), '| В7-01 достигнута'); if (!FULL) break; continue;
    }
    await (await p.$$('#choices button:not([hidden])'))[i].click(); await p.waitForTimeout(400);
    if (!(await p.$('#scene[hidden]')) && (await p.$('#text p.picked'))) { // экран «После»
      afters++; await p.click('#text').catch(() => {}); await p.waitForTimeout(500);
      await scan(m + ' / после'); if (afters === 1) await shot('after');
      await p.waitForSelector('#choices button', { timeout: 10000 });
      await (await p.$$('#choices button'))[0].click(); await p.waitForTimeout(400);
    }
  }
  await p.click('#btn-me').catch(() => {}); await p.waitForTimeout(400); await scan('Я'); await shot('me');
  await p.click('.screen:not([hidden]) .close').catch(() => {});
  await p.click('#btn-journal').catch(() => {}); await p.waitForTimeout(400); await scan('Хор'); await shot('journal');
  const missing = await p.evaluate(() => Object.keys(window.QQ_I18N_MISSING || {}));
  console.log('экранов «После»:', afters, '· смертей:', deaths);
  console.log('видимая кириллица:', cyr.size ? '' : 'нет');
  for (const [t, w] of cyr) console.log('  ·', JSON.stringify(t), '←', w);
  console.log('словарь не узнал (всего, вкл. скрытое):', missing.length);
  for (const t of missing.slice(0, 20)) console.log('  ·', JSON.stringify(t.slice(0, 120)));
  console.log('ОШИБКИ JS:', errs.length ? errs : 'нет');
  await b.close();
  process.exit(errs.length ? 1 : 0);
})();
