const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const port = Number(process.env.FRONTEND_PORT || 5174);
const backend = new URL(process.env.BACKEND_URL || "http://127.0.0.1:9000");

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

function serveFile(res, file) {
  fs.readFile(file, (error, body) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  });
}

function proxyApi(req, res) {
  const target = new URL(req.url, backend);
  const proxy = http.request(
    target,
    {
      method: req.method,
      headers: { ...req.headers, host: backend.host },
    },
    (apiRes) => {
      res.writeHead(apiRes.statusCode || 502, apiRes.headers);
      apiRes.pipe(res);
    }
  );
  proxy.on("error", () => {
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Backend unavailable");
  });
  req.pipe(proxy);
}

http
  .createServer((req, res) => {
    if (req.url && req.url.startsWith("/api/")) {
      proxyApi(req, res);
      return;
    }
    const cleanPath = decodeURIComponent((req.url || "/").split("?")[0]);
    const requested = path.normalize(path.join(dist, cleanPath));
    if (!requested.startsWith(dist)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(dist, "index.html");
    serveFile(res, file);
  })
  .listen(port, "127.0.0.1", () => {
    console.log(`Frontend ready at http://127.0.0.1:${port}`);
  });
