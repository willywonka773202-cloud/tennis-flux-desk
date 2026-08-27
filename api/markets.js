const GAMMA = "https://gamma-api.polymarket.com";
const SERIES = [
  { id: 10365, league: "atp" },
  { id: 10366, league: "wta" },
];
function parseMaybe(value) {
  if (typeof value === "string") { try { return JSON.parse(value); } catch { return value; } }
  return value;
}
function isMatchTitle(title, slug) {
  const t = `${title} ${slug}`.toLowerCase();
  const vs = t.includes(" vs ") || t.includes(" vs. ") || slug.includes("-vs-");
  if (!vs) return false;
  return !["winner of", "end of year", "to reach", "to qualify", "how many"].some((b) => t.includes(b));
}
function isTerminal(score, period, ended) {
  if (ended) return { terminal: true, why: "ended" };
  const p = String(period || "").toUpperCase();
  if (["FT", "F", "FINAL", "ENDED"].includes(p)) return { terminal: true, why: "final" };
  if (["RET", "WO", "W/O"].includes(p)) return { terminal: true, why: "retired-or-walkover" };
  const blob = `${score || ""} ${period || ""}`;
  if (/\b(ret\.?|retired|retires|retirement|walkover|w\/o|abandoned|default)\b/i.test(blob)) return { terminal: true, why: "retired-or-walkover" };
  return { terminal: false, why: "" };
}
function pickMoneyline(markets) {
  for (const m of markets || []) if (String(m.sportsMarketType || "").toLowerCase() === "moneyline") return m;
  return null;
}
function midOf(m) {
  const prices = parseMaybe(m.outcomePrices) || [];
  const p1 = Number(prices[0]);
  const bid = m.bestBid == null ? null : Number(m.bestBid);
  const ask = m.bestAsk == null ? null : Number(m.bestAsk);
  if (bid != null && ask != null && Number.isFinite(bid) && Number.isFinite(ask)) return (bid + ask) / 2;
  return Number.isFinite(p1) ? p1 : null;
}
function pickSetWinner(markets, period) {
  const list = markets || [];
  const n = String(period || "").match(/S(\d+)/i);
  const setNo = n ? Number(n[1]) : 1;
  let chosen = null;
  for (const m of list) {
    const typ = String(m.sportsMarketType || "").toLowerCase();
    const slug = String(m.slug || "").toLowerCase();
    const q = `${m.question || ""} ${m.groupItemTitle || ""}`.toLowerCase();
    if (typ === "tennis_first_set_winner" && setNo === 1) chosen = m;
    if (typ === "tennis_set_winner" && (slug.includes(`set-${setNo}-winner`) || q.includes(`set ${setNo} winner`))) chosen = m;
  }
  if (!chosen) return null;
  const outcomes = parseMaybe(chosen.outcomes) || [];
  const mid = midOf(chosen);
  if (mid == null) return null;
  return { set: setNo, slug: chosen.slug || "", p1: String(outcomes[0] || ""), p2: String(outcomes[1] || ""), mid: Number(mid.toFixed(4)) };
}
function normalize(event, league) {
  const title = event.title || ""; const slug = event.slug || "";
  if (!isMatchTitle(title, slug)) return null;
  const ml = pickMoneyline(event.markets || []); if (!ml) return null;
  const outcomes = parseMaybe(ml.outcomes) || []; const prices = parseMaybe(ml.outcomePrices) || [];
  if (outcomes.length < 2 || prices.length < 2) return null;
  const p1 = Number(prices[0]); const p2 = Number(prices[1]); if (!Number.isFinite(p1)) return null;
  const bid = ml.bestBid == null ? null : Number(ml.bestBid);
  const ask = ml.bestAsk == null ? null : Number(ml.bestAsk);
  const mid = bid != null && ask != null ? (bid + ask) / 2 : p1;
  const spread = bid != null && ask != null ? Math.max(0, ask - bid) : Math.abs(1 - p1 - p2);
  const term = isTerminal(event.score, event.period, event.ended);
  return { live: Boolean(event.live), ended: Boolean(event.ended), terminal: term.terminal, terminalWhy: term.why, league, title, slug: ml.slug || slug, eventSlug: slug, score: event.score || null, period: event.period || null, p1: String(outcomes[0]), p2: String(outcomes[1]), mid: Number(mid.toFixed(4)), spread: Number(spread.toFixed(4)), volume: Number(event.volume || 0), startTime: event.startTime || event.startDate || null, setWinner: pickSetWinner(event.markets || [], event.period) };
}
async function fetchSeries(series) {
  const res = await fetch(`${GAMMA}/events?active=true&closed=false&limit=75&series_id=${series.id}`, { headers: { "User-Agent": "polymarket-tennis-dashboard/1.1" } });
  if (!res.ok) throw new Error(`Gamma ${series.league} HTTP ${res.status}`);
  return ((await res.json()) || []).map((e) => normalize(e, series.league)).filter(Boolean);
}
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=0, stale-while-revalidate=2");
  const t0 = Date.now();
  try {
    const parts = await Promise.all(SERIES.map(fetchSeries));
    const board = parts.flat().sort((a, b) => Number(b.live) - Number(a.live) || b.volume - a.volume);
    res.status(200).json({ ok: true, ms: Date.now() - t0, live: board.filter((m) => m.live && !m.terminal).length, count: board.length, board });
  } catch (err) {
    res.status(502).json({ ok: false, ms: Date.now() - t0, error: String(err.message || err) });
  }
};
