const { readJson, registryPath, sendJson } = require("./_lib");

module.exports = async function handler(req, res) {
  sendJson(res, readJson(registryPath));
};
