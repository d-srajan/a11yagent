import { describe, expect, it } from "vitest";
import { classifyAddress, unmapIPv4 } from "./ipRanges.js";
import { checkUrl, SsrfError, type Resolver } from "./ssrfGuard.js";

const resolveTo =
  (...addresses: string[]): Resolver =>
  () =>
    Promise.resolve(addresses);

async function reasonFor(url: string, options: Parameters<typeof checkUrl>[1] = {}): Promise<string> {
  try {
    await checkUrl(url, { resolve: resolveTo("93.184.215.14"), ...options });
    return "allowed";
  } catch (err) {
    if (err instanceof SsrfError) return err.reason;
    throw err;
  }
}

describe("classifyAddress", () => {
  it.each([
    ["0.0.0.0", "0.0.0.0/8"],
    ["10.0.0.1", "10.0.0.0/8"],
    ["10.255.255.255", "10.0.0.0/8"],
    ["100.64.0.1", "100.64.0.0/10"],
    ["100.127.255.254", "100.64.0.0/10"],
    ["127.0.0.1", "127.0.0.0/8"],
    ["127.1.2.3", "127.0.0.0/8"],
    ["169.254.169.254", "169.254.0.0/16"],
    ["172.16.0.1", "172.16.0.0/12"],
    ["172.31.255.255", "172.16.0.0/12"],
    ["192.168.1.1", "192.168.0.0/16"],
    ["224.0.0.1", "224.0.0.0/4"],
    ["239.255.255.250", "224.0.0.0/4"],
    ["255.255.255.255", "240.0.0.0/4"],
    ["::1", "::1"],
    ["::", "(::)"],
    ["fc00::1", "fc00::/7"],
    ["fd12:3456:789a::1", "fc00::/7"],
    ["fe80::1", "fe80::/10"],
    ["fe80::1%en0", "fe80::/10"],
    ["ff02::1", "ff00::/8"],
    ["64:ff9b::a00:1", "64:ff9b::/96"],
  ])("blocks %s (%s)", (ip, rangeText) => {
    const verdict = classifyAddress(ip);
    expect(verdict.blocked).toBe(true);
    if (verdict.blocked) expect(verdict.label).toContain(rangeText);
  });

  it.each(["93.184.215.14", "8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700::1111"])("allows public %s", (ip) => {
    expect(classifyAddress(ip).blocked).toBe(false);
  });

  it("judges IPv4-mapped IPv6 as the IPv4 address it reaches", () => {
    expect(unmapIPv4("::ffff:127.0.0.1")).toBe("127.0.0.1");
    expect(unmapIPv4("::ffff:a9fe:a9fe")).toBe("169.254.169.254");
    expect(unmapIPv4("0:0:0:0:0:ffff:a00:1")).toBe("10.0.0.1");
    expect(classifyAddress("::ffff:169.254.169.254").blocked).toBe(true);
    expect(classifyAddress("::ffff:8.8.8.8").blocked).toBe(false);
  });

  it("blocks anything that is not an IP address", () => {
    expect(classifyAddress("not-an-ip").blocked).toBe(true);
  });
});

describe("checkUrl", () => {
  it("allows a public https URL on the default port", async () => {
    expect(await reasonFor("https://example.com/")).toBe("allowed");
    expect(await reasonFor("http://example.com:80/path")).toBe("allowed");
  });

  it.each(["ftp://example.com/", "file:///etc/passwd", "javascript:alert(1)", "gopher://example.com/"])(
    "refuses the %s scheme",
    async (url) => expect(await reasonFor(url)).toBe("scheme"),
  );

  it("refuses ports other than 80 and 443", async () => {
    expect(await reasonFor("http://example.com:8080/")).toBe("port");
    expect(await reasonFor("https://example.com:22/")).toBe("port");
  });

  it("refuses URLs with embedded credentials and invalid URLs", async () => {
    expect(await reasonFor("http://user:pass@example.com/")).toBe("credentials");
    expect(await reasonFor("not a url")).toBe("invalid_url");
  });

  it.each([
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.1/",
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://[fd00::1]/",
    "http://[::ffff:10.0.0.1]/",
    "http://2130706433/", // decimal 127.0.0.1
    "http://0x7f.0.0.1/", // hex 127.0.0.1
    "http://0177.0.0.1/", // octal 127.0.0.1
  ])("refuses literal internal address %s", async (url) => {
    expect(await reasonFor(url)).toBe("blocked_address");
  });

  it("refuses a hostname that resolves to an internal address", async () => {
    expect(await reasonFor("http://localhost:3000/", { resolve: resolveTo("::1", "127.0.0.1") })).toBe("blocked_address");
    expect(await reasonFor("http://metadata.internal/", { resolve: resolveTo("169.254.169.254") })).toBe("blocked_address");
  });

  it("refuses when ANY resolved address is internal", async () => {
    expect(await reasonFor("http://mixed.example/", { resolve: resolveTo("93.184.215.14", "10.0.0.5") })).toBe("blocked_address");
  });

  it("refuses hosts that do not resolve", async () => {
    expect(await reasonFor("http://nope.invalid/", { resolve: () => Promise.reject(new Error("ENOTFOUND")) })).toBe("dns");
    expect(await reasonFor("http://empty.example/", { resolve: resolveTo() })).toBe("dns");
  });

  it("gives a clear message naming the address and the range", async () => {
    await expect(checkUrl("http://169.254.169.254/")).rejects.toThrow(/169\.254\.169\.254 is a link-local/);
  });

  describe("allowLocal", () => {
    it("lets 127.0.0.1 through on any port", async () => {
      expect(await reasonFor("http://127.0.0.1:4173/", { allowLocal: true })).toBe("allowed");
    });

    it("still refuses every other internal address", async () => {
      expect(await reasonFor("http://127.0.0.2/", { allowLocal: true })).toBe("blocked_address");
      expect(await reasonFor("http://[::1]:4173/", { allowLocal: true })).toBe("blocked_address");
      expect(await reasonFor("http://10.0.0.1/", { allowLocal: true })).toBe("blocked_address");
      expect(await reasonFor("http://169.254.169.254/", { allowLocal: true })).toBe("blocked_address");
      expect(await reasonFor("http://localhost:4173/", { allowLocal: true, resolve: resolveTo("::1", "127.0.0.1") })).toBe(
        "blocked_address",
      );
    });

    it("does not relax the port rule for public hosts", async () => {
      expect(await reasonFor("http://example.com:8080/", { allowLocal: true })).toBe("port");
    });
  });
});
