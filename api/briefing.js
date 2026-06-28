const { buildBriefing, sendJson } = require("./_lib");

module.exports = async function handler(req, res) {
  const session = String(req.query.session || "vercel_live");
  const withQwen = String(req.query.qwen || "0") === "1";
  sendJson(res, await buildBriefing(session, withQwen));
};
