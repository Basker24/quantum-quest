// node solve.js <максимум смертей> <все живы: 1|0>
require(require('path').join(__dirname, 'core.js'));
const G = globalThis.G;
const MAXD = +process.argv[2] || 0, ALL = process.argv[3] === '1';
const clone = S => JSON.parse(JSON.stringify(S));
const key = S => [S.t, S.loc, +S.inv.rope, +S.inv.lom, S.edits.slice().sort().join(','), +S.gas, +S.riser, +S.jam, +S.crew, +S.subEarly,
  +S.truck.awake, S.truck.loc, S.truck.busy, +S.truck.gen, +S.truck.pit, +!!S.truck.genOrdered, S.gosha, S.genReady, +S.loadersAtPit, S.drainAt,
  Object.keys(S.know).filter(k=>!k.startsWith('c:')).sort().join(','), +S.goshaSaw, S.misha.st, S.liza.st, S.liza.unp, S.danya.st, S.ev.map(e => e.at + e.type).join(','), S.deaths].join('|');
const saved = S => (S.misha.st === 'saved') + (S.danya.st === 'saved') + ((S.liza.st === 'saved' || G.lizaSafe(S)) && S.liza.st !== 'dead');
const dead = S => (S.misha.st === 'dead') + (S.danya.st === 'dead') + (S.liza.st === 'dead');
const seen = new Set();
let best = null, n = 0;
const stack = [[G.fresh(), []]];
while (stack.length) {
  const [S, path] = stack.pop();
  const k = key(S); if (seen.has(k)) continue; seen.add(k); n++;
  if (ALL && dead(S)) continue;
  const F = clone(S); if (!F.over) G.apply(F, 'dawn');
  const sc = saved(F);
  if (!best || sc > best.sc || (sc === best.sc && (F.N < best.N || (F.N === best.N && F.deaths < best.d))))
    best = { sc, N: F.N, d: F.deaths, path, who: ['misha', 'liza', 'danya'].map(x => x + ':' + F[x].st).join(' ') };
  if (S.over) continue;
  const ids = G.moves(S).map(m => 'go:' + m.to).concat(G.list(S).filter(a => !a.off && !(a.kind === 'clue' && !(a.learn && !S.know[a.learn])) && a.id !== 'dawn' && !(a.kind === 'die' && S.deaths >= MAXD)).map(a => a.id));
  for (const id of ids) { const X = clone(S); if (G.apply(X, id)) stack.push([X, path.concat([G.hm(S.t) + ' ' + id])]); }
}
console.log('смертей ≤', MAXD, ALL ? '(только все живы)' : '', '· состояний', n);
console.log('лучшее: спасено', best.sc, '· Н', best.N, '· смертей', best.d, '·', best.who);
console.log('  ' + best.path.join('\n  '));
