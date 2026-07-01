const fs = require("fs");
const path = require("path");

const INDEX_PATH = path.join(process.cwd(), "public", "data", "alt_24h_events.json");
const PUBLIC_DIR = path.join(process.cwd(), "public");

function safeText(value) {
  return String(value || "").trim();
}

function findEvent(events, symbol, eventTime) {
  const normalizedSymbol = safeText(symbol).toUpperCase();
  const normalizedTime = safeText(eventTime);
  if (!normalizedSymbol) return null;
  if (normalizedTime) {
    return events.find((event) => event.symbol === normalizedSymbol && event.event_time_utc === normalizedTime) || null;
  }
  return events.find((event) => event.symbol === normalizedSymbol) || null;
}

module.exports = function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
    const event = findEvent(index.events || [], req.query.symbol, req.query.event_time);
    if (!event) {
      return res.status(404).json({ error: "alt_24h_window_not_found" });
    }

    const relativePath = safeText(event.window_file).replace(/^\/+/, "");
    const filePath = path.join(PUBLIC_DIR, relativePath);
    if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
      return res.status(400).json({ error: "invalid_window_path" });
    }

    const bars = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return res.status(200).json({
      symbol: event.symbol,
      tf: "5m",
      source: "static_enriched_binance_cache",
      event_time: Math.floor(Date.parse(event.event_time_utc) / 1000),
      start: event.start,
      end: event.end,
      bars,
    });
  } catch (error) {
    return res.status(500).json({ error: "alt_24h_window_unavailable", detail: String(error.message || error) });
  }
};
