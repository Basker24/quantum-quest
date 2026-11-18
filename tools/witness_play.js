// Проигрывает каждый путь из GRAPH.guides в настоящем движке и проверяет, что он приводит к своему финалу.
// Запуск: node tools/witness_play.js [папка_скриншотов] [--multi]
//   чистый прогон (по умолчанию): localStorage чистится перед каждым маршрутом; условные маршруты
//   (gateDependent — путь опирается на мета-гейт kinds()/branches()) пропускаются с пометкой;
//   --multi (многожизненный): Журнал живёт в localStorage между жизнями — базовые маршруты играются
//   подряд и накапливают Журнал (стихии от смертей, ветви от посещённых сцен), условные маршруты
//   доказываются честной игрой в конце очереди; маршруты, чьи исходы решает мета-условие
//   (journalSensitive), в multi пропускаются — их путь рассчитан на чистую жизнь и доказан ей.
// Устойчивость: каждый маршрут в try/catch (падение одного не прерывает остальные), ретраи поиска
// варианта против анимации появления, force-клик по дрожащим кнопкам, разворачивание «Я помню… N»
// перед поиском; сводка ошибок JS в итоговой строке.
const { chromium } = require('playwright');
const path = require('path');
global.window = {};
require(path.resolve(__dirname, '../game/graph.js'));
const G = global.window.GRAPH;
const args = process.argv.slice(2);
const multi = args.includes('--multi');
const out = args.filter((a) => !a.startsWith('--'))[0];
const onlyArg = args.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice(7).split(',') : null;   // --only=Ф-04,Ф-13: только эти маршруты

