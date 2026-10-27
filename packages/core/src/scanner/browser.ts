import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { Logger } from "../logger.js";
import { startGuardProxy, type BlockedRequest, type GuardProxy } from "../net/guardProxy.js";
import { checkUrl, SsrfError } from "../net/ssrfGuard.js";

export const VIEWPORT = { width: 1280, height: 800 };

export interface GuardedPage {
  page: Page;
  context: BrowserContext;
  blocked: BlockedRequest[];
}

export interface ScanBrowser {
  newPage(): Promise<GuardedPage>;
  proxyBlocked(): BlockedRequest[];
  close(): Promise<void>;
}

export interface ScanBrowserOptions {
  allowLocal: boolean;
  userAgent: string;
  log: Logger;
}

// Two layers stop the browser from reaching internal addresses:
// 1. Route interception checks every request the page starts (the spec's
//    layer; gives a clean early abort and a record of what was blocked).
// 2. All traffic goes through the guard proxy, which also sees redirect hops
//    and connects only to the address it checked. Route interception alone
//    misses redirects, see guardProxy.ts.
export async function openScanBrowser(options: ScanBrowserOptions): Promise<ScanBrowser> {
  const proxy: GuardProxy = await startGuardProxy({ allowLocal: options.allowLocal });
  let browser: Browser;
  try {
    browser = await chromium.launch({
      // "<-loopback>" removes Chromium's implicit proxy bypass for localhost,
      // so even 127.0.0.1 traffic is checked by the proxy.
      proxy: { server: proxy.url, bypass: "<-loopback>" },
      args: ["--disable-quic", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
    });
  } catch (err) {
    await proxy.close();
    throw err;
  }

  const newPage = async (): Promise<GuardedPage> => {
    // Fresh context per page: no cookies, storage or cache carried over.
    const context = await browser.newContext({
      viewport: VIEWPORT,
      userAgent: options.userAgent,
      acceptDownloads: false,
      serviceWorkers: "block",
      bypassCSP: true, // lets the keyboard walk inject its transition-disabling style
    });
    const blocked: BlockedRequest[] = [];
    await context.route("**/*", async (route) => {
      const url = route.request().url();
      try {
        await checkUrl(url, { allowLocal: options.allowLocal });
        await route.continue();
      } catch (err) {
        const reason = err instanceof SsrfError ? err.message : String(err);
        blocked.push({ url, reason });
        options.log.debug("blocked browser request", { url, reason });
        await route.abort("blockedbyclient").catch(() => {});
      }
    });
    const page = await context.newPage();
    // Popups and dialogs would stall the scan; nothing on the page needs them.
    // Only popups the page opens: axe opens its own helper page in this context.
    page.on("popup", (popup) => void popup.close().catch(() => {}));
    page.on("dialog", (dialog) => void dialog.dismiss().catch(() => {}));
    page.setDefaultTimeout(30_000);
    return { page, context, blocked };
  };

  return {
    newPage,
    proxyBlocked: () => proxy.blocked,
    close: async () => {
      await browser.close().catch(() => {});
      await proxy.close();
    },
  };
}
