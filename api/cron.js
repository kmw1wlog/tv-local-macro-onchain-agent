const { appendCronRun, buildBriefing, sendJson } = require("./_lib");

module.exports = async function handler(req, res) {
  const session = String(req.query.session || "cron");
  const withQwen = String(req.query.qwen || "0") === "1";
  const briefing = await buildBriefing(session, withQwen);
  const run = {
    ran_at: new Date().toISOString(),
    session,
    summary: briefing.summary,
    horizons: briefing.horizons,
    price_levels: briefing.price_levels,
    agent_chain: briefing.agent_chain
  };
  const history = appendCronRun(run);
  sendJson(res, {
    ok: true,
    ran_at: run.ran_at,
    session,
    summary: briefing.summary,
    horizons: briefing.horizons,
    agent_chain: briefing.agent_chain,
    history
  });
};
