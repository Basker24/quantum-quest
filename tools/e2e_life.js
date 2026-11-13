// Полная жизнь в браузере: 1996 → В2 → В2.2 «Отказ» → якорь → финал. Запуск: node tools/e2e_life.js [папка_скриншотов] [финал: river|dive]
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2];
  const mode = process.argv[3] || 'dive';
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 420, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + require('path').resolve(__dirname, '../game/index.html') + '?debug');
  const meta = () => p.$eval('#meta', e => e.textContent);
  const waitScene = async () => { await p.waitForSelector('#scene:not([hidden])', { timeout: 20000 }); await p.click('#text').catch(() => {}); await p.waitForTimeout(500); };
  const labels = () => p.$$eval('#choices button', bs => bs.map(x => (x.querySelector('.lbl') || x).innerText));
  const pick = async (re) => {
    await waitScene();
    const ls = await labels();
    let i = ls.findIndex(l => new RegExp(re).test(l));
    if (i < 0) i = 0;
    console.log((await meta()).padEnd(40), '→', (ls[i] || '').slice(0, 50));
    await (await p.$$('#choices button'))[i].click(); await p.waitForTimeout(250);
    if (await p.$('#death:not([hidden])')) {
      await p.waitForSelector('#btn-death-next:not([hidden])', { timeout: 30000 });
      await p.click('#btn-death-next'); await p.waitForTimeout(300);
      if (!(await p.$('#awake:not([hidden])'))) { console.log('   ✝ Корень'); return; }
      await p.click('#awake-text'); await p.waitForTimeout(300);
      await (await p.$$('#awake-btns button'))[0].click(); await p.waitForTimeout(300);
      console.log('   ✝ смерть и откат');
      return;
    }
    if (!(await p.$('#scene[hidden]')) && (await p.$('#text p.picked'))) {
      await p.click('#text').catch(() => {}); await p.waitForTimeout(300);
      await p.waitForSelector('#choices button', { timeout: 10000 });
      await (await p.$$('#choices button'))[0].click(); await p.waitForTimeout(250);
    }
  };
  await p.click('#btn-new');
  const path = ['Дальше', 'Бубликом', 'Слушать', 'Дальше', 'Водяной', 'олимпиаду', 'Читать', 'Отвести Нику', 'Рассказать Витьке|Сесть', 'Дома', 'Уехать с Никой',
    'физфак', 'Ходить ночами|Зубрить', 'Жать кнопку', 'Я знаю', 'такси', 'Это вы стояли|Учите', 'Рассказать ей', 'врачу', 'Отказаться',
    'Вскрыть', 'Приезжай|Ответить', 'Дочитать', 'левее|Бежать', 'Поехать на море|Рассказать ей|юбилей', 'Вдвоём|По-честному', 'Позвонить его отцу', 'журналистам', 'Учить её', 'Слушать Хор|Позвонить Шадрину', 'Взять с собой ту'];
  for (const re of path) await pick(re);
  await waitScene();
  if (out) await p.screenshot({ path: out + '/life-anchor.png', fullPage: true });
  if (mode === 'river') await pick('Не нырять');
  else { await pick('держась'); await pick('Считать|Ты чей'); await pick('Вернуться|Открыть|Остаться здесь|Не возвращаться'); }
  await waitScene();
  console.log('ФИНАЛ:', await meta(), '|', await p.$eval('#photo figcaption', e => e.textContent).catch(() => ''));
  if (out) await p.screenshot({ path: out + '/life-final-' + mode + '.png', fullPage: true });
  console.log('debug:', await p.$eval('#debug', d => d.textContent).catch(() => '-'));
  console.log('ОШИБКИ JS:', errs.length ? errs : 'нет');
  await b.close();
})();
