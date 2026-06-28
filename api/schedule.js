const { readJson, schedulePath, sendJson } = require("./_lib");

module.exports = async function handler(req, res) {
  sendJson(res, {
    schedule: readJson(schedulePath),
    recent_runs: [
      {
        ran_at: new Date().toISOString(),
        session: "vercel_dynamic",
        note: "Vercel 배포본은 /api/briefing 호출 시 최신 공개 데이터를 읽고, Vercel Cron은 /api/cron을 정해진 장 시작 시간에 호출한다."
      }
    ]
  });
};
