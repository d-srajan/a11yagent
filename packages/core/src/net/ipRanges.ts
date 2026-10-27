import { BlockList, isIPv4, isIPv6 } from "node:net";

// Every address range a public scanner must never reach. The label goes into
// the refusal message, so a user (or a reviewer reading the code) sees why.
const IPV4_RANGES: readonly [string, number, string][] = [
  ["0.0.0.0", 8, '"this network" (0.0.0.0/8)'],
  ["10.0.0.0", 8, "private (10.0.0.0/8)"],
  ["100.64.0.0", 10, "carrier-grade NAT (100.64.0.0/10)"],
  ["127.0.0.0", 8, "loopback (127.0.0.0/8)"],
  ["169.254.0.0", 16, "link-local (169.254.0.0/16, where cloud metadata services live)"],
  ["172.16.0.0", 12, "private (172.16.0.0/12)"],
  ["192.0.0.0", 24, "IETF protocol assignment (192.0.0.0/24)"],
  ["192.0.2.0", 24, "documentation (192.0.2.0/24)"],
  ["192.168.0.0", 16, "private (192.168.0.0/16)"],
  ["198.18.0.0", 15, "benchmarking (198.18.0.0/15)"],
  ["198.51.100.0", 24, "documentation (198.51.100.0/24)"],
  ["203.0.113.0", 24, "documentation (203.0.113.0/24)"],
  ["224.0.0.0", 4, "multicast (224.0.0.0/4)"],
  ["240.0.0.0", 4, "reserved or broadcast (240.0.0.0/4)"],
];

const IPV6_RANGES: readonly [string, number, string][] = [
  ["::", 128, "unspecified IPv6 (::)"],
  ["::1", 128, "IPv6 loopback (::1)"],
  ["::", 96, "IPv4-compatible IPv6 (::/96, deprecated)"],
  // Translation prefixes can wrap a private IPv4 address inside a "public-looking" IPv6 one.
  ["64:ff9b::", 96, "NAT64 (64:ff9b::/96)"],
  ["64:ff9b:1::", 48, "local NAT64 (64:ff9b:1::/48)"],
  ["2002::", 16, "6to4 (2002::/16)"],
  ["100::", 64, "discard-only (100::/64)"],
  ["2001:db8::", 32, "documentation (2001:db8::/32)"],
  ["fc00::", 7, "IPv6 unique local (fc00::/7)"],
  ["fe80::", 10, "IPv6 link-local (fe80::/10)"],
  ["ff00::", 8, "IPv6 multicast (ff00::/8)"],
];

interface Range {
  list: BlockList;
  family: "ipv4" | "ipv6";
  label: string;
}

function build(ranges: readonly [string, number, string][], family: "ipv4" | "ipv6"): Range[] {
  return ranges.map(([network, prefix, label]) => {
    const list = new BlockList();
    list.addSubnet(network, prefix, family);
    return { list, family, label };
  });
}

const RANGES: readonly Range[] = [...build(IPV4_RANGES, "ipv4"), ...build(IPV6_RANGES, "ipv6")];

// Expands an IPv6 string to its 8 hextets, including an embedded dotted quad.
function hextets(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted?.[1]) {
    const octets = dotted[1].split(".").map(Number);
    const [a = 0, b = 0, c = 0, d = 0] = octets;
    text = text.slice(0, -dotted[1].length) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const [head = "", tail] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const missing = 8 - left.length - right.length;
  if (tail === undefined ? left.length !== 8 : missing < 1) return null;
  const parts = [...left, ...Array<string>(tail === undefined ? 0 : missing).fill("0"), ...right];
  return parts.map((part) => parseInt(part, 16));
}

// ::ffff:a.b.c.d (IPv4-mapped) reaches the IPv4 address, so judge it as one.
export function unmapIPv4(ip: string): string | null {
  const h = hextets(ip);
  if (!h || h.slice(0, 5).some((x) => x !== 0) || h[5] !== 0xffff) return null;
  const [hi = 0, lo = 0] = h.slice(6);
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
}

export type AddressVerdict = { blocked: false } | { blocked: true; label: string };

// Default deny: anything that does not parse as an IP address is blocked.
export function classifyAddress(rawIp: string): AddressVerdict {
  const ip = rawIp.replace(/%.*$/, ""); // drop an IPv6 zone id such as %en0
  const mapped = isIPv6(ip) ? unmapIPv4(ip) : null;
  if (mapped) return classifyAddress(mapped);
  const family = isIPv4(ip) ? "ipv4" : isIPv6(ip) ? "ipv6" : null;
  if (!family) return { blocked: true, label: "unparseable" };
  for (const range of RANGES) {
    if (range.family === family && range.list.check(ip, family)) {
      return { blocked: true, label: range.label };
    }
  }
  return { blocked: false };
}
