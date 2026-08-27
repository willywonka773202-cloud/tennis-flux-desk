const GAMMA = "https://gamma-api.polymarket.com";
const SERIES = [
  { id: 10365, league: "atp" },
  { id: 10366, league: "wta" },
];

function parseMaybe(value) {
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}
function isMatchTitle(title, slug) {
  const t = `${title} ${slug}`.toLowerCase();
  const vs = t.includes(" vs ") || t.includes(" vs. ") || slug.includes("-vs-");
  if (!vs) return false;
  return !["winner of", "end of year", "to reach", "to qualify", "how many"].some((b) => t.includes(b));
}
function pickMoneyline(markets) {
  for (const m of markets || []) {
    if (String(m.sportsMarketType || "").toLowerCase() === "moneyline") return m;
  }
  return null;
}
function normalize(event, league) {
  const title = event.title || "";
  const slug = event.slug || "";
  if (!isMatchTitle(title, slug)) return null;
  const ml = pickMoneyline(event.markets || []);
  if (!ml) return null;
  const outcomes = parseMaybe(ml.outcomes) || [];
  const prices = parseMaybe(ml.outcomePrices) || [];
  if (outcomes.length < 2 || prices.length < 2) return null;
  const p1 = Number(prices[0]);
  const p2 = Number(prices[1]);
  if (!Number.isFinite(p1)) return null;
  const bid = ml.bestBid == null ? null : Number(ml.bestBid);
  const ask = ml.bestAsk == null ? null : Number(ml.bestAsk);
  const mid = bid != null && ask != null ? (bid + ask) / 2 : p1;
  const spread = bid != null && ask != null ? Math.max(0, ask - bid) : Math.abs(1 - p1 - p2);
  return { live: Boolean(event.live), ended: Boolean(event.ended), league, title, slug: ml.slug || slug, eventSlug: slug, score: event.score || null, period: event.period || null, p1: String(outcomes[0]), p2: String(outcomes[1]), mid: Number(mid.toFixed(4)), spread: Number(spread.toFixed(4)), volume: Number(event.volume || 0), startTime: event.startTime || event.startDate || null };
}
async function fetchSeries(series) {
  const res = await fetch(`${GAMMA}/events?active=true&closed=false&limit=75&series_id=${series.id}`, { headers: { "User-Agent": "polymarket-tennis-dashboard/1.0" } });
  if (!res.ok) throw new Error(`Gamma ${series.league} HTTP ${res.status}`);
  const events = await res.json();
  return (events || []).map((e) => normalize(e, series.league)).filter(Boolean);
}
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=2, stale-while-revalidate=8");
  const t0 = Date.now();
  try {
    const parts = await Promise.all(SERIES.map(fetchSeries));
    const board = parts.flat().sort((a, b) => Number(b.live) - Number(a.live) || b.volume - a.volume);
    res.status(200).json({ ok: true, ms: Date.now() - t0, live: board.filter((m) => m.live).length, count: board.length, board });
  } catch (err) {
    res.status(502).json({ ok: false, ms: Date.now() - t0, error: String(err.message || err) });
  }
};
