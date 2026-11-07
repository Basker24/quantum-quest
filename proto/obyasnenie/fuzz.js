// Случайные ночи: проверка, что действия и тексты соответствуют состоянию.
require(require('path').join(__dirname, 'core.js'));
const G = globalThis.G;
let seed = 12345; const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const bad = new Map();
const flag = (msg, S) => { if (!bad.has(msg)) bad.set(msg, G.hm(S.t) + ' ' + S.loc + ' m:' + S.misha.st + ' l:' + S.liza.st + ' d:' + S.danya.st + ' ph:' + G.danyaPhase(S)); };
for (let run = 0; run < 20000; run++) {
  const S = G.fresh();
  for (let i = 0; i < 80 && !S.over; i++) {
    const A = G.list(S), ids = A.map(a => a.id), d = G.descr(S), ph = G.danyaPhase(S);
    if (S.danya.st !== 'danger' && ids.some(x => ['pit', 'pit2', 'pull', 'die:pit', 'rope', 'loaders-go', 'mchs-pit', 'rynokguard'].includes(x))) flag('Даня не в опасности, а действия про него есть: ' + ids.filter(x => ['pit', 'pit2', 'pull', 'die:pit', 'rope', 'loaders-go', 'mchs-pit', 'rynokguard'].includes(x)), S);
    if (ph === 'mchs' && ids.some(x => ['pit', 'pull', 'die:pit'].includes(x))) flag('МЧС уже у котлована, а действия про котлован есть', S);
    if (S.misha.st !== 'danger' && ids.some(x => ['door', 'lom-door', 'lom', 'riser'].includes(x))) flag('Миша не в опасности, а действия про него есть', S);
    if (S.liza.st === 'dead' && ids.some(x => ['gen', 'mchs-gen'].includes(x))) flag('Лиза умерла, а генератор предлагают', S);
    if (S.danya.st === 'saved' && /Даня стоит в (воде|ней)/.test(d)) flag('Даня спасён, а описание говорит, что он в воде', S);
    if (S.misha.st !== 'danger' && /В подъезде пахнет газом/.test(d)) flag('Миша спасён, а в подъезде пахнет газом', S);
    if (!S.leak && ids.includes('die:lighter') && !A.find(a => a.id === 'die:lighter').off) flag('Утечки нет, а зажигалка доступна', S);
    if (S.heart && S.loc === 'dvor' && ids.includes('vera')) flag('Вера ушла, а с ней можно говорить во дворе', S);
    const avail = A.filter(a => !a.off && a.id !== 'dawn');
    const moves = G.moves(S);
    if (rnd(3) === 0 && moves.length) G.apply(S, 'go:' + moves[rnd(moves.length)].to);
    else { const a = avail[rnd(avail.length)]; if (!G.apply(S, a.id)) flag('Действие не применилось: ' + a.id, S); }
  }
}
console.log(bad.size ? [...bad].map(([m, s]) => m + '  ←  ' + s).join('\n') : 'нарушений нет');
