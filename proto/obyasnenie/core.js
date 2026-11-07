/* «Объяснение» — движок и ночь 1 «Три жизни». Чистая логика без DOM: G.fresh(), G.list(S), G.moves(S), G.apply(S, id). */
(function (root) {
  const T0 = 60, DAWN = 300;
  const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

  // ---------- места (координаты — на карте 1536×1024)
  const LOC = {
    dvor:    { n: 'Двор',            x: 305, y: 235, bank: 'W' },
    misha:   { n: 'Дом Миши',        x: 420, y: 168, bank: 'W' },
    roof:    { n: 'Крыша дома Миши', x: 548, y: 88,  bank: 'W' },
    rynok:   { n: 'Рынок',           x: 410, y: 535, bank: 'W' },
    grp:     { n: 'Газовый пункт',   x: 130, y: 470, bank: 'W' },
    stroika: { n: 'Стройка',         x: 218, y: 795, bank: 'W' },
    most:    { n: 'Мост',            x: 785, y: 343, bank: 'R' },
    shluz:   { n: 'Шлюз',            x: 785, y: 838, bank: 'R' },
    bolnica: { n: 'Больница',        x: 1085, y: 185, bank: 'E' },
    mchs:    { n: 'База МЧС',        x: 1365, y: 125, bank: 'E' },
    avto:    { n: 'Автосервис',      x: 1128, y: 625, bank: 'E' },
    podst:   { n: 'Подстанция',      x: 1395, y: 725, bank: 'E' }
  };
  const EDGES = [
    ['dvor', 'misha', 5], ['misha', 'roof', 5], ['dvor', 'rynok', 5], ['dvor', 'grp', 10], ['rynok', 'grp', 5],
    ['rynok', 'stroika', 5], ['grp', 'stroika', 10], ['misha', 'most', 5], ['rynok', 'most', 10], ['stroika', 'shluz', 5],
    ['most', 'bolnica', 5, 'bridge'], ['bolnica', 'mchs', 5], ['bolnica', 'avto', 5], ['avto', 'podst', 5],
    ['mchs', 'podst', 10], ['shluz', 'podst', 10]
  ];

  // ---------- правки мира
  const EDITS = {
    mchsMisha: { t: 'Соседи вызвали МЧС на запах газа', c: 2, s: 'Машина МЧС стоит у дома Миши. Спасатели вскрыли дверь и вынесли Мишу на воздух. Они не спят и готовы ехать дальше.' },
    awning:    { t: 'Над подъездом новый брезентовый навес', c: 1, s: 'Его повесили вчера. Больше он ни на что не влияет.' },
    gasOff:    { t: 'Газ в квартале перекрыт на проверку', c: 1, s: 'Утечка у Миши остановлена. Но генератор больницы работает на газе и без него не заведётся.' },
    gasman:    { t: 'Дежурный газовик не спит', c: 1, s: 'Он может перекрыть газ в одном доме, не трогая весь квартал.' },
    pump:      { t: 'Сторож стройки включил насос', c: 1, s: 'Вода из котлована уходит. Через полчаса Даня будет стоять по щиколотку.' },
    lock:      { t: 'Шлюз сбросил воду, мост заклинило', c: 1, s: 'Река упала, старый коллектор больше не заливает котлован: через полчаса вода уйдёт. Разводной пролёт моста поднят и заклинен: ни машине, ни пешком. Через реку теперь только по мостику шлюза.' },
    crew:      { t: 'Ремонтников завернули на другую аварию', c: 2, s: 'Плановое отключение подстанции в 03:00 отменено. Больница останется при свете.' },
    subEarly:  { t: 'Ремонт подстанции начали раньше', c: 1, s: 'Восточный берег без света с этой минуты, а не с трёх. Лизе нужно электричество не позже чем через двадцать минут.' },
    mchsAvto:  { t: 'Машина МЧС стоит у автосервиса', c: 1, s: 'Бригада возвращалась с ложного вызова и не спит. Ей можно поручить одно дело, потом другое.' },
    loaders:   { t: 'На рынке встали холодильники', c: 1, s: 'Грузчиков подняли среди ночи спасать товар. Их можно позвать на помощь.' },
    heart:     { t: 'Ты с детства занимаешься плаванием', c: 3, s: 'Это правка тебя, а не мира. Ты сильнее, чем был, и вытащишь человека верёвкой один. Но Лиза помнит другого брата.' }
  };

  function fresh() {
    return {
      t: T0, loc: 'dvor', inv: { rope: false, lom: false }, edits: [], N: 0, deaths: 0, log: [], ev: [], clue: null,
      gas: true, riser: false, jam: false, crew: false, subEarly: false,
      truck: { awake: false, loc: 'mchs', busy: 0, gen: false, pit: false },
      gosha: 'sleep', genReady: null, loaders: false, loadersAtPit: false, gasman: false, heart: false, drainAt: null,
      misha: { st: 'danger', at: null }, liza: { st: 'danger', at: null, unp: 0 }, danya: { st: 'danger', at: null },
      seenN: {}, wit: [], over: false
    };
  }
  const has = (S, e) => S.edits.includes(e);
  const log = (S, txt, cls) => S.log.unshift({ t: S.t, txt, cls: cls || '' });

  // ---------- ходьба
  function edgeOk(S, e) { return !(e[3] === 'bridge' && S.jam); }
  function dist(S, from) {
    const D = {}; for (const k in LOC) D[k] = Infinity; D[from] = 0;
    const Q = new Set(Object.keys(LOC));
    while (Q.size) {
      let u = null; for (const k of Q) if (u === null || D[k] < D[u]) u = k;
      Q.delete(u); if (D[u] === Infinity) break;
      for (const e of EDGES) if (edgeOk(S, e)) {
        const v = e[0] === u ? e[1] : e[1] === u ? e[0] : null;
        if (v && D[u] + e[2] < D[v]) D[v] = D[u] + e[2];
      }
    }
    return D;
  }
  function vehicle(S, from, to) { // машина ездит только по дорогам: через реку — по мосту
    const a = LOC[from].bank, b = LOC[to].bank;
    if (from === to) return 0;
    if (a === b) return 10;
    return S.jam ? null : 15;
  }

  // ---------- угрозы
  function gridOn(S, t) { if (t >= DAWN) return true; if (S.subEarly) return false; return !(t >= 180 && !S.crew); }
  function powered(S, t) { return gridOn(S, t) || (S.genReady !== null && t >= S.genReady && S.gas) || S.truck.gen; }
  function lizaSafe(S) { return S.liza.st === 'saved' || (S.liza.st === 'danger' && ((S.crew && !S.subEarly) || S.truck.gen)); }
  function save(S, who, why) {
    const p = S[who]; if (p.st !== 'danger') return;
    p.st = 'saved'; p.at = S.t;
    const N = { misha: 'Миша', liza: 'Лиза', danya: 'Даня' }[who];
    log(S, N + ' спасён' + (who === 'liza' ? 'а' : '') + ': ' + why, 'g');
  }
  function checkNow(S) {
    if (S.misha.st === 'danger' && (!S.gas || S.riser)) save(S, 'misha', 'утечку остановили, к утру он проспится.');
  }
  function step(S) {
    const prev = S.t; S.t += 5; const t = S.t;
    // события по времени
    S.ev.sort((a, b) => a.at - b.at);
    while (S.ev.length && S.ev[0].at <= t) {
      const e = S.ev.shift(); const keep = S.t; S.t = e.at;
      if (e.type === 'gen') { S.gosha = 'stay'; log(S, 'Гоша запустил генератор в больнице.' + (S.gas ? '' : ' Но газа нет, и он не заводится.'), S.gas ? 'g' : 'x'); }
      if (e.type === 'mchsGen') { S.truck.gen = true; log(S, 'МЧС подключили передвижной генератор к больнице.', 'g'); }
      if (e.type === 'pitRescue') { if (S.danya.st === 'danger') save(S, 'danya', 'спасатели подняли его лестницей.'); }
      if (e.type === 'door') { if (S.misha.st === 'danger') save(S, 'misha', 'ты выломал дверь, открыл окна и вытащил его на лестницу.'); }
      if (e.type === 'riser') { S.riser = true; }
      if (e.type === 'pull') { if (S.danya.st === 'danger') save(S, 'danya', 'вытащили верёвкой.'); }
      if (e.type === 'drain') { if (S.danya.st === 'danger') save(S, 'danya', 'вода ушла, он стоит по щиколотку в глине, и его вытаскивают.'); }
      S.t = keep;
    }
    checkNow(S);
    if (S.misha.st === 'danger' && t >= 165) { S.misha.st = 'dead'; S.misha.at = 165; log(S, '02:45. Миша не проснулся. Газ.', 'x'); }
    if (S.liza.st === 'danger') {
      if (!powered(S, prev)) { S.liza.unp += 5; if (S.liza.unp >= 25) { S.liza.st = 'dead'; S.liza.at = t; log(S, hm(t) + '. В реанимации нет света больше двадцати минут. Лизы больше нет.', 'x'); } }
      else S.liza.unp = 0;
      if (S.liza.st === 'danger' && t >= DAWN) save(S, 'liza', 'подстанцию включили, ночь кончилась.');
    }
    if (S.danya.st === 'danger' && t >= 210) { S.danya.st = 'dead'; S.danya.at = 210; log(S, '03:30. Вода в котловане дошла Дане до подбородка, а потом выше.', 'x'); }
    const th = [[4, 'Совпадения: прохожий повторяет твою фразу слово в слово, на всех часах одни и те же минуты.'], [7, 'Люди помнят иначе: медсестра называет Лизу Елизаветой Олеговной. Ты помнишь отчество другим.'], [10, 'Ты больше не узнаёшь этот квартал. Это уже не твой мир.']];
    for (const [k, txt] of th) if (S.N >= k && !S.seenN[k]) { S.seenN[k] = 1; log(S, txt, 'a'); }
    if (t >= DAWN) S.over = true;
    if (S.misha.st !== 'danger' && S.danya.st !== 'danger' && (S.liza.st !== 'danger' || lizaSafe(S))) S.over = true;
  }
  function advance(S, min) { for (let i = 0; i < min; i += 5) { if (S.over) break; step(S); } }

  function addEdit(S, e) {
    if (has(S, e)) return;
    S.edits.push(e); S.N += EDITS[e].c;
    const T = S.truck;
    switch (e) {
      case 'mchsMisha': T.awake = true; T.loc = 'misha'; T.busy = S.t; S.wit.push('соседи и спасатели'); save(S, 'misha', 'спасатели вынесли его на воздух.'); break;
      case 'gasOff': S.gas = false; break;
      case 'gasman': S.gasman = true; S.wit.push('газовик'); break;
      case 'pump': S.drainAt = S.t + 30; S.ev.push({ at: S.t + 30, type: 'drain' }); S.wit.push('сторож стройки'); break;
      case 'lock': S.jam = true; if (S.drainAt === null || S.t + 30 < S.drainAt) { S.drainAt = S.t + 30; S.ev.push({ at: S.t + 30, type: 'drain' }); } S.wit.push('шлюзовщик'); break;
      case 'crew': S.crew = true; S.wit.push('водитель ремонтников'); break;
      case 'subEarly': S.subEarly = true; break;
      case 'mchsAvto': T.awake = true; T.loc = 'avto'; T.busy = S.t; S.wit.push('спасатели'); break;
      case 'loaders': S.loaders = true; S.wit.push('грузчики'); break;
      case 'heart': S.heart = true; break;
    }
    checkNow(S);
  }

  // ---------- смерти: место, условие, объяснение
  const DEATHS = {
    roof: { where: 'roof', lbl: 'Шагнуть с крыши',
      die: 'Пять этажей ветра. Асфальт приходит быстрее мысли.',
      res(S) {
        if (!S.truck.awake && S.gas && !S.riser && S.misha.st === 'danger')
          return { why: 'внизу как раз разворачивалась машина МЧС и спасатели растянули тент: соседи всё-таки дозвонились про газ.', e: 'mchsMisha' };
        return { why: 'я упал на брезентовый навес над подъездом. Его повесили только вчера.', e: has(S, 'awning') ? null : 'awning' };
      } },
    lighter: { where: 'misha', lbl: 'Чиркнуть зажигалкой на лестнице, где пахнет газом',
      off: S => S.gas ? null : 'Газа нет: квартал перекрыт. Пахнуть нечему.',
      die: 'Хлопок, жар в лицо, лестничный пролёт летит навстречу.',
      res() { return { why: 'взрыва не было. Газ в квартале перекрыли на проверку ещё в полночь, а на лестнице пахло остатками в трубе.', e: 'gasOff' }; } },
    grp: { where: 'grp', lbl: 'Перелезть ограду и надышаться у сбросного клапана',
      off: S => S.gasman ? 'Газовик уже не спит и смотрит на тебя волком.' : null,
      die: 'Сладковатый запах, звон в ушах, земля встаёт дыбом.',
      res() { return { why: 'дежурный газовик как раз вышел покурить, увидел меня у клапана и выволок за ограду.', e: 'gasman' }; } },
    pit: { where: 'stroika', lbl: 'Прыгнуть в котлован к Дане',
      off: S => S.danya.st !== 'danger' ? 'Дани в котловане больше нет.' : S.drainAt !== null ? 'Вода и так уходит.' : null,
      die: 'Ледяная глиняная вода по горло, ноги вязнут, руки соскальзывают со стенки.',
      res() { return { why: 'сторож проснулся от всплеска, выругался и включил насос. Вода пошла вниз, и я встал на дно.', e: 'pump' }; } },
    lock: { where: 'shluz', lbl: 'Прыгнуть в шлюзовую камеру',
      off: S => S.jam ? 'В камере по колено. Так не умереть.' : null,
      die: 'Бетонная стена, чёрная вода, течение тащит к затвору.',
      res() { return { why: 'за минуту до этого шлюзовщик сбросил воду. В камере было по колено, а разводной мост от перепада заклинило.', e: 'lock' }; } },
    crew: { where: 'most', lbl: 'Шагнуть под машину ремонтников',
      off: S => S.crew ? 'Ремонтников уже завернули.' : S.t < 150 ? 'Машин на мосту нет. Ремонтники поедут к подстанции около половины третьего.' : S.t >= 180 ? 'Ремонтники уже проехали к подстанции.' : null,
      die: 'Фары в упор, визг тормозов, бампер.',
      res() { return { why: 'водитель уже тормозил: его по рации завернули на другую аварию, и он разворачивался прямо на мосту.', e: 'crew' }; } },
    sub: { where: 'podst', lbl: 'Схватиться за шину под напряжением',
      off: S => !gridOn(S, S.t) ? 'Шина мёртвая: подстанция обесточена.' : null,
      die: 'Белая вспышка. Тело выгибается дугой.',
      res() { return { why: 'шину только что обесточили: ремонтники начали раньше срока.', e: 'subEarly' }; } },
    poison: { where: 'avto', lbl: 'Выпить из бутылки без этикетки',
      die: 'Сладкое, потом жжёт. Горло сжимается, верстак уплывает вбок.',
      res(S) { return S.truck.awake ? { why: 'спасатели снова откачали меня, уже ругаясь.', e: null } : { why: 'у ворот как раз стояла машина МЧС: бригада возвращалась с ложного вызова. Меня откачали за четыре минуты.', e: 'mchsAvto' }; } },
    freeze: { where: 'rynok', lbl: 'Зайти в холодильную камеру и закрыть дверь',
      off: S => S.loaders ? 'Камера не работает. В ней не холоднее, чем на улице.' : null,
      die: 'Минус двадцать восемь. Пальцы перестают слушаться, потом становится тепло и сонно.',
      res() { return { why: 'камера встала: ночью на рынке выбило холодильники, и грузчики уже открывали двери, спасать товар.', e: 'loaders' }; } },
    heart: { where: 'dvor', lbl: 'Бежать вокруг квартала, пока сердце не встанет',
      off: S => S.heart ? 'Сердце пловца выдерживает. Ты просто устал.' : null,
      die: 'Третий круг. Грудь сжимает обручем, левая рука немеет, двор кренится.',
      res() { return { why: 'моё сердце крепче, чем было. В этом мире я с семи лет хожу в бассейн. Я этого не помню.', e: 'heart' }; } }
  };

  // ---------- описания мест
  function descr(S) {
    const T = S.truck;
    const d = {
      dvor: 'Двор твоей хрущёвки. На лавке плачет соседка Вера: её семилетний Даня ушёл из дома и не вернулся.',
      misha: 'Пятиэтажка Миши. На лестнице пахнет газом. Миша после двух смен заперся на щеколду и спит, телефон не берёт.' + (S.misha.st === 'saved' ? ' Миша сидит на лавке у подъезда и кашляет.' : S.misha.st === 'dead' ? ' У подъезда стоит скорая с выключенной мигалкой.' : ''),
      roof: 'Крыша дома Миши. Отсюда видно весь квартал: стройку, реку, больницу на том берегу.',
      rynok: 'Крытый рынок. Сторож курит у ворот.' + (S.loaders ? ' Грузчики таскают ящики из встававших камер.' : ''),
      grp: 'Газорегуляторный пункт за забором. В будке спит дежурный газовик.' + (S.gasman ? ' Газовик не спит и смотрит на тебя волком.' : ''),
      stroika: 'Стройка. В котловане четыре метра глубины, вода по грудь семилетнему Дане и прибывает. Он держится за арматуру и молчит.' + (S.drainAt !== null && S.danya.st === 'danger' ? ' Насос гудит, вода уходит.' : '') + (S.danya.st === 'saved' ? ' Даню завернули в куртку, он сидит у вагончика.' : S.danya.st === 'dead' ? ' Вода стоит ровно до краёв.' : ''),
      most: 'Разводной мост.' + (S.jam ? ' Пролёт поднят и заклинен.' : ' Ночью по нему почти никто не ездит.'),
      shluz: 'Шлюз. По мостику над затворами можно перейти на тот берег пешком.',
      bolnica: 'Больница. Лиза в реанимации на ИВЛ.' + (S.gosha === 'work' ? ' Гоша возится с генератором в подвале.' : S.gosha === 'stay' ? ' Генератор в подвале гудит, Гоша сидит при нём.' : '') + (T.gen ? ' Во дворе гудит генератор МЧС.' : ''),
      mchs: 'База МЧС.' + (T.awake && T.loc === 'mchs' ? ' Машина у ворот, бригада ждёт.' : T.awake ? ' Машина на выезде.' : ' Ворота закрыты, дежурный дремлет за стеклом.'),
      avto: 'Автосервис.' + (S.gosha === 'sleep' ? ' Механик Гоша спит в бытовке.' : '') + ' На верстаке бутылка без этикетки.',
      podst: 'Подстанция «Восточная». Гудят трансформаторы. На воротах объявление о ремонте.'
    };
    let x = d[S.loc];
    if (T.awake && T.loc === S.loc && S.loc !== 'mchs') x += ' Здесь стоит машина МЧС' + (S.t < T.busy ? ', бригада занята.' : ', бригада ждёт.');
    return x;
  }

  // ---------- действия на месте
  function list(S) {
    const A = [], L = S.loc, T = S.truck;
    const act = (id, lbl, min, off) => A.push({ id, lbl, min, kind: 'act', off: off || null });
    const clue = (id, lbl, txt) => A.push({ id, lbl, min: 5, kind: 'clue', txt });
    const death = k => { const d = DEATHS[k]; A.push({ id: 'die:' + k, lbl: d.lbl, min: 15, kind: 'die', off: d.off ? d.off(S) : null }); };
    const goshaHere = S.gosha === 'follow';
    switch (L) {
      case 'dvor':
        clue('c:vera', 'Поговорить с Верой', '«Даню видели у стройки, он туда за котёнком лазил. Я сама туда не дойду, ноги не держат. Андрей, найди его!»');
        death('heart'); break;
      case 'misha':
        clue('c:door', 'Позвонить в дверь', 'Тишина. Из-под двери тянет газом. Дверь железная, щеколда изнутри. Соседка с третьего этажа говорит, что звонила в газовую, а там только автоответчик.');
        act('lom-door', 'Выломать дверь ломом', 20, S.misha.st !== 'danger' ? 'Мише дверь уже не нужна.' : !S.inv.lom ? 'Дверь железная, Миша заперт на щеколду. Плечом не взять, нужен лом.' : null);
        death('lighter'); break;
      case 'roof':
        clue('c:roof', 'Осмотреть квартал сверху', 'Внизу у подъезда соседи в халатах нюхают воздух и спорят, кому звонить. На стройке в котловане блестит вода. За рекой тёмная подстанция и белая больница. Через мост к подстанции ведёт единственная дорога.');
        death('roof'); break;
      case 'rynok':
        act('rope', 'Взять верёвку у сторожа рынка', 5, S.inv.rope ? 'Верёвка уже у тебя.' : null);
        if (S.loaders && !S.loadersAtPit) act('loaders-go', 'Позвать грузчиков к котловану', 5, S.danya.st !== 'danger' ? 'Дане помощь уже не нужна.' : null);
        else if (!S.loaders) clue('c:rynok', 'Поговорить со сторожем', '«Грузчики? Они приходят к шести. Если камеры встанут, поднимут раньше, а так спят все».');
        death('freeze'); break;
      case 'grp':
        clue('c:grp', 'Постучать в будку газовика', 'Будка заперта изнутри. Газовик спит в наушниках, стучишь пять минут — тишина. Без него газ не перекрыть: задвижки под пломбой.');
        if (S.gasman) act('riser', 'Попросить газовика перекрыть газ в доме Миши', 10, S.riser ? 'Стояк уже перекрыт.' : !S.gas ? 'Газ и так перекрыт во всём квартале.' : null);
        death('grp'); break;
      case 'stroika':
        clue('c:pit', 'Осмотреть котлован', 'Стенки глиняные и скользкие, четыре метра. Вода идёт из старого коллектора от реки и прибывает. По тому, как она поднимается, Дане осталось до половины четвёртого. Сторож пьян и спит в вагончике, его не добудиться.');
        act('lom', 'Взять лом у вагончика', 5, S.inv.lom ? 'Лом уже у тебя.' : null);
        {
          const helper = goshaHere ? 'с Гошей' : S.loadersAtPit ? 'с грузчиками' : S.heart ? 'одному' : null;
          act('pull', 'Вытащить Даню верёвкой' + (helper ? ' ' + helper : ''), 15,
            S.danya.st !== 'danger' ? 'Дане помощь уже не нужна.' : !S.inv.rope ? 'Нужна верёвка. Сторож рынка даст.' : !helper ? 'Один ты его не вытянешь: глина скользкая, в нём мокрых двадцать пять кило, а держать надо сверху вдвоём.' : null);
        }
        death('pit'); break;
      case 'most':
        clue('c:most', 'Постоять на мосту', 'Ночью тут пусто. Ремонтная бригада на подстанцию поедет из города через этот мост, примерно с половины третьего до трёх.');
        death('crew'); break;
      case 'shluz':
        clue('c:shluz', 'Поговорить со шлюзовщиком', '«Сбросить воду? Только по команде диспетчера. А если сброшу, мост заклинит: пролёт разводной, его гидравлика от уровня зависит. Было уже такое».');
        death('lock'); break;
      case 'bolnica':
        clue('c:nurse', 'Спросить медсестру про Лизу', '«В три часа подстанцию отключают на плановый ремонт. Генератор у нас газовый и не заводится с весны, механик Гоша из автосервиса обещал посмотреть. Без света аппарат протянет минут двадцать. Я звонила в МЧС: генератор дают только при ЧС, а ЧС начнётся в три».');
        act('gen', 'Попросить Гошу починить генератор', 45,
          S.genReady !== null ? 'Генератором уже занимались.' : !goshaHere ? 'Чинить некому. Механик Гоша спит в бытовке автосервиса.' : !S.gas ? 'Генератор газовый, а газ в квартале перекрыт. Не заведётся.' : null);
        break;
      case 'mchs':
        clue('c:mchs', 'Разбудить дежурного', T.awake ? 'Дежурный: «Машина на выезде, ищи её».' : 'Дежурный не открывает: «Без вызова диспетчера не выезжаем. Звоните 112». Телефон у тебя сел ещё вечером.');
        break;
      case 'avto':
        act('gosha', 'Разбудить механика Гошу', 5, S.gosha !== 'sleep' ? 'Гоша уже не спит.' : null);
        death('poison'); break;
      case 'podst':
        clue('c:podst', 'Прочитать объявление', '«Плановое отключение 03:00–05:00. Ремонтная бригада горсетей». Ворота заперты, но решётка у кабельного канала отогнута.');
        death('sub'); break;
    }
    // машина МЧС рядом
    if (T.awake && T.loc === L) {
      const idle = S.t >= T.busy;
      if (!T.gen && !T.genOrdered) { const tt = vehicle(S, L, 'bolnica'); act('mchs-gen', 'Попросить МЧС отвезти генератор в больницу', 5, !idle ? 'Бригада занята.' : tt === null ? 'Мост заклинило: машине на тот берег не проехать.' : null); }
      if (!T.pit && S.danya.st === 'danger') { const tt = vehicle(S, L, 'stroika'); act('mchs-pit', 'Попросить МЧС к котловану: там ребёнок', 5, !idle ? 'Бригада занята.' : tt === null ? 'Мост заклинило: машине на тот берег не проехать.' : null); }
    }
    act('wait', 'Ждать 15 минут', 15, null);
    act('dawn', 'Ждать до утра', 0, null);
    return A;
  }
  function moves(S) { const D = dist(S, S.loc); return Object.keys(LOC).filter(k => k !== S.loc && D[k] < Infinity).map(k => ({ to: k, min: D[k] })); }

  // ---------- применить действие
  function apply(S, id) {
    if (S.over) return null;
    S.clue = null;
    if (id.startsWith('go:')) {
      const to = id.slice(3), D = dist(S, S.loc);
      if (D[to] === Infinity) return null;
      S.loc = to; advance(S, D[to]); return { kind: 'go' };
    }
    const a = list(S).find(x => x.id === id);
    if (!a || a.off) return null;
    if (a.kind === 'clue') { S.clue = a.txt; advance(S, 5); return { kind: 'clue' }; }
    if (a.kind === 'die') {
      const k = id.slice(4), d = DEATHS[k], r = d.res(S);
      S.deaths++; const at = S.t;
      log(S, '✝ ' + d.lbl + '.', 'x');
      if (r.e) { addEdit(S, r.e); log(S, 'Правка: ' + EDITS[r.e].t + '. Н +' + EDITS[r.e].c, 'a'); }
      else log(S, 'Объяснение уже было в мире. Правки нет.', 'g');
      advance(S, 15);
      return { kind: 'die', d, r, at };
    }
    const T = S.truck;
    switch (id) {
      case 'lom-door': S.ev.push({ at: S.t + 20, type: 'door' }); advance(S, 20); return { kind: 'act' };
      case 'rope': S.inv.rope = true; log(S, 'Сторож рынка отдал моток верёвки.'); break;
      case 'lom': S.inv.lom = true; log(S, 'Лом у тебя.'); break;
      case 'loaders-go': S.loadersAtPit = true; log(S, 'Грузчики пошли к стройке.', 'g'); break;
      case 'riser': S.ev.push({ at: S.t + 10, type: 'riser' }); advance(S, 10); return { kind: 'act' };
      case 'pull': S.ev.push({ at: S.t + 15, type: 'pull' }); advance(S, 15); return { kind: 'act' };
      case 'gosha': S.gosha = 'follow'; log(S, 'Гоша проснулся и пошёл с тобой, ругаясь.'); break;
      case 'gen': S.gosha = 'work'; S.genReady = S.t + 45; S.ev.push({ at: S.t + 45, type: 'gen' }); log(S, 'Гоша полез в подвал к генератору: «Минут сорок пять. И я при нём останусь, он капризный».'); advance(S, 5); return { kind: 'act' };
      case 'mchs-gen': { const tt = vehicle(S, S.loc, 'bolnica'); T.loc = 'bolnica'; T.busy = S.t + tt + 15; T.gen = false; S.ev.push({ at: S.t + tt + 10, type: 'mchsGen' }); T.genOrdered = true; log(S, 'МЧС поехали за генератором в больницу.'); break; }
      case 'mchs-pit': { const tt = vehicle(S, S.loc, 'stroika'); T.loc = 'stroika'; T.pit = true; T.busy = S.t + tt + 10; S.ev.push({ at: S.t + tt + 10, type: 'pitRescue' }); log(S, 'МЧС поехали к котловану.'); break; }
      case 'wait': advance(S, 15); return { kind: 'act' };
      case 'dawn': advance(S, DAWN - S.t); return { kind: 'act' };
    }
    advance(S, a.min);
    return { kind: 'act' };
  }

  root.G = { T0, DAWN, LOC, EDGES, EDITS, DEATHS, fresh, list, moves, apply, descr, dist, hm, powered, gridOn, lizaSafe, vehicle };
})(typeof window !== 'undefined' ? window : globalThis);
