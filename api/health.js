const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
async function timed(name, fn) {
  const t0 = Date.now();
  try { const detail = await fn(); return { name, ok: true, ms: Date.now() - t0, detail, error: "" }; }
  catch (err) { return { name, ok: false, ms: Date.now() - t0, detail: "", error: String(err.message || err).slice(0, 240) }; }
}
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=5, stale-while-revalidate=15");
  const checks = await Promise.all([
    timed("gamma_events", async () => {
      const r = await fetch(`${GAMMA}/events?active=true&closed=false&limit=3&series_id=10365`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (!Array.isArray(data) || !data.length) throw new Error("0 ATP events");
      return `${data.length}+ events · ${data[0].title || data[0].slug}`;
    }),
    timed("live_scores", async () => {
      const r = await fetch(`${GAMMA}/events?active=true&closed=false&limit=40&series_id=10365`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const live = data.filter((e) => e.live);
      const scored = live.filter((e) => e.score);
      if (!live.length) return "no ATP match live now (off-hours, not an outage)";
      if (!scored.length) throw new Error(`${live.length} live matches, no score field`);
      return `${live.length} live / ${scored.length} scored · ${scored[0].score}`;
    }),
    timed("clob", async () => {
      const r = await fetch(`${CLOB}/time`);
      if (!r.ok) {
        const r2 = await fetch(`${CLOB}/`);
        if (!r2.ok) throw new Error(`CLOB ${r.status}/${r2.status}`);
        return `reachable ${r2.status}`;
      }
      return "time ok";
    })
  ]);
  const failing = checks.filter((c) => !c.ok).map((c) => c.name);
  let level = "WORKING";
  if (failing.includes("gamma_events")) level = "FAILING";
  else if (failing.length) level = "DEGRADED";
  res.status(failing.includes("gamma_events") ? 503 : 200).json({ ok: failing.length === 0, level, failing, checks, paper_only: true, live_us: false });
};
