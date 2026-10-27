import { readFile, stat } from "node:fs/promises";
import http, { type Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SITE_DIR = fileURLToPath(new URL("../site/", import.meta.url));
export const DEFAULT_PORT = 4173;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".json": "application/json",
};

async function resolveFile(urlPath: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const root = path.resolve(SITE_DIR);
  const file = path.resolve(root, "." + decoded);
  // Never serve anything outside the site directory (../ traversal).
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  try {
    const info = await stat(file);
    return info.isDirectory() ? path.join(file, "index.html") : file;
  } catch {
    return null;
  }
}

// A tiny static server for the Bad Bakery site. Binds to 127.0.0.1 only, so
// it is never reachable from the network.
export function startFixtureServer(port = DEFAULT_PORT): Promise<Server> {
  const server = http.createServer((req, res) => {
    void (async () => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405).end();
        return;
      }
      const urlPath = new URL(req.url ?? "/", "http://fixture.local").pathname;
      const file = await resolveFile(urlPath);
      const body = file ? await readFile(file).catch(() => null) : null;
      if (!file || !body) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
        return;
      }
      res.writeHead(200, {
        "content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(req.method === "HEAD" ? undefined : body);
    })();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
