/* EN layer: «Трое до рассвета» → "Three Before Dawn". Logic is identical to core.js; only player-facing strings are translated. Keep in sync with core.js.
   API: G.fresh(), G.list(S), G.moves(S), G.apply(S, id) → {kind, ...}, G.path(S, from, to), G.descr(S), G.danyaPhase(S). */
(function (root) {
  const T0 = 60, DAWN = 300, CREW_FROM = 135, MISHA_DL = 165, DANYA_DL = 220; // ремонтники на мосту с 02:15 до 03:00
  const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

  // ---------- места (координаты на карте 1536×1024)
  const LOC = {
    dvor:    { n: 'The Yard',            x: 305, y: 235, bank: 'W' },
    misha:   { n: "Vitka's Building",        x: 420, y: 168, bank: 'W' },
    roof:    { n: "Vitka's Roof", x: 548, y: 88,  bank: 'W' },
    rynok:   { n: 'The Market',           x: 410, y: 535, bank: 'W' },
    grp:     { n: 'Gas Station',   x: 130, y: 470, bank: 'W' },
    stroika: { n: 'Building Site',         x: 218, y: 795, bank: 'W' },
    most:    { n: 'The Bridge',            x: 785, y: 343, bank: 'R' },
    shluz:   { n: 'The Lock',            x: 785, y: 838, bank: 'R' },
    bolnica: { n: 'Hospital',        x: 1085, y: 185, bank: 'E' },
    mchs:    { n: 'Rescue Base',        x: 1365, y: 125, bank: 'E' },
    avto:    { n: 'Garage',      x: 1128, y: 625, bank: 'E' },
    podst:   { n: 'Substation',      x: 1395, y: 725, bank: 'E' }
  };
  const EDGES = [
    ['dvor', 'misha', 5], ['misha', 'roof', 5], ['dvor', 'rynok', 5], ['dvor', 'grp', 10], ['rynok', 'grp', 5],
    ['rynok', 'stroika', 5], ['grp', 'stroika', 10], ['misha', 'most', 5], ['rynok', 'most', 10], ['stroika', 'shluz', 5],
    ['most', 'bolnica', 5, 'bridge'], ['bolnica', 'mchs', 5], ['bolnica', 'avto', 5], ['avto', 'podst', 5],
    ['mchs', 'podst', 10], ['shluz', 'podst', 10]
  ];

  // ---------- что меняется в мире, где ты остался жить
  const EDITS = {
    mchsMisha: { t: 'The neighbors called the rescue service about the gas', c: 2, s: "A rescue truck is parked by Vitka's building. The rescuers broke open the door and carried Vitka out. The crew is free; you can ask them for something." },
    awning:    { t: 'An antenna cable on the roof is torn', c: 1, s: "You caught on it and fell into the bushes. It doesn't affect anything else." },
    gasOff:    { t: 'The gas is shut off for the whole block', c: 1, s: "Gas no longer reaches Vitka's apartment. The hospital generator also runs on gas, and now it won't start." },
    gasman:    { t: 'The gas man is awake', c: 1, s: 'You can ask him to shut off the gas in one building. The rest of the block keeps its gas.' },
    pump:      { t: 'The pump at the building site is on', c: 1, s: 'The water is draining from the pit. In half an hour Danya can be led out.' },
    lock:      { t: 'Water was released at the lock, the bridge is jammed', c: 1, s: "The river has dropped, and water no longer flows into the pit. In half an hour the pit will be dry. The drawbridge is stuck raised; vehicles can't reach the far bank. On foot you can cross by the lock." },
    crew:      { t: 'The repair crew was sent to another breakdown', c: 2, s: "The substation won't be switched off at 03:00. The hospital will have power until morning." },
    subEarly:  { t: 'The substation was switched off early', c: 1, s: "The far bank has no power already. Nika's machine will hold out for twenty minutes." },
    mchsAvto:  { t: 'A rescue truck is parked at the garage', c: 1, s: 'The crew was coming back from a call and stopped here. You can ask them for something.' },
    loaders:   { t: 'The refrigerators at the market broke down', c: 1, s: "The watchman got the loaders up. If you ask, they'll go and help." },
    heart:     { t: 'Vera used to work on an ambulance', c: 1, s: "She revived you and went to the building site. In fifteen minutes she'll be at the pit and will help pull the rope." }
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
  const SAVED = { misha: 'Vitka is saved.', liza: 'Nika is saved.', danya: 'Danya is saved.' };
  function save(S, who, how) {
    const p = S[who]; if (p.st !== 'danger') return;
    p.st = 'saved'; p.at = S.t; p.how = how;
    log(S, SAVED[who] + ' ' + how, 'g');
  }
  function checkNow(S) { if (S.misha.st === 'danger' && !S.leak) save(S, 'misha', "Gas isn't reaching him anymore; by morning he'll have slept it off."); }
  function step(S) {
    const prev = S.t; S.t += 5; const t = S.t;
    S.ev.sort((a, b) => a.at - b.at);
    while (S.ev.length && S.ev[0].at <= t) {
      const e = S.ev.shift(); const keep = S.t; S.t = e.at;
      if (e.type === 'gen') { S.gosha = 'stay'; log(S, S.gas ? 'Gosha got the hospital generator running.' : "Gosha fitted the valve, but there's no gas, and the generator won't start.", S.gas ? 'g' : 'x'); }
      if (e.type === 'mchsGen') { S.truck.gen = true; log(S, 'The rescuers hooked their own generator up to the hospital.', 'g'); }
      if (e.type === 'pitRescue') { if (S.danya.st === 'danger') save(S, 'danya', 'The rescuers lowered a ladder into the pit and brought him up.'); }
      if (e.type === 'door') { S.leak = false; if (S.misha.st === 'danger') save(S, 'misha', 'You pried the door open with the crowbar, shut off the gas at the stove and carried him out to the stairs.'); }
      if (e.type === 'riser') { S.riser = true; S.leak = false; }
      if (e.type === 'pull') { S.pulling = false; if (S.danya.st === 'danger') save(S, 'danya', 'He was pulled out of the pit with the rope.'); }
      if (e.type === 'drain') { if (S.danya.st === 'danger') save(S, 'danya', 'The water drained from the pit, and he was led out.'); }
      S.t = keep;
    }
    checkNow(S);
    if (S.misha.st === 'danger' && t >= MISHA_DL) { S.misha.st = 'dead'; S.misha.at = MISHA_DL; log(S, 'At 02:45 Vitka died. He never woke up; the gas poisoned him.', 'x'); }
    if (S.liza.st === 'danger') {
      if (!powered(S, prev)) { S.liza.unp += 5; if (S.liza.unp >= 25) { S.liza.st = 'dead'; S.liza.at = t; log(S, 'The ventilator stood without power for twenty minutes. At ' + hm(t) + ' Nika died.', 'x'); } }
      else S.liza.unp = 0;
      if (S.liza.st === 'danger' && t >= DAWN) save(S, 'liza', 'The substation came back on; the night is over.');
    }
    if (S.danya.st === 'danger' && t >= DANYA_DL) { S.danya.st = 'dead'; S.danya.at = DANYA_DL; log(S, 'At 03:40 the water in the pit rose over his head. Danya drowned.', 'x'); }
    const th = [[2, 'People have started talking about you. They are wary of you now; every conversation and every request takes longer.'], [4, "People have stopped trusting you. The watchman, the loaders, Gosha and the nurse won't help you with anything anymore."], [6, "Someone called the local police officer. He has come, and now he won't leave your side."]];
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
      case 'mchsMisha': T.awake = true; T.loc = 'misha'; T.busy = S.t; S.leak = false; S.wit.push('the neighbors and the rescuers'); save(S, 'misha', 'The rescuers broke open the door and carried him out into the air.'); break;
      case 'gasOff': S.gas = false; S.leak = false; break;
      case 'gasman': S.gasman = true; S.wit.push('the gas man'); break;
      case 'pump': S.drainAt = S.t + 30; S.ev.push({ at: S.t + 30, type: 'drain' }); S.wit.push('Danya and the site watchman'); break;
      case 'lock': S.jam = true; if (S.drainAt === null || S.t + 30 < S.drainAt) { S.drainAt = S.t + 30; S.ev.push({ at: S.t + 30, type: 'drain' }); } S.wit.push('the lock keeper'); break;
      case 'crew': S.crew = true; S.wit.push("the repair crew's driver"); break;
      case 'subEarly': S.subEarly = true; break;
      case 'mchsAvto': T.awake = true; T.loc = 'avto'; T.busy = S.t; S.wit.push('the rescuers'); break;
      case 'loaders': S.loaders = true; S.wit.push('the loaders'); break;
      case 'heart': S.heart = true; S.veraAt = S.t + 15; S.wit.push('Vera'); break;
    }
    if (S.N >= 6 && !S.cop) S.cop = true;
    checkNow(S);
  }

  // ---------- смерти. die — как ты умер в том мире. why — что случилось в мире, где ты остался жить. seen — что видели люди здесь.
  const DEATHS = {
    roof: { lbl: 'Jump off the roof',
      die: 'You climb over the barrier and jump. Five floors, asphalt below. You are killed by the fall.',
      res(S) {
        if (!S.truck.awake && S.leak && S.misha.st === 'danger')
          return { why: 'While you stood at the edge, a rescue truck drove into the yard. The neighbors had got through about the gas after all. The rescuers spotted you and got a tarp stretched out under you in time.', e: 'mchsMisha', seen: "The rescuers saw you jump. The commander asked whether you were all right in the head, and led his men off to break down Vitka's door." };
        return { why: 'Your jacket caught on an antenna cable. It held for a second and snapped, and you fell not onto the asphalt but into the bushes by the entrance. You got off with scrapes.', e: has(S, 'awning') ? null : 'awning', seen: 'The neighbor from the third floor saw you fall off the roof into the bushes and climb out on your own.' };
      } },
    lighter: { lbl: 'Flick a lighter in the stairwell that smells of gas',
      off: S => !S.gas ? "The gas is shut off for the whole block; the stairwell doesn't smell of it anymore." : !S.leak ? "There's no leak anymore; the stairwell doesn't smell of gas." : null,
      die: 'You flick the lighter. The gas explodes and throws you against the railing. You are killed in the blast.',
      res() { return { why: "The lighter didn't light; it only clicked. The neighbor from the third floor saw you with a lighter in a stairwell full of gas, screamed and ran to the gas station. The gas man shut off the gas for the whole block.", e: 'gasOff', seen: 'The neighbor saw you trying to light a flame in a stairwell full of gas. Now she tells everyone you wanted to blow up the building.' }; } },
    grp: { lbl: 'Climb the fence and breathe the gas by the valve',
      off: S => S.gasman ? "The gas man is awake and won't let you near the valve again." : null,
      die: 'You climb over the fence and sit down by the leaking valve. A few minutes later you lose consciousness and never come round.',
      res() { return { why: 'The gas man came out for a smoke, saw you by the valve and dragged you outside the fence. You came to on the grass.', e: 'gasman', seen: 'The gas man saw you climb to the valve on purpose. "Are you out of your mind?" Then he asked what you needed.' }; } },
    pit: { lbl: 'Jump into the pit with Danya',
      off: S => { const p = danyaPhase(S); return p === 'draining' ? 'The pump is already draining the water.' : p === 'mchsComing' ? 'The rescue truck is already on its way here.' : null; },
      die: "You jump into the pit. The water is icy, your feet sink into the clay, the walls are slippery. You can't get out. You choke and drown.",
      res() { return { why: 'The site watchman woke at the noise and switched on the pump. The water began to drain, and you stood up on the bottom next to Danya.', e: 'pump', seen: 'Danya saw you jump and go under. "I thought you drowned," he says.' }; } },
    lock: { lbl: 'Jump into the lock chamber',
      off: S => S.jam ? "The water in the chamber is knee-deep; you can't drown here." : null,
      die: 'You jump into the lock chamber. The current drags you to the gate and pins you against the grille. You drown.',
      res() { return { why: 'The lock keeper saw you jump and opened the emergency release. The water was gone in a minute. The change in level jammed the drawbridge.', e: 'lock', seen: 'The lock keeper saw you jump. He swears: "The bridge won\'t come down now till morning. Because of you."' }; } },
    crew: { lbl: "Throw myself under the repair crew's truck",
      off: S => S.crew ? 'The repair crew has already left for another breakdown.' : null,
      die: "You step into the road in front of the truck. The driver can't brake in time. You are hit and killed.",
      res() { return { why: 'The driver had started braking early. Just then the radio ordered him to turn around and go to another breakdown. The truck stopped a meter from you.', e: 'crew', seen: 'The driver saw you throw yourself under the wheels. He swore for a long time, then turned around and drove off.' }; } },
    sub: { lbl: 'Grab a live busbar',
      off: S => !gridOn(S, S.t) ? "The substation is already off; there's no current." : null,
      die: 'You crawl into the cable duct and grab the busbar. You are electrocuted.',
      res() { return { why: 'At that same second the duty engineer switched off the substation. He had decided to start the repairs early so he could go home early. The current was gone.', e: 'subEarly', seen: null }; } },
    poison: { lbl: 'Drink from the unlabeled bottle',
      die: "It's antifreeze. A few minutes later you fall to the floor and die of poisoning.",
      res(S) { return S.truck.awake ? { why: 'The rescuers were nearby and revived you again.', e: null, seen: 'The paramedic recognized you: "You again?"' } : { why: 'A minute later a rescue truck stopped at the gate; the crew was coming back from a call. The paramedic heard you wheezing and revived you.', e: 'mchsAvto', seen: "The rescuers saw that you drank antifreeze. The commander asks why, and waits for what you'll say." }; } },
    freeze: { lbl: 'Shut myself in the cold room',
      off: S => S.loaders ? "The refrigerators are broken; it's warm in the cold room." : null,
      die: "You walk into the cold room and close the door. It's twenty-eight below in there. Half an hour later you fall asleep and freeze to death.",
      res() { return { why: 'Ten minutes later the refrigerators at the market broke down. The watchman woke the loaders, and they opened the cold room.', e: 'loaders', seen: 'The loaders found you in the cold room and pulled you out. Nobody understood why you went in there.' }; } },
    heart: { lbl: 'Run around the building until my heart stops',
      off: S => S.heart ? "Vera won't let you run anymore." : null,
      die: 'You run lap after lap. On the third lap your heart stops. You fall by the sandbox and die.',
      res() { return { why: 'Vera saw you fall. She worked on an ambulance for thirty years. She ran over and did chest compressions until you started breathing.', e: 'heart', seen: 'Vera revived you. "What are you doing, Andrei? All right, we\'ll talk later. Let\'s go get Danya; I\'ll help pull."' }; } }
  };
  const DEATH_AT = { roof: 'roof', lighter: 'misha', grp: 'grp', pit: 'stroika', lock: 'shluz', crew: 'most', sub: 'podst', poison: 'avto', freeze: 'rynok', heart: 'dvor' };

  // ---------- описания мест (зависят от состояния)
  function descr(S) {
    const T = S.truck, ph = danyaPhase(S);
    let x;
    switch (S.loc) {
      case 'dvor':
        x = 'The yard of your building, one in the morning.';
        if (S.heart) x += S.t < S.veraAt ? ' Vera has gone to the building site.' : '';
        else if (S.danya.st === 'saved') x += ' Vera has gone to Danya at the building site.';
        else if (S.danya.st === 'dead') x += ' Vera sits on the bench and looks at no one.';
        else x += ' Your neighbor Vera is sitting on the bench. Her son Danya, seven years old, left home and has gone missing.';
        break;
      case 'misha':
        x = 'The five-story block where your friend Vitka lives.';
        if (S.misha.st === 'saved') x += " It doesn't smell of gas anymore. Vitka is sitting on the bench by the entrance, coughing.";
        else if (S.misha.st === 'dead') x += ' An ambulance stands by the entrance. Vitka could not be saved.';
        else x += ' The stairwell smells of gas. Vitka works at the open-pit mine. After two shifts in a row he locks himself in and sleeps so hard nothing will wake him.';
        break;
      case 'roof': x = "The roof of Vitka's building. From here you can see the building site and the river, and on the far bank the hospital and the substation."; break;
      case 'rynok': x = 'The covered market. The watchman is smoking at the gate.' + (S.loaders ? ' The loaders are carrying crates out of the broken refrigerators.' : ''); break;
      case 'grp': x = 'The gas station behind a wire fence. The gas for the block is shut off from here; the valves are sealed.' + (S.gasman ? ' The gas man is awake, sitting on the step.' : ' The duty gas man is asleep in his booth.'); break;
      case 'stroika':
        x = 'The building site, a pit about four meters deep.';
        x += { danger: " There's water in the pit. Danya stands chest-deep in it, holding on to the rebar. The water is rising.",
               draining: ' The pump is running; the water in the pit is draining. Danya is holding on to the rebar.',
               mchsComing: ' Danya stands chest-deep in the water. The rescue truck is on its way.',
               mchs: ' The rescuers are lowering a ladder into the pit.',
               pulling: " You're pulling Danya out.",
               saved: ' Danya is sitting by the site trailer, wrapped in a jacket.',
               dead: ' The pit is full of water. Danya could not be saved.' }[ph];
        if (S.loadersAtPit && S.danya.st === 'danger') x += ' The loaders are waiting at the edge.';
        if (S.heart && S.t >= S.veraAt) x += S.danya.st === 'saved' ? ' Vera is sitting next to Danya.' : ' Vera is standing at the edge.';
        break;
      case 'most': x = 'The drawbridge over the river.' + (S.jam ? " It's stuck raised; you can't cross." : (S.t >= CREW_FROM && S.t < 180 && !S.crew) ? ' A power company truck is crossing the bridge; the repair crew is heading for the substation.' : ' At night there is nobody here.'); break;
      case 'shluz': x = 'The lock on the river. You can cross to the far bank by the footbridge over the gates. The lock keeper sits in his booth.' + (S.jam ? ' The chamber is empty.' : ''); break;
      case 'bolnica':
        x = "The hospital. In intensive care on the third floor lies Nika, Vitka's cousin. You've been friends since childhood. She breathes through a ventilator, and it runs on electricity.";
        if (S.liza.st === 'dead') x = 'The hospital. Nika has died.';
        else {
          if (S.gosha === 'work') x += ' Gosha is in the basement repairing the generator.';
          if (S.gosha === 'stay') x += ' The generator in the basement is running; Gosha is with it.';
          if (T.gen) x += " The rescue service's generator is running in the yard.";
          if (!gridOn(S, S.t) && !powered(S, S.t)) x += ' There is no power.';
        }
        break;
      case 'mchs': x = 'The rescue base.' + (T.awake ? (T.loc === 'mchs' ? ' The truck is at the gate.' : ' The truck is out on a call.') : ' The gates are closed; the duty officer is dozing by the window.'); break;
      case 'avto':
        x = 'The garage.';
        if (S.gosha === 'sleep') x += S.know.gosha ? ' Gosha the mechanic is asleep in the back room.' : ' Snoring comes from the back room.';
        x += ' An unlabeled bottle stands on the workbench.';
        break;
      case 'podst': x = 'The substation. The whole far bank gets its power from it, the hospital too.' + (!gridOn(S, S.t) ? " It's switched off now." : ''); break;
    }
    if (T.awake && T.loc === S.loc && S.loc !== 'mchs') x += S.t < T.busy ? ' The rescue truck is here; the crew is at work.' : ' The rescue truck is parked here; the crew is waiting.';
    if (S.gosha === 'follow') x += ' Gosha is with you.';
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
    const death = k => { const d = DEATHS[k]; A.push({ id: 'die:' + k, lbl: d.lbl, min: 15, kind: 'die', off: S.cop ? "The police officer follows you everywhere. You can't do anything like that in front of him." : d.off ? d.off(S) : null }); };
    const goshaHere = S.gosha === 'follow';
    const mDanger = S.misha.st === 'danger', dDanger = S.danya.st === 'danger', lDanger = S.liza.st === 'danger';
    switch (L) {
      case 'dvor':
        if (!S.heart && S.danya.st !== 'dead') clue('vera', 'Talk to Vera', dDanger
          ? '"Andrei, Danya\'s missing! Kolka said he climbed into the building site after a kitten, and there\'s a pit full of water there. I can\'t get there, my legs won\'t carry me. Get a rope from the watchman at the market, he has one." Then she adds: "And stop by Vitka\'s. His neighbor called; their stairwell smells of gas."'
          : '"Thank you." Vera gets ready to go to her son at the building site.', dDanger ? 'rope' : null);
        death('heart'); break;
      case 'misha':
        if (mDanger) clue('door', "Ring Vitka's doorbell", 'You ring and knock; nobody opens. Gas smells from under the door. The door is steel, bolted from inside. A neighbor comes down from upstairs: "He\'s off a shift, asleep. I called the gas company, it\'s an answering machine. A door like that you can only open with a crowbar. There\'s a crowbar by the trailer at the building site, I saw it."', 'lom');
        if (mDanger && (K.lom || S.inv.lom)) act('lom-door', 'Pry the door open with the crowbar', 15, !S.inv.lom ? "You can't open this door without a crowbar. There's one by the trailer at the building site." : null);
        death('lighter'); break;
      case 'roof':
        clue('roof', 'Look down', S.leak && mDanger ? 'Neighbors in bathrobes stand by the entrance arguing about who will call the rescue service. At the building site water glints in the pit. On the far bank the hospital is lit.' : "It's quiet below. At the building site water glints in the pit; on the far bank the hospital is lit.");
        death('roof'); break;
      case 'rynok':
        if (dDanger) clue('rynokguard', 'Talk to the watchman', '"A kid in the pit? Take the rope, it\'s hanging on that nail." About the loaders he says: "They come in at six. If the refrigerators break down, I\'ll call them earlier; otherwise everyone\'s asleep."', 'rope');
        if (dDanger && K.rope && !S.inv.rope) ask('rope', 'Take the rope', 5, 'The watchman puts the rope away: "Get out of here. People say all kinds of things about you."');
        if (S.loaders && !S.loadersAtPit && dDanger && ph !== 'mchs') ask('loaders-go', 'Call the loaders to the pit', 5, "The loaders turn away. They've already heard about you.");
        death('freeze'); break;
      case 'grp':
        if (!S.gasman) clue('grpknock', "Knock on the gas man's booth", "The booth is locked from inside. The gas man is asleep with headphones on and doesn't hear you knocking. Without him you can't shut off the gas. The valves are sealed, and you don't know which one goes where.");
        if (S.gasman && mDanger && S.leak) ask('riser', "Ask the gas man to shut off the gas in Vitka's building", 10, null);
        death('grp'); break;
      case 'stroika':
        if (ph === 'danger' || ph === 'mchsComing') clue('pit', 'Talk to Danya', '"Danya, I\'m here!" "Uncle Andrei, it\'s cold in here. I didn\'t find the kitten." Water seeps from an old pipe on the river side and keeps rising. By 03:40 it will be over his head. You try to reach him, but the walls are slippery, and you start sliding in yourself. With a rope and two people it can be done: one goes down, the other holds. The watchman is asleep drunk in the trailer; there\'s no waking him.', 'rope');
        if (ph === 'draining') clue('pit2', 'Talk to Danya', '"Uncle Andrei, the water\'s going down!" The pump hums; Danya is waist-deep now.');
        if (mDanger && K.lom && !S.inv.lom) act('lom', 'Take the crowbar from by the trailer', 5);
        if ((ph === 'danger' || ph === 'draining' || ph === 'mchsComing') && (K.rope || S.inv.rope)) {
          const helper = goshaHere ? 'with Gosha' : S.loadersAtPit ? 'with the loaders' : (S.heart && S.t >= S.veraAt) ? 'with Vera' : null;
          act('pull', 'Pull Danya out with the rope' + (helper ? ' ' + helper : ''), 15,
            !S.inv.rope ? "First you need a rope. The watchman at the market has one." : !helper ? "You can't pull him out alone; you need a second person to hold the rope." : null);
        }
        if (dDanger) death('pit');
        break;
      case 'most':
        clue('most', 'Look around on the bridge', S.jam ? "The bridge is stuck raised. You can't get to the far bank from here." : "At night the bridge is empty. It's the only road from the city to the substation; there's no other.");
        if (!S.jam && S.t >= CREW_FROM && S.t < 180 && !S.crew) { act('stopcrew', S.inv.note ? 'Stop the power company truck and hand over the paper' : 'Stop the power company truck', 5); death('crew'); }
        break;
      case 'shluz':
        clue('shluz', 'Talk to the lock keeper', S.jam ? "The lock keeper doesn't want to talk to you." : '"Release the water? Not without the dispatcher\'s order. If I release it, the river drops and stops flowing into your building site. Only the bridge will jam; it\'s a drawbridge. It happened once already, in \'98."');
        death('lock'); break;
      case 'bolnica':
        clue('nurse', 'Ask the nurse about Nika',
          S.liza.st === 'dead' ? '"I\'m very sorry." The nurse looks away.'
          : (lizaSafe(S) || S.genReady !== null) ? '"We\'ll have power, don\'t worry. Nika is asleep."'
          : '"Nika is stable. Only at three in the morning they\'re switching off the substation for scheduled repairs. Our generator runs on gas and hasn\'t worked since spring. Gosha, the mechanic from the garage, promised to fix it and never came. Without power the machine will run about twenty minutes. The rescue service only lends generators in an emergency."', lDanger ? ['gosha', 'nogen'] : null);
        if (lDanger && !S.crew && !lizaSafe(S) && !S.inv.note && K.nogen && (K.crewtime || K.needpaper))
          ask('note', 'Ask the nurse to write a paper for the repair crew', 10, "The nurse has already heard about you and won't write anything.");
        if (goshaHere && S.genReady === null && lDanger) act('gen', 'Take Gosha to the generator', S.goshaSaw ? 30 : 45,
          !S.gas ? '"There\'s no gas, and the generator runs on gas. It won\'t start," says Gosha.' : null);
        break;
      case 'mchs':
        clue('mchsdesk', 'Knock for the duty officer', T.awake ? '"The truck is out on a call." The duty officer closes the window.' : 'The duty officer opens the little window: "We don\'t go out without a call from the dispatcher. Dial 112." Your phone died back in the evening. You ask to call from the base; he says it isn\'t allowed.');
        break;
      case 'avto':
        if (!K.gosha) clue('cabin', 'Look into the back room', 'In the back room a man in work overalls is asleep on an old car seat. The locker says: "Gosha."', 'gosha');
        if (K.gosha && S.gosha === 'sleep') ask('gosha', 'Wake Gosha the mechanic', 5, 'Gosha looks at you from the back room and doesn\'t come out: "The things they say about you... No, Andryukha, I\'m not going anywhere with you."');
        death('poison'); break;
      case 'podst':
        clue('podst', 'Read the notice on the gate', '"Scheduled outage 03:00 to 05:00." Below, by hand: "Crew leaves the city at 02:15." The grille of the cable duct is bent back.', 'crewtime');
        death('sub'); break;
    }
    if (T.awake && T.loc === L) {
      const idle = S.t >= T.busy;
      if (!T.gen && !T.genOrdered && lDanger && !lizaSafe(S)) { const tt = vehicle(S, L, 'bolnica'); act('mchs-gen', 'Ask the rescuers to take a generator to the hospital', 5, !idle ? 'The crew is busy.' : tt === null ? "The bridge is jammed; the truck can't get to the far bank." : null); }
      if (!T.pit && dDanger && ph !== 'pulling') { const tt = vehicle(S, L, 'stroika'); act('mchs-pit', 'Ask the rescuers to get Danya out of the pit', 5, !idle ? 'The crew is busy.' : tt === null ? "The bridge is jammed; the truck can't get to the far bank." : null); }
    }
    act('wait', 'Wait 15 minutes', 15, null);
    act('dawn', 'Wait until morning', 0, null);
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
      S.last = { title: a.lbl, text: (a.min > 5 ? 'At first they look at you for a long time in silence. ' : '') + a.txt, cls: 'clue' }; advance(S, a.min); return { kind: 'clue' };
    }
    if (a.kind === 'die') {
      const k = id.slice(4), d = DEATHS[k], r = d.res(S);
      S.deaths++; const at = S.t;
      const seen = []; if (r.seen) seen.push(r.seen);
      if (S.gosha === 'follow') {
        if (!S.goshaSaw) { S.goshaSaw = true; S.wit.push('Gosha'); seen.push('Gosha saw you do it on purpose and saw you get saved. "Andryukha, did you know that would happen?" You don\'t answer. Gosha stops arguing and hurries. Now he\'ll fix the generator in half an hour.'); }
        else { S.gosha = 'gone'; seen.push('For the second time Gosha sees you walk into death on purpose and get saved. "I\'m not going anywhere with you again." He goes home.'); log(S, 'Gosha went home.', 'x'); }
      }
      log(S, '✝ You died. From here on you live in the world where you got lucky.', 'x');
      if (r.e) { addEdit(S, r.e); log(S, '✦ ' + EDITS[r.e].t + '. Talk +' + EDITS[r.e].c + '.', 'a'); }
      else log(S, 'What saved you was already in the world. Nothing new appeared.', 'g');
      advance(S, 15);
      if (S.cop && !S.copDone) { S.copDone = true; seen.push('Ten minutes later the local police officer arrives. Three people have called him already. For half an hour he questions you about what is going on, and after that he never leaves your side.'); advance(S, 30); }
      return { kind: 'die', d, r, at, seen };
    }
    const T = S.truck;
    const done = (title, text) => { S.last = { title, text, cls: 'act' }; };
    switch (id) {
      case 'lom-door': S.ev.push({ at: S.t + 15, type: 'door' }); done('The door', 'You work the crowbar under the bolt. On the third try the door gives. The apartment is full of gas; Vitka is asleep on the couch. You shut off the gas at the stove, open the windows and carry Vitka out to the stairs.'); advance(S, 15); return { kind: 'act' };
      case 'rope': S.inv.rope = true; done('The rope', 'The watchman gives you a coil of rope, about fifteen meters.'); break;
      case 'lom': S.inv.lom = true; done('The crowbar', "The crowbar is lying by the trailer. The watchman is asleep and hears nothing."); break;
      case 'loaders-go': S.loadersAtPit = true; done('The loaders', "The loaders put down the crates and head for the building site. They'll wait at the pit."); break;
      case 'riser': S.ev.push({ at: S.t + a.min, type: 'riser' }); done('The gas', "The gas man goes with you to Vitka's building and shuts the valve on the riser in the basement. There's no more gas in Vitka's building; the rest of the block still has it."); advance(S, a.min); return { kind: 'act' };
      case 'pull': { const who = S.gosha === 'follow' ? 'Gosha' : S.loadersAtPit ? 'the loaders' : 'Vera'; S.pulling = true; S.ev.push({ at: S.t + 15, type: 'pull' }); done('The pit', 'You tie the rope around yourself and go down into the water. Danya grabs hold of you. Up top, ' + who + ' hauls on the rope. Ten minutes later you are both out.'); advance(S, 15); return { kind: 'act' }; }
      case 'gosha': S.gosha = 'follow'; done('Gosha', 'You wake Gosha and explain about the generator. "At the hospital? Your Nika\'s there? All right, let\'s go. Only don\'t run, I\'ve got a bad knee." Gosha comes with you.'); break;
      case 'gen': { const m = S.goshaSaw ? 30 : 45; S.gosha = 'work'; S.genReady = S.t + m; S.ev.push({ at: S.t + m, type: 'gen' }); done('The generator', 'Gosha looks the generator over. "The valve\'s burned out. I\'ll take one off my own car; that\'s ' + (S.goshaSaw ? 'half an hour' : 'forty-five minutes or so') + '. I\'ll stay here, just in case." The generator will be running at ' + hm(S.genReady) + '.'); advance(S, 5); return { kind: 'act' }; }
      case 'mchs-gen': { const tt = vehicle(S, S.loc, 'bolnica'); T.loc = 'bolnica'; T.busy = S.t + tt + 15; T.genOrdered = true; S.ev.push({ at: S.t + tt + 10, type: 'mchsGen' }); done('Rescuers', "The rescuers are driving to the hospital with a generator. They'll hook it up at " + hm(S.t + tt + 10) + '.'); break; }
      case 'mchs-pit': { const tt = vehicle(S, S.loc, 'stroika'); T.loc = 'stroika'; T.pit = true; T.pitAt = S.t + tt; T.busy = S.t + tt + 10; S.ev.push({ at: S.t + tt + 10, type: 'pitRescue' }); done('Rescuers', "The rescuers are driving to the building site. They'll get Danya out at " + hm(S.t + tt + 10) + '.'); break; }
      case 'note': S.inv.note = true; done('The paper', "At first the nurse doesn't understand why. Then she writes on a form: 'No backup power, patient on ventilator. The substation must not be switched off.' The doctor on duty stamps it."); advance(S, a.min); return { kind: 'act' };
      case 'stopcrew':
        if (S.inv.note) { S.crew = true; S.inv.note = false; done('The repair crew', 'You wave your arms, and the truck stops. The driver reads the paper, sighs and calls the dispatcher. "All right. Canceled. We\'re off to another breakdown." There will be no outage at three.'); log(S, "The repair crew was turned back by the hospital's paper. There will be no outage.", 'g'); }
        else { S.know.needpaper = true; done('The repair crew', 'You wave your arms, and the truck stops. You explain about the hospital. The driver shakes his head: "I\'ve got a work order. Let the hospital write a paper, then I\'ll call the dispatcher. Otherwise I can\'t." He drives off to the substation.'); }
        advance(S, a.min); return { kind: 'act' };
      case 'wait': done('Waiting', 'You wait fifteen minutes.'); advance(S, 15); return { kind: 'act' };
      case 'dawn': advance(S, DAWN - S.t); return { kind: 'act' };
    }
    advance(S, a.min);
    return { kind: 'act' };
  }

  root.G = { rep, CREW_FROM, T0, DAWN, LOC, EDGES, EDITS, DEATHS, DEATH_AT, fresh, list, moves, apply, descr, dist, path, hm, powered, gridOn, lizaSafe, vehicle, danyaPhase };
})(typeof window !== 'undefined' ? window : globalThis);