(async () => {
  let ids = Object.keys(G.guides);
  if (only) ids = ids.filter((id) => only.includes(id));
  const base = ids.filter((id) => !G.guides[id].journalSensitive && !G.guides[id].gateDependent);
  const queue = multi
    ? [...base, ...ids.filter((id) => G.guides[id].journalSensitive || G.guides[id].gateDependent)]
    : ids;
  const b = await chromium.launch();
  // один контекст на весь прогон: в --multi Журнал (localStorage) должен переходить между жизнями;
  // b.newPage() создаёт новый контекст на каждую страницу — Журнал терялся, гейт Ф-04 не открывался
  const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
  let fails = 0, jsErrs = 0, passed = 0, skipped = 0;
  const first = queue[0];
  for (const fid of queue) {
    const g = G.guides[fid];
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    let ok = true;
    try {
      await p.goto('file://' + path.resolve(__dirname, '../game/index.html') + '?debug');
      if (!multi || fid === first) { await p.evaluate(() => localStorage.clear()); await p.reload(); }
      if (!multi && g.gateDependent) {
        skipped++;
        console.log(`SKIP ${fid} «${g.title}» — условный: путь опирается на мета-гейт (нужен накопленный Журнал); доказывается при --multi`);
        await p.close();
        continue;
      }
      if (multi && g.journalSensitive && !g.gateDependent) {
        skipped++;
        console.log(`SKIP ${fid} «${g.title}» — путь рассчитан на чистую жизнь (исход решает мета-условие); доказан чистым прогоном`);
        await p.close();
        continue;
      }
      await p.click('#btn-new');
      // при живом сохранении прошлой жизни (--multi) первый клик только «вооружает» кнопку — «Начать заново?»
      if (await p.$('#title:not([hidden])')) {
        await p.waitForTimeout(300);
        if (await p.$('#title:not([hidden])')) { await p.click('#btn-new', { force: true }).catch(() => {}); }
      }
      // при прожитых жизнях движок спрашивает, как прожить детство: разворачиваем «Детство одним листом»
      // (все детские развилки кнопками) и кликаем варианты пути — T-01..Т-09, их выборы ставят флаги F_Т01..Т-09
      let skipChildhoodSteps = false;   // шаги Т-00..Т-09 покрыты «Детством одним листом»
      const ch = await p.waitForSelector('#childhood:not([hidden])', { timeout: 5000 }).catch(() => null);
      if (ch) {
        const opened = await p.evaluate(() => {
          const btns = [...document.querySelectorAll('#childhood button:not([hidden])')];
          const b = btns.find((x) => ((x.querySelector('.lbl') || x).innerText || '').startsWith('Детство одним листом'));
          if (!b) return false;
          b.click();
          return true;
        });
        await p.waitForTimeout(600);
        const kids = g.steps.filter((s) => /^Т-0\d$/.test(s.scene || '') && s.choice);
        for (const s of kids) {
          const want = s.label.replace(/\*\*|\*/g, '').trim();
          const hit = await p.evaluate((w) => {
            const btns = [...document.querySelectorAll('#childhood button:not([hidden])')];
            const b = btns.find((x) => ((x.querySelector('.lbl') || x).innerText || '').replace(/\*\*|\*/g, '').trim() === w);
            if (!b) return false;
            b.click();
            return true;
          }, want);
          if (!hit) { console.log(`  ${fid}: в детстве-листе нет кнопки «${want}»`); ok = false; break; }
          await p.waitForTimeout(150);
        }
        if (ok) {
          await p.evaluate(() => {
            const btns = [...document.querySelectorAll('#childhood button:not([hidden])')];
            const b = btns.find((x) => ((x.querySelector('.lbl') || x).innerText || '').startsWith('К выпускному'));
            if (b) b.click();
          });
          await p.waitForTimeout(400);
          skipChildhoodSteps = true;
        }
      }
      const waitScene = async () => {
        await p.waitForSelector('#scene:not([hidden])', { timeout: 20000 });
        await p.click('#text').catch(() => {});
        await p.waitForTimeout(300);
        const fold = await p.$('.fold-btn.mem-fold');      // «Я помню… N»: развернуть свёрнутые воспоминания
        if (fold) { await fold.click({ force: true }).catch(() => {}); await p.waitForTimeout(150); }
      };
      for (const s of g.steps) {
        if (skipChildhoodSteps && /^Т-/.test(s.scene || '') && s.scene !== 'Т-10') continue;   // Т-00..Т-09 (+буквы) покрыты листом детства; Т-10 — обычная сцена
        await waitScene();
        const want = s.choice ? s.label.replace(/\*\*|\*/g, '').trim() : 'Дальше';
        let i = -1, bs = [];
        for (let t = 0; t < 6 && i < 0; t++) {              // ретраи: вариант может появиться после анимации
          bs = await p.$$('#choices button');
          const ls = await p.$$eval('#choices button', (xs) => xs.map((x) => (x.querySelector('.lbl') || x).innerText.trim()));
          i = ls.findIndex((l) => l === want);
          if (i < 0) { await p.click('#text').catch(() => {}); await p.waitForTimeout(300); }
        }
        if (i < 0) {
          const ls = await p.$$eval('#choices button', (xs) => xs.map((x) => (x.querySelector('.lbl') || x).innerText.trim()));
          console.log(`  ${fid}: на ${s.scene} нет варианта «${want}». Есть: ${ls.join(' | ')}`);
          ok = false;
          break;
        }
        await bs[i].click({ force: true }); await p.waitForTimeout(200);
        if (!s.death && await p.$('#death:not([hidden])')) { // Корень: смерть без отката
          await p.waitForSelector('#btn-death-next:not([hidden])', { timeout: 30000 });
          await p.click('#btn-death-next'); await p.waitForTimeout(200);
        }
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
        const m = await p.$eval('#meta', (e) => e.textContent);
        ok = m.includes(fid);
        console.log(`${ok ? 'OK  ' : 'FAIL'} ${fid} «${g.title}» — ${g.steps.length} шагов, конец: ${m.trim()}`);
        if (out) await p.screenshot({ path: `${out}/witness-${fid}.png` });
      }
    } catch (e) {
      ok = false;
      console.log(`FAIL ${fid} «${g.title}» — упал: ${String(e.message).slice(0, 200)}`);
    }
    if (errs.length) { jsErrs += errs.length; console.log('  ОШИБКИ JS:', errs); ok = false; }
    if (ok) passed++; else fails++;
    await p.close();
  }
  await b.close();
  console.log(`${multi ? 'многожизненный' : 'чистый'} прогон: ${passed}/${queue.length} маршрутов` +
    (skipped ? `, пропущено: ${skipped}` : '') + `, ошибок JS: ${jsErrs}` +
    (fails ? ` — провалено: ${fails}` : ' — все пути ведут куда надо'));
  process.exit(fails ? 1 : 0);
})();
