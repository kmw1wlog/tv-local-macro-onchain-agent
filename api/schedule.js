const { readCronRuns, readJson, schedulePath, sendJson } = require("./_lib");

module.exports = async function handler(req, res) {
  sendJson(res, {
    schedule: readJson(schedulePath),
    recent_runs: readCronRuns(),
    history_note: "Vercel 서버리스에서는 /tmp 런타임 히스토리만 보장된다. 영구 저장은 이후 KV/Postgres를 붙이는 단계로 남긴다."
  });
};
