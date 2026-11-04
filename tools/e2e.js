// Сквозной тест в браузере: ствол → В2 → капкан → шок → откат → опыт. Запуск: node tools/e2e.js [папка_для_скриншотов]
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2];
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 420, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + require('path').resolve(__dirname, '../game/index.html') + '?debug');
  const meta = () => p.$eval('#meta', e => e.textContent);
  const waitScene = async () => { await p.waitForSelector('#scene:not([hidden])', { timeout: 20000 }); await p.click('#text').catch(() => {}); await p.waitForTimeout(700); };
  const labels = () => p.$$eval('#choices button', bs => bs.map(x => (x.querySelector('.lbl') || x).innerText));
  let afters = 0, shots = 0;
  const pickText = async (re) => {
    await waitScene();
    const ls = await labels();
    const i = ls.findIndex(l => new RegExp(re).test(l));
    console.log((await meta()).padEnd(40), '→', i >= 0 ? ls[i].slice(0, 46) : '??? ' + ls.join(' | '));
    await (await p.$$('#choices button'))[Math.max(0, i)].click(); await p.waitForTimeout(300);
    // экран «После»: на той же сцене остаётся одна кнопка «Дальше»
    if (!(await p.$('#scene[hidden]')) && (await p.$('#text p.picked'))) {
      {
        afters++;
        await p.click('#text').catch(() => {}); await p.waitForTimeout(400);
        await p.waitForSelector('#choices button', { timeout: 10000 });
        if (out && shots++ === 2) await p.screenshot({ path: out + '/v4-after.png', fullPage: true });
        await (await p.$$('#choices button'))[0].click(); await p.waitForTimeout(300);
      }
    }
  };
  const die = async (tag) => {
    await p.waitForSelector('#btn-death-next:not([hidden])', { timeout: 30000 });
    if (out) await p.screenshot({ path: `${out}/v4-death-${tag}.png`, fullPage: true });
    await p.click('#btn-death-next'); await p.waitForTimeout(300);
    await p.click('#awake-text').catch(() => {}); await p.waitForTimeout(400);
    if (out) await p.screenshot({ path: `${out}/v4-awake-${tag}.png`, fullPage: true });
    console.log('   шок:', (await p.$$eval('#awake-btns button', bs => bs.map(x => x.innerText))).join(' | '));
    await (await p.$$('#awake-btns button'))[0].click(); await p.waitForTimeout(300);
  };
  await p.click('#btn-new');
  for (const re of ['Дальше', 'блестит', 'шепчут', 'Дальше', 'Вмазать', 'рельсы', 'Читать', 'Переплыть', 'Сесть и ехать', 'баллоны', 'Проводить', 'физфак', 'Ходить ночами|Зубрить', 'Разжать'])
    await pickText(re);
  await die('lift');
  for (const re of ['Я знаю', 'Пешком']) await pickText(re);
  if (await p.$('#death:not([hidden])')) { await die('garden'); await pickText('такси'); }
  for (const re of ['Докажите', 'гуляем', 'Отказать', 'Согласиться$|Согласиться', 'Рвануться']) await pickText(re);
  await waitScene();
  console.log('финал:', await meta(), '| экранов «После»:', afters);
  console.log('ОШИБКИ JS:', errs.length ? errs : 'нет');
  await b.close();
})();
