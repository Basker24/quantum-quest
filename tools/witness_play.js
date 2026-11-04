// Проигрывает каждый путь из GRAPH.guides в настоящем движке и проверяет, что он приводит к своему финалу.
// Запуск: node tools/witness_play.js [папка_скриншотов]
const { chromium } = require('playwright');
const path = require('path');
global.window = {};
require(path.resolve(__dirname, '../game/graph.js'));
const G = global.window.GRAPH;
(async () => {
  const out = process.argv[2];
  const b = await chromium.launch();
  let fails = 0;
  for (const [fid, g] of Object.entries(G.guides)) {
    const p = await b.newPage({ viewport: { width: 420, height: 900 } });
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + path.resolve(__dirname, '../game/index.html') + '?debug');
    await p.evaluate(() => localStorage.clear());
    await p.reload();
    await p.click('#btn-new');
    const waitScene = async () => { await p.waitForSelector('#scene:not([hidden])', { timeout: 20000 }); await p.click('#text').catch(() => {}); await p.waitForTimeout(300); };
    let ok = true;
    for (const s of g.steps) {
      await waitScene();
      const bs = await p.$$('#choices button');
      const ls = await p.$$eval('#choices button', xs => xs.map(x => (x.querySelector('.lbl') || x).innerText.trim()));
      const want = s.choice ? s.label.replace(/\*\*|\*/g, '').trim() : 'Дальше';
      const i = ls.findIndex(l => l === want);
      if (i < 0) { console.log(`  ${fid}: на ${s.scene} нет варианта «${want}». Есть: ${ls.join(' | ')}`); ok = false; break; }
      await bs[i].click(); await p.waitForTimeout(200);
      if (s.death) {
        await p.waitForSelector('#btn-death-next:not([hidden])', { timeout: 30000 });
        await p.click('#btn-death-next'); await p.waitForTimeout(200);
        await p.click('#awake-text'); await p.waitForTimeout(200);
        await (await p.$$('#awake-btns button'))[0].click(); await p.waitForTimeout(200);
        continue;
      }
      if (await p.$('#text p.picked')) {
        await p.click('#text').catch(() => {}); await p.waitForTimeout(200);
        await p.waitForSelector('#choices button', { timeout: 10000 });
        await (await p.$$('#choices button'))[0].click(); await p.waitForTimeout(200);
      }
    }
    if (ok) {
      await waitScene();
      const m = await p.$eval('#meta', e => e.textContent);
      ok = m.includes(fid);
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${fid} «${g.title}» — ${g.steps.length} шагов, конец: ${m.trim()}`);
      if (out) await p.screenshot({ path: `${out}/witness-${fid}.png` });
    }
    if (errs.length) { console.log('  ОШИБКИ JS:', errs); ok = false; }
    if (!ok) fails++;
    await p.close();
  }
  await b.close();
  console.log(fails ? `провалено: ${fails}` : 'все пути ведут куда надо');
  process.exit(fails ? 1 : 0);
})();
