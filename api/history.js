const { readCronRuns, sendJson } = require("./_lib");

module.exports = async function handler(req, res) {
  const limit = Math.max(1, Math.min(50, Number(req.query.limit || 12)));
  sendJson(res, {
    recent_runs: readCronRuns(limit),
    storage: "serverless_tmp_runtime",
    note: "외부 DB 없이 Vercel /tmp에 저장한다. 콜드 스타트 후에는 비어 있을 수 있다."
  });
};
