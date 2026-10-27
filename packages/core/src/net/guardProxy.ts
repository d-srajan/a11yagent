import http, { type IncomingMessage, type ServerResponse } from "node:http";
import net, { type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { createGuardedLookup } from "./guardedLookup.js";
import { checkUrl, SsrfError } from "./ssrfGuard.js";

// Why a proxy, when Playwright already has route interception? Tested in
// Phase 1: page.route() is NOT called for redirect hops, so a page whose
// image 302s to an internal address would be fetched anyway. Chromium also
// does its own DNS, so a host that passed the route check could rebind before
// the connection. Sending every browser connection through this proxy fixes
// both: each hop is a new proxy request, and the proxy connects to the exact
// address it checked. See DECISIONS.md D10.

export interface BlockedRequest {
  url: string;
  reason: string;
}

export interface GuardProxy {
  url: string;
  blocked: BlockedRequest[];
  close(): Promise<void>;
}

const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-connection", "proxy-authorization", "te", "upgrade"]);

function forwardHeaders(headers: IncomingMessage["headers"]): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !HOP_BY_HOP.has(name)) out[name] = value;
  }
  return out;
}

export async function startGuardProxy(options: { allowLocal?: boolean } = {}): Promise<GuardProxy> {
  const allowLocal = options.allowLocal ?? false;
  const lookup = createGuardedLookup(allowLocal);
  const blocked: BlockedRequest[] = [];
  const sockets = new Set<Duplex>();

  const refuse = (url: string, err: unknown): string => {
    const reason = err instanceof SsrfError ? err.message : `upstream error: ${String(err)}`;
    if (err instanceof SsrfError) blocked.push({ url, reason });
    return reason;
  };

  // Plain http:// requests arrive with an absolute URL.
  const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
    const target = req.url ?? "";
    void checkUrl(target, { allowLocal })
      .then(({ url }) => {
        if (url.protocol !== "http:") throw new SsrfError("scheme", "https must use CONNECT", target);
        const upstream = http.request(
          { host: url.hostname, port: url.port || 80, path: url.pathname + url.search, method: req.method, headers: forwardHeaders(req.headers), lookup },
          (upRes) => {
            // Redirects are passed back untouched: the browser follows them by
            // sending a new request, which comes back through this proxy.
            res.writeHead(upRes.statusCode ?? 502, forwardHeaders(upRes.headers));
            upRes.pipe(res);
          },
        );
        upstream.on("error", (err) => {
          if (!res.headersSent) res.writeHead(err instanceof SsrfError ? 403 : 502);
          res.end(refuse(target, err));
        });
        req.pipe(upstream);
      })
      .catch((err: unknown) => {
        res.writeHead(err instanceof SsrfError ? 403 : 502, { "content-type": "text/plain" });
        res.end(refuse(target, err));
      });
  };

  // https:// (and ws/wss) arrive as CONNECT host:port tunnels.
  const onConnect = (req: IncomingMessage, client: Duplex, head: Buffer): void => {
    sockets.add(client);
    client.on("error", () => client.destroy());
    const target = `https://${req.url ?? ""}/`;
    void checkUrl(target, { allowLocal })
      .then(({ url }) => {
        const upstream: Socket = net.connect({ host: url.hostname.replace(/^\[|\]$/g, ""), port: Number(url.port || 443), lookup });
        sockets.add(upstream);
        let connected = false;
        upstream.on("connect", () => {
          connected = true;
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length) upstream.write(head);
          upstream.pipe(client);
          client.pipe(upstream);
        });
        upstream.on("error", (err) => {
          refuse(target, err);
          if (connected) client.destroy();
          else client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
        });
        upstream.on("close", () => client.destroy());
      })
      .catch((err: unknown) => {
        refuse(target, err);
        client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      });
  };

  const server = http.createServer(onRequest);
  server.on("connect", onConnect);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    blocked,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
