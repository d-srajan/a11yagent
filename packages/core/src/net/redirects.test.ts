import http, { type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { guardedFetch } from "./guardedFetch.js";
import { startGuardProxy, type GuardProxy } from "./guardProxy.js";
import { SsrfError } from "./ssrfGuard.js";

// A real server on 127.0.0.1 (allowed with allowLocal) that redirects to
// addresses the guard must refuse. Proves redirects are re-checked per hop.
let server: Server;
let origin = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/to-metadata") res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
    else if (req.url === "/to-loopback-alias") res.writeHead(301, { location: "http://127.0.0.2/" });
    else if (req.url === "/hop") res.writeHead(302, { location: "/ok" });
    else res.writeHead(200, { "content-type": "text/plain" });
    res.end(req.url === "/ok" ? "fine" : "");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const fetchOptions = { userAgent: "test", allowLocal: true };

describe("guardedFetch", () => {
  it("follows a safe redirect", async () => {
    const res = await guardedFetch(`${origin}/hop`, fetchOptions);
    expect(res.status).toBe(200);
    expect(res.body).toBe("fine");
  });

  it.each(["/to-metadata", "/to-loopback-alias"])("refuses a redirect from %s into a blocked range", async (path) => {
    await expect(guardedFetch(`${origin}${path}`, fetchOptions)).rejects.toBeInstanceOf(SsrfError);
  });
});

describe("guard proxy", () => {
  let proxy: GuardProxy;
  beforeAll(async () => {
    proxy = await startGuardProxy({ allowLocal: true });
  });
  afterAll(() => proxy.close());

  function viaProxy(target: string): Promise<{ status: number; location?: string | undefined }> {
    const { port } = new URL(proxy.url);
    return new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: target, method: "GET" }, (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? 0, location: res.headers.location });
      });
      req.on("error", reject);
      req.end();
    });
  }

  function connectVia(target: string): Promise<number> {
    const { port } = new URL(proxy.url);
    return new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, method: "CONNECT", path: target });
      req.on("connect", (res, socket) => {
        socket.destroy();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });
  }

  it("passes redirects back to the browser instead of following them", async () => {
    const res = await viaProxy(`${origin}/to-metadata`);
    expect(res.status).toBe(302);
    expect(res.location).toBe("http://169.254.169.254/latest/meta-data/");
  });

  it("refuses the redirect target when the browser requests it", async () => {
    expect((await viaProxy("http://169.254.169.254/latest/meta-data/")).status).toBe(403);
    expect((await viaProxy("http://10.0.0.1/")).status).toBe(403);
    expect(proxy.blocked.some((b) => b.url.includes("169.254.169.254"))).toBe(true);
  });

  it("refuses CONNECT tunnels to blocked addresses and odd ports", async () => {
    expect(await connectVia("169.254.169.254:443")).toBe(403);
    expect(await connectVia("10.0.0.1:443")).toBe(403);
    expect(await connectVia("[::1]:443")).toBe(403);
  });
});
