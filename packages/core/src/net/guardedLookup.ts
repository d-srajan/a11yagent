import dns, { type LookupAddress, type LookupOptions } from "node:dns";
import type { LookupFunction } from "node:net";
import { blockedAddressMessage, isAddressAllowed, SsrfError } from "./ssrfGuard.js";

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

// A DNS lookup hook for Node sockets (http.request, net.connect). checkUrl()
// runs before a request, but the socket resolves the host again when it
// connects, and an attacker's DNS can answer differently the second time
// (DNS rebinding). Checking inside the socket's own lookup means the address
// we approve is the address we connect to.
// Sockets skip lookup for IP literals, so callers must still run checkUrl().
export function createGuardedLookup(allowLocal = false): LookupFunction {
  const lookup = (hostname: string, options: LookupOptions, callback: LookupCallback): void => {
    dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
      if (err) return callback(err, []);
      for (const { address } of addresses) {
        const verdict = isAddressAllowed(address, allowLocal);
        if (verdict.blocked) {
          const message = blockedAddressMessage(hostname, hostname, address, verdict.label);
          return callback(new SsrfError("blocked_address", message, hostname), []);
        }
      }
      const first = addresses[0];
      if (!first) return callback(new SsrfError("dns", `could not resolve ${hostname}`, hostname), []);
      if (options.all) return callback(null, addresses);
      callback(null, first.address, first.family);
    });
  };
  return lookup as LookupFunction;
}
