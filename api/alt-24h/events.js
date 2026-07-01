const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(process.cwd(), "public", "data", "alt_24h_events.json");

module.exports = function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const payload = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    return res.status(200).json({
      source: payload.source,
      generated_at: payload.generated_at,
      count: payload.count,
      missing_count: payload.missing_count,
      events: payload.events || [],
    });
  } catch (error) {
    return res.status(500).json({ error: "alt_24h_events_unavailable", detail: String(error.message || error) });
  }
};
