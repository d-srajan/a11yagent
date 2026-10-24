import { createServer, type Server } from "node:http";

// The worker's only HTTP surface (SPEC: no public endpoints except /healthz).
export function startHealthServer(port: number, lastPollAt: () => Date | null): Server {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, lastPollAt: lastPollAt()?.toISOString() ?? null }));
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(port);
  return server;
}
