const { buildSeries, sendJson } = require("./_lib");

module.exports = async function handler(req, res) {
  sendJson(res, await buildSeries());
};
