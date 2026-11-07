// Режим автора: прыжок в сцену с пресетом под цель и проигрывание хвоста пути (game/dev.js) в настоящем движке.
// Первая пара проходит через меню (Прыжок в сцену → поиск → сцена → цель), остальные — через window.QQDEV.jump.
// Запуск: node tools/dev_jump_play.js [папка_скриншотов] [all]   (all — все пары, долго)
const { chromium } = require('playwright');
const path = require('path');
global.window = {};
require(path.resolve(__dirname, '../game/graph.js'));
require(path.resolve(__dirname, '../game/dev.js'));
const G = global.window.GRAPH, DEV = global.window.DEV;
(async () => {
  const out = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2] : null;
  const all = process.argv.includes('all');
  // 3 сцены из разных частей игры × 2 цели (или все пары)
  let pairs = [];
  if (all) for (const [s, ts] of Object.entries(DEV.presets)) for (const t of Object.keys(ts)) pairs.push([s, t]);
  else {
    const want = ['Т-05', 'В2-03', 'В6-04', 'В1-04', 'В7-02', 'В5-03'];
    for (const s of want) {
      const ts = Object.keys(DEV.presets[s] || {});
      if (ts.length < 2 || pairs.length >= 6) continue;
      pairs.push([s, ts[0]], [s, ts[ts.length - 1]]);
    }
  }
  const b = await chromium.launch();
  let fails = 0, n = 0;
  for (const [sid, tid] of pairs) {
    const p = await b.newPage({ viewport: { width: 420, height: 900 } });
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + path.resolve(__dirname, '../game/index.html') + '?dev');
    await p.evaluate(() => localStorage.clear());
    await p.goto('file://' + path.resolve(__dirname, '../game/index.html') + '?dev');
    await p.waitForFunction(() => window.DEV && window.QQDEV);
    if (n++ === 0) { // через меню
      await p.click('#btn-devjump');
      await p.fill('#devjump-q', sid);
      await p.click(`.dj-scene[data-id="${sid}"]`);
      if (out) await p.screenshot({ path: `${out}/dev-jump-goals.png` });
      await p.click(`.dj-goal[data-t="${tid}"]`);
    } else await p.evaluate(([s, t]) => window.QQDEV.jump(s, t), [sid, tid]);
    const waitScene = async () => { await p.waitForSelector('#scene:not([hidden])', { timeout: 20000 }); await p.click('#text').catch(() => {}); await p.waitForTimeout(250); };
    let ok = true;
    const tail = DEV.presets[sid][tid].tail;
    for (const [s, cid, death] of tail) {
      await waitScene();
      const m = await p.$eval('#meta', e => e.textContent);
      const bs = await p.$$('#choices button:not([disabled])');
      const ls = await p.$$eval('#choices button:not([disabled])', xs => xs.map(x => (x.querySelector('.lbl') || x).innerText.trim()));
      const sc = G.scenes[s];
      const want = cid ? sc.choices.find(c => c.id === cid).label.replace(/\*\*|\*/g, '').trim() : 'Дальше';
      const i = ls.findIndex(l => l === want);
      if (i < 0) { console.log(`  ${sid}→${tid}: на ${s} (${m}) нет «${want}». Есть: ${ls.join(' | ')}`); ok = false; break; }
      await bs[i].click(); await p.waitForTimeout(150);
      if (!death && await p.$('#death:not([hidden])')) { // Корень
        await p.waitForSelector('#btn-death-next:not([hidden])', { timeout: 30000 });
        await p.click('#btn-death-next'); await p.waitForTimeout(150);
      }
      if (death) {
        await p.waitForSelector('#btn-death-next:not([hidden])', { timeout: 30000 });
        await p.click('#btn-death-next'); await p.waitForTimeout(150);
        await p.click('#awake-text'); await p.waitForTimeout(150);
        await (await p.$$('#awake-btns button'))[0].click(); await p.waitForTimeout(150);
        continue;
      }
      if (await p.$('#text p.picked')) {
        await p.click('#text').catch(() => {}); await p.waitForTimeout(150);
        await p.waitForSelector('#choices button', { timeout: 10000 });
        await (await p.$$('#choices button'))[0].click(); await p.waitForTimeout(150);
      }
    }
    if (ok) {
      await waitScene();
      const m = await p.$eval('#meta', e => e.textContent);
      const here = await p.evaluate(() => JSON.parse(localStorage.getItem('qq_save_v1')).scene);
      ok = here === tid;
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${sid} → ${tid} «${G.scenes[tid].title}»: ${tail.length} шагов, конец ${here} (${m.trim()})`);
      if (out && n <= 2) await p.screenshot({ path: `${out}/dev-jump-end-${n}.png` });
    }
    if (errs.length) { console.log('  ОШИБКИ JS:', errs); ok = false; }
    if (!ok) fails++;
    await p.close();
  }
  await b.close();
  console.log(fails ? `провалено: ${fails} из ${pairs.length}` : `все ${pairs.length} прыжков доходят до цели`);
  process.exit(fails ? 1 : 0);
})();
