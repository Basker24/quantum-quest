/* «Объяснение» — дополнение к «Тот, кто остался». Движок и ночь 1 «Три жизни». Чистая логика без DOM.
   API: G.fresh(), G.list(S), G.moves(S), G.apply(S, id) → {kind, ...}, G.path(S, from, to), G.descr(S), G.danyaPhase(S). */
(function (root) {
  const T0 = 60, DAWN = 300, CREW_FROM = 135, MISHA_DL = 165, DANYA_DL = 220; // ремонтники на мосту с 02:15 до 03:00
  const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

  // ---------- места (координаты на карте 1536×1024)
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

  // ---------- что меняется в мире, где ты остался жить
  const EDITS = {
    mchsMisha: { t: 'Соседи вызвали МЧС из-за газа', c: 2, s: 'Машина МЧС стоит у дома Миши. Спасатели вскрыли дверь и вынесли Мишу. Бригада свободна, её можно о чём-нибудь попросить.' },
    awning:    { t: 'На крыше оборван антенный кабель', c: 1, s: 'Ты зацепился за него и упал в кусты. На остальное это не влияет.' },
    gasOff:    { t: 'Газ в квартале перекрыт', c: 1, s: 'В квартиру Миши газ больше не идёт. Генератор в больнице тоже работает на газе, и теперь он не запустится.' },
    gasman:    { t: 'Газовик не спит', c: 1, s: 'Его можно попросить перекрыть газ в одном доме. Весь квартал при этом останется с газом.' },
    pump:      { t: 'На стройке включили насос', c: 1, s: 'Вода из котлована уходит. Через полчаса Даню можно будет вывести.' },
    lock:      { t: 'На шлюзе сбросили воду, мост заклинило', c: 1, s: 'Река обмелела, и вода в котлован больше не течёт. Через полчаса котлован высохнет. Разводной мост застрял поднятым, машины на тот берег не проедут. Пешком можно перейти по шлюзу.' },
    crew:      { t: 'Ремонтников отправили на другую аварию', c: 2, s: 'В 03:00 подстанцию не отключат. В больнице будет свет до утра.' },
    subEarly:  { t: 'Подстанцию отключили раньше срока', c: 1, s: 'На том берегу света нет уже сейчас. Аппарат Лизы продержится двадцать минут.' },
    mchsAvto:  { t: 'Машина МЧС стоит у автосервиса', c: 1, s: 'Бригада возвращалась с вызова и остановилась тут. Её можно о чём-нибудь попросить.' },
    loaders:   { t: 'На рынке сломались холодильники', c: 1, s: 'Сторож поднял грузчиков. Если попросить, они пойдут помогать.' },
    heart:     { t: 'Вера раньше работала на скорой', c: 1, s: 'Она тебя откачала и ушла к стройке. Через пятнадцать минут она будет у котлована и поможет тянуть верёвку.' }
  };

  function fresh() {
    return {
      t: T0, loc: 'dvor', inv: { rope: false, lom: false, note: false }, know: {}, edits: [], N: 0, deaths: 0, log: [], ev: [], last: null,
      gas: true, leak: true, riser: false, jam: false, crew: false, subEarly: false,
      truck: { awake: false, loc: 'mchs', busy: 0, gen: false, pit: false, pitAt: null, genOrdered: false },
      gosha: 'sleep', goshaSaw: false, genReady: null, loaders: false, loadersAtPit: false, gasman: false, heart: false, veraAt: null, drainAt: null, pulling: false,
      misha: { st: 'danger', at: null, how: null }, liza: { st: 'danger', at: null, unp: 0, how: null }, danya: { st: 'danger', at: null, how: null },
      seenN: {}, wit: [], over: false, cop: false, copDone: false
    };
  }
  const has = (S, e) => S.edits.includes(e);
  // плата за чудеса: 0 — тихо, 1 — разговоры (с 2), 2 — недоверие (с 4), 3 — участковый (с 6)
  const rep = S => S.N >= 6 ? 3 : S.N >= 4 ? 2 : S.N >= 2 ? 1 : 0;
  const log = (S, txt, cls) => S.log.unshift({ t: S.t, txt, cls: cls || '' });

  // ---------- ходьба
  const edgeOk = (S, e) => !(e[3] === 'bridge' && S.jam);
  function dijkstra(S, from) {
    const D = {}, P = {}; for (const k in LOC) D[k] = Infinity; D[from] = 0;
    const Q = new Set(Object.keys(LOC));
    while (Q.size) {
      let u = null; for (const k of Q) if (u === null || D[k] < D[u]) u = k;
      Q.delete(u); if (D[u] === Infinity) break;
      for (const e of EDGES) if (edgeOk(S, e)) {
        const v = e[0] === u ? e[1] : e[1] === u ? e[0] : null;
        if (v && D[u] + e[2] < D[v]) { D[v] = D[u] + e[2]; P[v] = u; }
      }
    }
    return { D, P };
  }
  const dist = (S, from) => dijkstra(S, from).D;
  function path(S, from, to) { const { P } = dijkstra(S, from); const r = [to]; while (r[0] !== from && P[r[0]]) r.unshift(P[r[0]]); return r; }
  function vehicle(S, from, to) { const a = LOC[from].bank, b = LOC[to].bank; if (from === to) return 0; if (a === b) return 10; return S.jam ? null : 15; }

  // ---------- угрозы
  function gridOn(S, t) { if (t >= DAWN) return true; if (S.subEarly) return false; return !(t >= 180 && !S.crew); }
  function powered(S, t) { return gridOn(S, t) || (S.genReady !== null && t >= S.genReady && S.gas) || S.truck.gen; }
  function lizaSafe(S) { return S.liza.st === 'saved' || (S.liza.st === 'danger' && ((S.crew && !S.subEarly) || S.truck.gen)); }
  function danyaPhase(S) {
    const d = S.danya.st; if (d !== 'danger') return d;
    if (S.truck.pit && S.t >= S.truck.pitAt) return 'mchs';
    if (S.pulling) return 'pulling';
    if (S.drainAt !== null) return 'draining';
    if (S.truck.pit) return 'mchsComing';
    return 'danger';
  }
  const SAVED = { misha: 'Миша спасён.', liza: 'Лиза спасена.', danya: 'Даня спасён.' };
  function save(S, who, how) {
    const p = S[who]; if (p.st !== 'danger') return;
    p.st = 'saved'; p.at = S.t; p.how = how;
    log(S, SAVED[who] + ' ' + how, 'g');
  }
  function checkNow(S) { if (S.misha.st === 'danger' && !S.leak) save(S, 'misha', 'Газ к нему больше не идёт, к утру он отоспится.'); }
  function step(S) {
    const prev = S.t; S.t += 5; const t = S.t;
    S.ev.sort((a, b) => a.at - b.at);
    while (S.ev.length && S.ev[0].at <= t) {
      const e = S.ev.shift(); const keep = S.t; S.t = e.at;
      if (e.type === 'gen') { S.gosha = 'stay'; log(S, S.gas ? 'Гоша запустил генератор в больнице.' : 'Гоша поставил клапан, но газа нет, и генератор не запускается.', S.gas ? 'g' : 'x'); }
      if (e.type === 'mchsGen') { S.truck.gen = true; log(S, 'Спасатели подключили к больнице свой генератор.', 'g'); }
      if (e.type === 'pitRescue') { if (S.danya.st === 'danger') save(S, 'danya', 'Спасатели спустили в котлован лестницу и подняли его.'); }
      if (e.type === 'door') { S.leak = false; if (S.misha.st === 'danger') save(S, 'misha', 'Ты открыл дверь ломом, перекрыл газ на плите и вынес его на лестницу.'); }
      if (e.type === 'riser') { S.riser = true; S.leak = false; }
      if (e.type === 'pull') { S.pulling = false; if (S.danya.st === 'danger') save(S, 'danya', 'Его вытащили из котлована верёвкой.'); }
      if (e.type === 'drain') { if (S.danya.st === 'danger') save(S, 'danya', 'Вода из котлована ушла, и его вывели.'); }
      S.t = keep;
    }
    checkNow(S);
    if (S.misha.st === 'danger' && t >= MISHA_DL) { S.misha.st = 'dead'; S.misha.at = MISHA_DL; log(S, 'В 02:45 Миша умер. Он так и не проснулся, отравился газом.', 'x'); }
    if (S.liza.st === 'danger') {
      if (!powered(S, prev)) { S.liza.unp += 5; if (S.liza.unp >= 25) { S.liza.st = 'dead'; S.liza.at = t; log(S, 'Аппарат ИВЛ двадцать минут стоял без электричества. В ' + hm(t) + ' Лиза умерла.', 'x'); } }
      else S.liza.unp = 0;
      if (S.liza.st === 'danger' && t >= DAWN) save(S, 'liza', 'Подстанцию включили, ночь кончилась.');
    }
    if (S.danya.st === 'danger' && t >= DANYA_DL) { S.danya.st = 'dead'; S.danya.at = DANYA_DL; log(S, 'В 03:40 вода в котловане поднялась выше головы. Даня утонул.', 'x'); }
    const th = [[2, 'Про тебя пошли разговоры. Люди теперь с тобой осторожничают, любой разговор и любая просьба занимают больше времени.'], [4, 'Тебе перестали доверять. Сторож, грузчики, Гоша и медсестра больше ничем тебе не помогут.'], [6, 'Кто-то позвонил участковому. Он пришёл и теперь не отходит от тебя ни на шаг.']];
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
      case 'mchsMisha': T.awake = true; T.loc = 'misha'; T.busy = S.t; S.leak = false; S.wit.push('соседи и спасатели'); save(S, 'misha', 'Спасатели вскрыли дверь и вынесли его на воздух.'); break;
      case 'gasOff': S.gas = false; S.leak = false; break;
      case 'gasman': S.gasman = true; S.wit.push('газовик'); break;
      case 'pump': S.drainAt = S.t + 30; S.ev.push({ at: S.t + 30, type: 'drain' }); S.wit.push('Даня и сторож стройки'); break;
      case 'lock': S.jam = true; if (S.drainAt === null || S.t + 30 < S.drainAt) { S.drainAt = S.t + 30; S.ev.push({ at: S.t + 30, type: 'drain' }); } S.wit.push('шлюзовщик'); break;
      case 'crew': S.crew = true; S.wit.push('водитель ремонтников'); break;
      case 'subEarly': S.subEarly = true; break;
      case 'mchsAvto': T.awake = true; T.loc = 'avto'; T.busy = S.t; S.wit.push('спасатели'); break;
      case 'loaders': S.loaders = true; S.wit.push('грузчики'); break;
      case 'heart': S.heart = true; S.veraAt = S.t + 15; S.wit.push('Вера'); break;
    }
    if (S.N >= 6 && !S.cop) S.cop = true;
    checkNow(S);
  }

  // ---------- смерти. die — как ты умер в том мире. why — что случилось в мире, где ты остался жить. seen — что видели люди здесь.
  const DEATHS = {
    roof: { lbl: 'Прыгнуть с крыши',
      die: 'Ты перелезаешь через ограждение и прыгаешь. Пять этажей, внизу асфальт. Ты разбиваешься насмерть.',
      res(S) {
        if (!S.truck.awake && S.leak && S.misha.st === 'danger')
          return { why: 'Пока ты стоял на краю, во двор въехала машина МЧС. Соседи всё-таки дозвонились насчёт газа. Спасатели заметили тебя и успели растянуть под тобой тент.', e: 'mchsMisha', seen: 'Спасатели видели, как ты прыгнул. Командир спросил, всё ли у тебя в порядке с головой, и повёл своих ломать дверь Мише.' };
        return { why: 'Ты зацепился курткой за антенный кабель. Он выдержал секунду и оборвался, и ты упал не на асфальт, а в кусты у подъезда. Отделался ссадинами.', e: has(S, 'awning') ? null : 'awning', seen: 'Соседка с третьего этажа видела, как ты упал с крыши в кусты и сам оттуда вылез.' };
      } },
    lighter: { lbl: 'Чиркнуть зажигалкой в подъезде, где пахнет газом',
      off: S => !S.gas ? 'Газ во всём квартале перекрыт, в подъезде им больше не пахнет.' : !S.leak ? 'Утечки больше нет, в подъезде газом не пахнет.' : null,
      die: 'Ты чиркаешь зажигалкой. Газ взрывается, тебя отбрасывает на перила. Ты погибаешь при взрыве.',
      res() { return { why: 'Зажигалка не зажглась, только щёлкнула. Соседка с третьего этажа увидела тебя с зажигалкой в подъезде, полном газа, закричала и побежала на газовый пункт. Газовик перекрыл газ во всём квартале.', e: 'gasOff', seen: 'Соседка видела, как ты пытался зажечь огонь в подъезде с газом. Теперь она всем рассказывает, что ты хотел взорвать дом.' }; } },
    grp: { lbl: 'Перелезть ограду и дышать газом у клапана',
      off: S => S.gasman ? 'Газовик не спит и к клапану тебя больше не пустит.' : null,
      die: 'Ты перелезаешь через сетку и садишься у клапана, который травит газ. Через несколько минут теряешь сознание и больше не приходишь в себя.',
      res() { return { why: 'Газовик вышел покурить, увидел тебя у клапана и вытащил за ограду. Ты очнулся на траве.', e: 'gasman', seen: 'Газовик видел, как ты сам полез к клапану. «Ты чего, с ума сошёл?» Потом спросил, что тебе нужно.' }; } },
    pit: { lbl: 'Прыгнуть в котлован к Дане',
      off: S => { const p = danyaPhase(S); return p === 'draining' ? 'Насос и так откачивает воду.' : p === 'mchsComing' ? 'Сюда уже едет МЧС.' : null; },
      die: 'Ты прыгаешь в котлован. Вода ледяная, ноги вязнут в глине, стенки скользкие. Выбраться не получается. Ты захлёбываешься и тонешь.',
      res() { return { why: 'Сторож стройки проснулся от шума и включил насос. Вода стала уходить, и ты встал на дно рядом с Даней.', e: 'pump', seen: 'Даня видел, как ты прыгнул и ушёл под воду. «Я думал, ты утонул», — говорит он.' }; } },
    lock: { lbl: 'Прыгнуть в шлюзовую камеру',
      off: S => S.jam ? 'Воды в камере по колено, утонуть тут нельзя.' : null,
      die: 'Ты прыгаешь в камеру шлюза. Течение тащит тебя к затвору и прижимает к решётке. Ты тонешь.',
      res() { return { why: 'Шлюзовщик увидел, как ты прыгнул, и открыл аварийный сброс. Вода ушла за минуту. От перепада уровня заклинило разводной мост.', e: 'lock', seen: 'Шлюзовщик видел твой прыжок. Он ругается: «Мост теперь до утра не опустится. Из-за тебя».' }; } },
    crew: { lbl: 'Броситься под машину ремонтников',
      off: S => S.crew ? 'Ремонтники уже уехали на другую аварию.' : null,
      die: 'Ты выходишь на дорогу перед машиной. Водитель не успевает затормозить. Тебя сбивает насмерть.',
      res() { return { why: 'Водитель начал тормозить раньше. Ему как раз по рации приказали развернуться и ехать на другую аварию. Машина встала в метре от тебя.', e: 'crew', seen: 'Водитель видел, как ты бросился под колёса. Он долго ругался, потом развернулся и уехал.' }; } },
    sub: { lbl: 'Взяться за шину под напряжением',
      off: S => !gridOn(S, S.t) ? 'Подстанция уже отключена, тока нет.' : null,
      die: 'Ты пролезаешь в кабельный канал и берёшься за шину. Тебя убивает током.',
      res() { return { why: 'В ту же секунду дежурный отключил подстанцию. Он решил начать ремонт раньше, чтобы пораньше уйти домой. Ток пропал.', e: 'subEarly', seen: null }; } },
    poison: { lbl: 'Выпить из бутылки без этикетки',
      die: 'В бутылке антифриз. Через несколько минут ты падаешь на пол и умираешь от отравления.',
      res(S) { return S.truck.awake ? { why: 'Спасатели оказались рядом и снова тебя откачали.', e: null, seen: 'Фельдшер узнал тебя: «Опять ты?»' } : { why: 'Через минуту у ворот остановилась машина МЧС, бригада возвращалась с вызова. Фельдшер услышал, как ты хрипишь, и откачал тебя.', e: 'mchsAvto', seen: 'Спасатели видели, что ты выпил антифриз. Командир спрашивает, зачем, и ждёт, что ты скажешь.' }; } },
    freeze: { lbl: 'Закрыться в холодильной камере',
      off: S => S.loaders ? 'Холодильники сломаны, в камере тепло.' : null,
      die: 'Ты заходишь в камеру и закрываешь дверь. Там минус двадцать восемь. Через полчаса ты засыпаешь и замерзаешь насмерть.',
      res() { return { why: 'Через десять минут на рынке сломались холодильники. Сторож разбудил грузчиков, и они открыли камеру.', e: 'loaders', seen: 'Грузчики нашли тебя в камере и вытащили. Никто не понял, зачем ты туда залез.' }; } },
    heart: { lbl: 'Бегать вокруг дома, пока не встанет сердце',
      off: S => S.heart ? 'Вера больше не даст тебе бегать.' : null,
      die: 'Ты бежишь круг за кругом. На третьем круге у тебя останавливается сердце. Ты падаешь у песочницы и умираешь.',
      res() { return { why: 'Вера видела, как ты упал. Она тридцать лет работала на скорой. Она прибежала и делала тебе массаж сердца, пока ты не задышал.', e: 'heart', seen: 'Вера тебя откачала. «Ты что творишь, Андрей? Ладно, потом поговорим. Пошли за Даней, я помогу тянуть».' }; } }
  };
  const DEATH_AT = { roof: 'roof', lighter: 'misha', grp: 'grp', pit: 'stroika', lock: 'shluz', crew: 'most', sub: 'podst', poison: 'avto', freeze: 'rynok', heart: 'dvor' };

  // ---------- описания мест (зависят от состояния)
  function descr(S) {
    const T = S.truck, ph = danyaPhase(S);
    let x;
    switch (S.loc) {
      case 'dvor':
        x = 'Двор твоего дома, час ночи.';
        if (S.heart) x += S.t < S.veraAt ? ' Вера ушла к стройке.' : '';
        else if (S.danya.st === 'saved') x += ' Вера ушла на стройку к Дане.';
        else if (S.danya.st === 'dead') x += ' Вера сидит на лавке и ни на кого не смотрит.';
        else x += ' На лавке сидит соседка Вера. Её сын Даня, ему семь лет, ушёл из дома и пропал.';
        break;
      case 'misha':
        x = 'Пятиэтажка, где живёт твой друг Миша.';
        if (S.misha.st === 'saved') x += ' Газом больше не пахнет. Миша сидит на лавке у подъезда и кашляет.';
        else if (S.misha.st === 'dead') x += ' У подъезда стоит скорая. Мишу не спасли.';
        else x += ' В подъезде пахнет газом. Миша работает на разрезе. После двух смен подряд он запирается и спит так, что не добудишься.';
        break;
      case 'roof': x = 'Крыша дома Миши. Отсюда видно стройку и реку, а на том берегу больницу и подстанцию.'; break;
      case 'rynok': x = 'Крытый рынок. У ворот курит сторож.' + (S.loaders ? ' Грузчики выносят ящики из сломанных холодильников.' : ''); break;
      case 'grp': x = 'Газовый пункт за сеткой. Отсюда перекрывают газ в квартале, задвижки опломбированы.' + (S.gasman ? ' Газовик не спит и сидит на ступеньке.' : ' В будке спит дежурный газовик.'); break;
      case 'stroika':
        x = 'Стройка, котлован глубиной метра четыре.';
        x += { danger: ' В котловане вода. Даня стоит в ней по грудь и держится за арматуру. Вода прибывает.',
               draining: ' Работает насос, вода в котловане уходит. Даня держится за арматуру.',
               mchsComing: ' Даня стоит в воде по грудь. Сюда едет МЧС.',
               mchs: ' Спасатели спускают в котлован лестницу.',
               pulling: ' Вы вытаскиваете Даню.',
               saved: ' Даня сидит у вагончика, завёрнутый в куртку.',
               dead: ' Котлован полон воды. Даню не спасли.' }[ph];
        if (S.loadersAtPit && S.danya.st === 'danger') x += ' У края ждут грузчики.';
        if (S.heart && S.t >= S.veraAt) x += S.danya.st === 'saved' ? ' Вера сидит рядом с Даней.' : ' У края стоит Вера.';
        break;
      case 'most': x = 'Разводной мост через реку.' + (S.jam ? ' Он застрял в поднятом положении, пройти нельзя.' : (S.t >= CREW_FROM && S.t < 180 && !S.crew) ? ' По мосту едет машина горсетей, ремонтники едут к подстанции.' : ' Ночью тут никого.'); break;
      case 'shluz': x = 'Шлюз на реке. По мостику над затворами можно перейти на другой берег. В будке сидит шлюзовщик.' + (S.jam ? ' Камера пустая.' : ''); break;
      case 'bolnica':
        x = 'Больница. В реанимации на третьем этаже лежит твоя сестра Лиза. Она дышит через аппарат ИВЛ, а он работает от электричества.';
        if (S.liza.st === 'dead') x = 'Больница. Лиза умерла.';
        else {
          if (S.gosha === 'work') x += ' Гоша в подвале чинит генератор.';
          if (S.gosha === 'stay') x += ' Генератор в подвале работает, Гоша при нём.';
          if (T.gen) x += ' Во дворе работает генератор МЧС.';
          if (!gridOn(S, S.t) && !powered(S, S.t)) x += ' Света нет.';
        }
        break;
      case 'mchs': x = 'База МЧС.' + (T.awake ? (T.loc === 'mchs' ? ' Машина у ворот.' : ' Машина на выезде.') : ' Ворота закрыты, дежурный дремлет у окна.'); break;
      case 'avto':
        x = 'Автосервис.';
        if (S.gosha === 'sleep') x += S.know.gosha ? ' В бытовке спит механик Гоша.' : ' Из бытовки слышен храп.';
        x += ' На верстаке стоит бутылка без этикетки.';
        break;
      case 'podst': x = 'Подстанция. От неё получает электричество весь тот берег, и больница тоже.' + (!gridOn(S, S.t) ? ' Сейчас она отключена.' : ''); break;
    }
    if (T.awake && T.loc === S.loc && S.loc !== 'mchs') x += S.t < T.busy ? ' Здесь машина МЧС, бригада работает.' : ' Здесь стоит машина МЧС, бригада ждёт.';
    if (S.gosha === 'follow') x += ' Гоша с тобой.';
    return x;
  }

  // ---------- действия на месте
  function list(S) {
    const A = [], L = S.loc, T = S.truck, K = S.know, ph = danyaPhase(S);
    const act = (id, lbl, min, off) => A.push({ id, lbl, min, kind: 'act', off: off || null });
    const R = rep(S), slow = R >= 1 ? 5 : 0;
    const PEOPLE = ['vera', 'door', 'rynokguard', 'pit', 'pit2', 'shluz', 'nurse', 'mchsdesk'];
    const clue = (id, lbl, txt, learn) => { const L2 = learn ? [].concat(learn) : []; A.push({ id, lbl, min: 5 + (PEOPLE.includes(id) ? slow : 0), kind: 'clue', txt, learn: L2.length ? L2 : null, fresh: L2.length ? L2.some(k => !K[k]) : !K['c:' + id] }); };
    const ask = (id, lbl, min, refuse) => act(id, lbl, min + slow, R >= 2 && refuse ? refuse : null);
    const death = k => { const d = DEATHS[k]; A.push({ id: 'die:' + k, lbl: d.lbl, min: 15, kind: 'die', off: S.cop ? 'Участковый ходит за тобой по пятам. При нём ничего такого не сделаешь.' : d.off ? d.off(S) : null }); };
    const goshaHere = S.gosha === 'follow';
    const mDanger = S.misha.st === 'danger', dDanger = S.danya.st === 'danger', lDanger = S.liza.st === 'danger';
    switch (L) {
      case 'dvor':
        if (!S.heart && S.danya.st !== 'dead') clue('vera', 'Поговорить с Верой', dDanger
          ? '«Андрей, Даня пропал! Колька сказал, он полез на стройку за котёнком, а там котлован с водой. Я туда не дойду, ноги не держат. Возьми у сторожа на рынке верёвку, у него есть». Потом добавляет: «И к Мише зайди. Соседка его звонила, у них в подъезде газом пахнет».'
          : '«Спасибо тебе». Вера собирается на стройку к сыну.', dDanger ? 'rope' : null);
        death('heart'); break;
      case 'misha':
        if (mDanger) clue('door', 'Позвонить Мише в дверь', 'Ты звонишь и стучишь, никто не открывает. Из-под двери пахнет газом. Дверь железная, изнутри закрыта на щеколду. Сверху спускается соседка: «Он после смены, спит. Я звонила в газовую, там автоответчик. Такую дверь только ломом откроешь. На стройке у вагончика лом лежит, я видела».', 'lom');
        if (mDanger && (K.lom || S.inv.lom)) act('lom-door', 'Открыть дверь ломом', 15, !S.inv.lom ? 'Без лома эту дверь не открыть. Лом лежит на стройке у вагончика.' : null);
        death('lighter'); break;
      case 'roof':
        clue('roof', 'Посмотреть вниз', S.leak && mDanger ? 'У подъезда стоят соседи в халатах и спорят, кто будет звонить в МЧС. На стройке блестит вода в котловане. На том берегу светится больница.' : 'Внизу тихо. На стройке блестит вода в котловане, на том берегу светится больница.');
        death('roof'); break;
      case 'rynok':
        if (dDanger) clue('rynokguard', 'Поговорить со сторожем', '«Пацан в котловане? Бери верёвку, вон на гвозде висит». Про грузчиков он говорит: «Они к шести придут. Если холодильники сломаются, вызову раньше, а так все спят».', 'rope');
        if (dDanger && K.rope && !S.inv.rope) ask('rope', 'Взять верёвку', 5, 'Сторож убирает верёвку: «Иди отсюда. Про тебя всякое рассказывают».');
        if (S.loaders && !S.loadersAtPit && dDanger && ph !== 'mchs') ask('loaders-go', 'Позвать грузчиков к котловану', 5, 'Грузчики отворачиваются. Про тебя они уже слышали.');
        death('freeze'); break;
      case 'grp':
        if (!S.gasman) clue('grpknock', 'Постучать в будку газовика', 'Будка закрыта изнутри. Газовик спит в наушниках и не слышит, как ты стучишь. Без него газ не перекрыть. Задвижки опломбированы, и ты не знаешь, какая из них куда.');
        if (S.gasman && mDanger && S.leak) ask('riser', 'Попросить газовика перекрыть газ в доме Миши', 10, null);
        death('grp'); break;
      case 'stroika':
        if (ph === 'danger' || ph === 'mchsComing') clue('pit', 'Поговорить с Даней', '«Даня, я здесь!» — «Дядя Андрей, тут холодно. Я котёнка не нашёл». Вода сочится из старой трубы со стороны реки и прибывает. К 03:40 она поднимется выше его головы. Ты пробуешь дотянуться до него, но стенки скользкие, и тебя самого тянет вниз. С верёвкой и вдвоём получится: один спускается, второй держит. Сторож пьяный спит в вагончике, его не разбудить.', 'rope');
        if (ph === 'draining') clue('pit2', 'Поговорить с Даней', '«Дядя Андрей, вода уходит!» Насос гудит, Даня уже стоит по пояс.');
        if (mDanger && K.lom && !S.inv.lom) act('lom', 'Взять лом у вагончика', 5);
        if ((ph === 'danger' || ph === 'draining' || ph === 'mchsComing') && (K.rope || S.inv.rope)) {
          const helper = goshaHere ? 'с Гошей' : S.loadersAtPit ? 'с грузчиками' : (S.heart && S.t >= S.veraAt) ? 'с Верой' : null;
          act('pull', 'Вытащить Даню верёвкой' + (helper ? ' ' + helper : ''), 15,
            !S.inv.rope ? 'Сначала нужна верёвка. Она у сторожа на рынке.' : !helper ? 'Одному не вытянуть, нужен второй человек, чтобы держать верёвку.' : null);
        }
        if (dDanger) death('pit');
        break;
      case 'most':
        clue('most', 'Осмотреться на мосту', S.jam ? 'Мост застрял поднятым. На тот берег отсюда не попасть.' : 'Ночью мост пустой. Это единственная дорога из города к подстанции, другой нет.');
        if (!S.jam && S.t >= CREW_FROM && S.t < 180 && !S.crew) { act('stopcrew', S.inv.note ? 'Остановить машину горсетей и отдать бумагу' : 'Остановить машину горсетей', 5); death('crew'); }
        break;
      case 'shluz':
        clue('shluz', 'Поговорить со шлюзовщиком', S.jam ? 'Шлюзовщик с тобой разговаривать не хочет.' : '«Сбросить воду? Без команды диспетчера нельзя. Если сбросить, река обмелеет и к вам на стройку течь перестанет. Только мост заклинит, он разводной. В девяносто восьмом так уже было».');
        death('lock'); break;
      case 'bolnica':
        clue('nurse', 'Спросить медсестру про Лизу',
          S.liza.st === 'dead' ? '«Мне очень жаль». Медсестра отводит глаза.'
          : (lizaSafe(S) || S.genReady !== null) ? '«Свет у нас будет, не волнуйтесь. Лиза спит».'
          : '«Лиза в стабильном состоянии. Только в три часа ночи отключат подстанцию, у них плановый ремонт. Генератор у нас газовый и с весны не работает. Механик Гоша из автосервиса обещал починить и не пришёл. Без электричества аппарат проработает минут двадцать. В МЧС генератор дают только при ЧС».', lDanger ? ['gosha', 'nogen'] : null);
        if (lDanger && !S.crew && !lizaSafe(S) && !S.inv.note && K.nogen && (K.crewtime || K.needpaper))
          ask('note', 'Попросить медсестру написать бумагу для ремонтников', 10, 'Медсестра про тебя уже наслышана и писать ничего не будет.');
        if (goshaHere && S.genReady === null && lDanger) act('gen', 'Отвести Гошу к генератору', S.goshaSaw ? 30 : 45,
          !S.gas ? '«Газа нет, а генератор газовый. Не запустится», — говорит Гоша.' : null);
        break;
      case 'mchs':
        clue('mchsdesk', 'Постучать к дежурному', T.awake ? '«Машина на выезде». Дежурный закрывает окно.' : 'Дежурный открывает окошко: «Без вызова диспетчера не выезжаем. Звоните 112». Телефон у тебя сел ещё вечером. Ты просишь позвонить с базы, он говорит, что не положено.');
        break;
      case 'avto':
        if (!K.gosha) clue('cabin', 'Заглянуть в бытовку', 'В бытовке на старом автомобильном сиденье спит мужик в рабочем комбинезоне. На шкафчике написано: «Гоша».', 'gosha');
        if (K.gosha && S.gosha === 'sleep') ask('gosha', 'Разбудить механика Гошу', 5, 'Гоша смотрит на тебя из бытовки и не выходит: «Про тебя такое рассказывают… Нет, Андрюха, никуда я с тобой не пойду».');
        death('poison'); break;
      case 'podst':
        clue('podst', 'Прочитать объявление на воротах', '«Плановое отключение с 03:00 до 05:00». Ниже от руки: «Бригада выезжает из города в 02:15». Решётка кабельного канала отогнута.', 'crewtime');
        death('sub'); break;
    }
    if (T.awake && T.loc === L) {
      const idle = S.t >= T.busy;
      if (!T.gen && !T.genOrdered && lDanger && !lizaSafe(S)) { const tt = vehicle(S, L, 'bolnica'); act('mchs-gen', 'Попросить МЧС отвезти генератор в больницу', 5, !idle ? 'Бригада занята.' : tt === null ? 'Мост заклинило, машине на тот берег не проехать.' : null); }
      if (!T.pit && dDanger && ph !== 'pulling') { const tt = vehicle(S, L, 'stroika'); act('mchs-pit', 'Попросить МЧС вытащить Даню из котлована', 5, !idle ? 'Бригада занята.' : tt === null ? 'Мост заклинило, машине на тот берег не проехать.' : null); }
    }
    act('wait', 'Ждать 15 минут', 15, null);
    act('dawn', 'Ждать до утра', 0, null);
    return A;
  }
  function moves(S) { const D = dist(S, S.loc); return Object.keys(LOC).filter(k => k !== S.loc && D[k] < Infinity).map(k => ({ to: k, min: D[k] })); }

  // ---------- применить действие
  function apply(S, id) {
    if (S.over) return null;
    S.last = null;
    if (id.startsWith('go:')) {
      const to = id.slice(3), D = dist(S, S.loc);
      if (D[to] === Infinity || to === S.loc) return null;
      const from = S.loc, route = path(S, from, to);
      S.loc = to; advance(S, D[to]); return { kind: 'go', route, from };
    }
    const a = list(S).find(x => x.id === id);
    if (!a || a.off) return null;
    if (a.kind === 'clue') {
      S.know['c:' + a.id] = true; if (a.learn) for (const k of a.learn) S.know[k] = true;
      S.last = { title: a.lbl, text: (a.min > 5 ? 'Сначала на тебя долго и молча смотрят. ' : '') + a.txt, cls: 'clue' }; advance(S, a.min); return { kind: 'clue' };
    }
    if (a.kind === 'die') {
      const k = id.slice(4), d = DEATHS[k], r = d.res(S);
      S.deaths++; const at = S.t;
      const seen = []; if (r.seen) seen.push(r.seen);
      if (S.gosha === 'follow') {
        if (!S.goshaSaw) { S.goshaSaw = true; S.wit.push('Гоша'); seen.push('Гоша видел, что ты сделал это нарочно и что тебя спасли. «Андрюха, ты знал, что так будет?» Ты не отвечаешь. Больше Гоша не спорит и торопится. Генератор он теперь починит за полчаса.'); }
        else { S.gosha = 'gone'; seen.push('Гоша второй раз видит, как ты нарочно идёшь на смерть и тебя спасают. «Я с тобой больше никуда не пойду». Он уходит домой.'); log(S, 'Гоша ушёл домой.', 'x'); }
      }
      log(S, '✝ Ты умер. Дальше ты живёшь в мире, где тебе повезло.', 'x');
      if (r.e) { addEdit(S, r.e); log(S, '✦ ' + EDITS[r.e].t + '. Невероятность +' + EDITS[r.e].c + '.', 'a'); }
      else log(S, 'Тебя спасло то, что уже было в мире. Ничего нового не появилось.', 'g');
      advance(S, 15);
      if (S.cop && !S.copDone) { S.copDone = true; seen.push('Через десять минут приходит участковый. Ему уже позвонили трое. Полчаса он расспрашивает тебя, что происходит, и потом не отходит ни на шаг.'); advance(S, 30); }
      return { kind: 'die', d, r, at, seen };
    }
    const T = S.truck;
    const done = (title, text) => { S.last = { title, text, cls: 'act' }; };
    switch (id) {
      case 'lom-door': S.ev.push({ at: S.t + 15, type: 'door' }); done('Дверь', 'Ты поддеваешь щеколду ломом. С третьего раза дверь открывается. В квартире полно газа, Миша спит на диване. Ты перекрываешь газ на плите, открываешь окна и выносишь Мишу на лестницу.'); advance(S, 15); return { kind: 'act' };
      case 'rope': S.inv.rope = true; done('Верёвка', 'Сторож отдаёт тебе моток верёвки, метров пятнадцать.'); break;
      case 'lom': S.inv.lom = true; done('Лом', 'Лом лежит у вагончика. Сторож спит и ничего не слышит.'); break;
      case 'loaders-go': S.loadersAtPit = true; done('Грузчики', 'Грузчики оставляют ящики и идут к стройке. Они будут ждать у котлована.'); break;
      case 'riser': S.ev.push({ at: S.t + a.min, type: 'riser' }); done('Газ', 'Газовик идёт с тобой к дому Миши и в подвале перекрывает задвижку на стояке. В доме Миши газа больше нет, в остальном квартале есть.'); advance(S, a.min); return { kind: 'act' };
      case 'pull': { const who = S.gosha === 'follow' ? 'Гоша' : S.loadersAtPit ? 'грузчики' : 'Вера'; S.pulling = true; S.ev.push({ at: S.t + 15, type: 'pull' }); done('Котлован', 'Ты обвязываешься верёвкой и спускаешься в воду. Даня хватается за тебя. Наверху верёвку тянет ' + who + '. Через десять минут вы оба наверху.'); advance(S, 15); return { kind: 'act' }; }
      case 'gosha': S.gosha = 'follow'; done('Гоша', 'Ты будишь Гошу и объясняешь про генератор. «В больнице? Там твоя Лиза? Ладно, пошли. Только не беги, у меня колено». Гоша идёт с тобой.'); break;
      case 'gen': { const m = S.goshaSaw ? 30 : 45; S.gosha = 'work'; S.genReady = S.t + m; S.ev.push({ at: S.t + m, type: 'gen' }); done('Генератор', 'Гоша осматривает генератор. «Клапан сгорел. Сниму со своей машины, это ' + (S.goshaSaw ? 'полчаса' : 'минут сорок пять') + '. Я тут останусь, мало ли что». Генератор заработает в ' + hm(S.genReady) + '.'); advance(S, 5); return { kind: 'act' }; }
      case 'mchs-gen': { const tt = vehicle(S, S.loc, 'bolnica'); T.loc = 'bolnica'; T.busy = S.t + tt + 15; T.genOrdered = true; S.ev.push({ at: S.t + tt + 10, type: 'mchsGen' }); done('МЧС', 'Спасатели едут в больницу с генератором. Подключат в ' + hm(S.t + tt + 10) + '.'); break; }
      case 'mchs-pit': { const tt = vehicle(S, S.loc, 'stroika'); T.loc = 'stroika'; T.pit = true; T.pitAt = S.t + tt; T.busy = S.t + tt + 10; S.ev.push({ at: S.t + tt + 10, type: 'pitRescue' }); done('МЧС', 'Спасатели едут на стройку. Даню достанут в ' + hm(S.t + tt + 10) + '.'); break; }
      case 'note': S.inv.note = true; done('Бумага', 'Медсестра сначала не понимает, зачем. Потом пишет на бланке: «Резервного питания нет, пациентка на ИВЛ. Отключать подстанцию нельзя». Дежурный врач ставит печать.'); advance(S, a.min); return { kind: 'act' };
      case 'stopcrew':
        if (S.inv.note) { S.crew = true; S.inv.note = false; done('Ремонтники', 'Ты машешь руками, машина останавливается. Водитель читает бумагу, вздыхает и звонит диспетчеру. «Ладно. Отменили. Поехали на другую аварию». Отключения в три часа не будет.'); log(S, 'Ремонтников развернули по бумаге из больницы. Отключения не будет.', 'g'); }
        else { S.know.needpaper = true; done('Ремонтники', 'Ты машешь руками, машина останавливается. Ты объясняешь про больницу. Водитель качает головой: «У меня наряд. Пусть больница пишет бумагу, тогда позвоню диспетчеру. А так не могу». Он уезжает к подстанции.'); }
        advance(S, a.min); return { kind: 'act' };
      case 'wait': done('Ожидание', 'Ты ждёшь пятнадцать минут.'); advance(S, 15); return { kind: 'act' };
      case 'dawn': advance(S, DAWN - S.t); return { kind: 'act' };
    }
    advance(S, a.min);
    return { kind: 'act' };
  }

  root.G = { rep, CREW_FROM, T0, DAWN, LOC, EDGES, EDITS, DEATHS, DEATH_AT, fresh, list, moves, apply, descr, dist, path, hm, powered, gridOn, lizaSafe, vehicle, danyaPhase };
})(typeof window !== 'undefined' ? window : globalThis);
