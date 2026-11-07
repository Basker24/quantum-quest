// node solve2.js <цели через запятую: misha,liza,danya> <макс. смертей> [запрещённые смерти через запятую]
// Ищет путь, где все цели живы к утру, с минимальной невероятностью, потом с минимумом смертей.
require(require('path').join(__dirname, 'core.js'));
const G = globalThis.G;
const goals = process.argv[2].split(','), MAXD = +process.argv[3], BAN = (process.argv[4] || '').split(',').filter(Boolean), BANACT = (process.env.BANACT || '').split(',').filter(Boolean);
const clone = S => JSON.parse(JSON.stringify(S));
const key = S => [S.t, S.loc, +S.inv.rope, +S.inv.lom, +S.inv.note, +S.cop, +S.copDone, S.edits.slice().sort().join(','), +S.gas, +S.leak, +S.jam, +S.crew, +S.subEarly,
  +S.truck.awake, S.truck.loc, S.truck.busy, +S.truck.gen, +S.truck.pit, +S.truck.genOrdered, S.gosha, S.genReady, +S.loadersAtPit, S.drainAt, +S.pulling,
  Object.keys(S.know).filter(k => !k.startsWith('c:')).sort().join(','), +S.goshaSaw, S.veraAt, S.misha.st, S.liza.st, S.liza.unp, S.danya.st,
  S.ev.map(e => e.at + e.type).join(','), S.deaths].join('|');
const ok = (S, k) => k === 'liza' ? S.liza.st === 'saved' || (S.liza.st === 'danger' && G.lizaSafe(S)) : S[k].st === 'saved';
const seen = new Set(); let best = null, n = 0;
const stack = [[G.fresh(), []]];
while (stack.length) {
  const [S, path] = stack.pop();
  const k = key(S); if (seen.has(k)) continue; seen.add(k); n++;
  if (goals.some(g => S[g].st === 'dead')) continue;
  if (best && (S.N > best.N || (S.N === best.N && S.deaths >= best.d))) continue;
  const F = clone(S); if (!F.over) G.apply(F, 'dawn');
  if (goals.every(g => ok(F, g)) && (!best || F.N < best.N || (F.N === best.N && F.deaths < best.d)))
    best = { N: F.N, d: F.deaths, edits: F.edits.join(','), path, who: ['misha', 'liza', 'danya'].map(x => x + ':' + F[x].st).join(' ') };
  if (S.over) continue;
  const ids = G.moves(S).map(m => 'go:' + m.to).concat(G.list(S).filter(a => !a.off && !(a.kind === 'clue' && !(a.learn && a.fresh)) && a.id !== 'dawn' && !BANACT.includes(a.id)
    && !(a.kind === 'die' && (S.deaths >= MAXD || BAN.includes(a.id.slice(4))))).map(a => a.id));
  for (const id of ids) { const X = clone(S); if (G.apply(X, id)) stack.push([X, path.concat([G.hm(S.t) + ' ' + id])]); }
}
console.log('цели', goals.join('+'), '· смертей ≤', MAXD, BAN.length ? '· без ' + BAN : '', '· состояний', n);
console.log(best ? 'можно · Н ' + best.N + ' · смертей ' + best.d + ' · правки: ' + (best.edits || 'нет') + '\n  ' + best.path.join('\n  ') : 'НЕЛЬЗЯ');
