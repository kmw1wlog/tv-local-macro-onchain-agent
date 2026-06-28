const { buildBriefing, sendJson } = require("./_lib");

module.exports = async function handler(req, res) {
  const session = String(req.query.session || "cron");
  const withQwen = String(req.query.qwen || "0") === "1";
  const briefing = await buildBriefing(session, withQwen);
  sendJson(res, {
    ok: true,
    ran_at: new Date().toISOString(),
    session,
    summary: briefing.summary,
    agent_chain: briefing.agent_chain
  });
};
