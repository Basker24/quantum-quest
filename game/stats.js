// Общая анонимная статистика игроков (Supabase RPC через fetch, без SDK).
// Работает только после согласия игрока (meta.analytics === true) и только если в _config.json
// заданы stats_url и stats_key. Нет сети или сервера — тихо молчит, игра не ломается.
window.QQS = (function () {
  "use strict";
  let C = null, ok = () => false, pid = null;
  const cache = {};
  function init(cfg, allowed) {
    C = cfg; ok = allowed;
    try { pid = localStorage.getItem("qq_player"); if (!pid) { pid = (crypto.randomUUID ? crypto.randomUUID() : rnd()); localStorage.setItem("qq_player", pid); } }
    catch (e) { pid = null; }
  }
  function rnd() { return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); }); }
  const on = () => !!(C && C.stats_url && C.stats_key && pid && ok());
  const readable = () => !!(C && C.stats_url && C.stats_key); // чужие цифры видит и тот, кто не разрешил отправлять свои
  async function rpc(fn, args) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
    try {
      const r = await fetch(C.stats_url.replace(/\/$/, "") + "/rest/v1/rpc/" + fn, {
        method: "POST", signal: ctl.signal,
        headers: Object.assign({ "Content-Type": "application/json", apikey: C.stats_key }, /^sb_/.test(C.stats_key) ? {} : { Authorization: "Bearer " + C.stats_key }), // новые publishable-ключи — только в apikey
        body: JSON.stringify(args || {}),
      });
      if (!r.ok) return null;
      const txt = await r.text(); return txt ? JSON.parse(txt) : null;
    } catch (e) { return null; } finally { clearTimeout(t); }
  }
  const send = (fn, args) => { if (on()) rpc(fn, Object.assign({ p: pid }, args)); };
  async function read(key, fn, args, ttl) {
    if (!readable()) return null;
    const c = cache[key]; if (c && Date.now() - c.t < (ttl || 60000)) return c.v;
    const v = await rpc(fn, args); if (v != null) cache[key] = { t: Date.now(), v }; return v;
  }
  return {
    init,
    start: () => send("qq_hit", { k: "start", key: "game" }),
    death: (id) => send("qq_hit", { k: "death", key: id }),
    choice: (scene, cid) => send("qq_hit", { k: "choice", key: scene + "/" + cid }),
    final: (id, lives, deaths) => { send("qq_hit", { k: "final", key: id }); send("qq_final", { f: id, lives, deaths }); },
    seen: (scene) => send("qq_seen", { scene }),
    counts: (k, keys) => read("c:" + k + ":" + keys.join(","), "qq_counts", { k, keys }),
    split: (scene) => read("s:" + scene, "qq_split", { scene }, 15000),
    finalStats: (f) => read("f:" + f, "qq_final_stats", { f }),
    chorus: () => read("chorus", "qq_chorus", {}),
    admin: () => read("admin", "qq_admin", {}, 5000),
    readable,
  };
})();
