const { buildBriefing, sendJson } = require("./_lib");

module.exports = async function handler(req, res) {
  const session = String(req.query.session || "vercel_live");
  sendJson(res, await buildBriefing(session, true));
};
