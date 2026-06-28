const { buildBriefing, sendJson } = require("./_lib");

module.exports = async function handler(req, res) {
  const session = String(req.query.session || "cron");
  const briefing = await buildBriefing(session, true);
  sendJson(res, {
    ok: true,
    ran_at: new Date().toISOString(),
    session,
    summary: briefing.summary,
    agent_chain: briefing.agent_chain
  });
};
