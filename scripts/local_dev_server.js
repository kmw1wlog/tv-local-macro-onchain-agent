#!/usr/bin/env node

const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const root = path.join(__dirname, "..");
const publicDir = path.join(root, "public");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";

const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

function serveStatic(res, filePath) {
  if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.statusCode = 404;
    res.end("not found");
    return;
  }
  res.setHeader("content-type", mime[path.extname(filePath)] || "application/octet-stream");
  fs.createReadStream(filePath).pipe(res);
}

function wrapRes(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.send = (body) => {
    res.end(body);
  };
  res.json = (body) => {
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
  };
  return res;
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    const apiName = url.pathname.replace(/^\/api\//, "").replace(/\.js$/, "");
    const apiPath = path.join(root, "api", `${apiName}.js`);
    if (!fs.existsSync(apiPath)) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "api not found" }));
      return;
    }
    req.query = Object.fromEntries(url.searchParams.entries());
    try {
      await require(apiPath)(req, wrapRes(res));
    } catch (error) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: error.message || String(error) }));
    }
    return;
  }
  const rewrites = {
    "/": "/index.html",
    "/alt-24h": "/alt-24h.html",
  };
  const pathname = rewrites[url.pathname] || decodeURIComponent(url.pathname);
  serveStatic(res, path.join(publicDir, pathname));
}

const server = http.createServer((req, res) => {
  route(req, res);
});

server.listen(port, host, () => {
  console.log(`local dev server listening on http://${host}:${port}`);
});
