import type { ScanBrowser } from "./browser.js";

export interface CapturedImage {
  dataUrl: string;
  width: number;
  height: number;
}

export const MAX_IMAGE_SIDE = 512;
const CAPTURE_TIMEOUT_MS = 10_000;

// Gets an image into a form a vision model accepts (JPEG, <= 512 px) without
// a new dependency and without a separate fetch path: the image loads inside
// the guarded scan browser, so the SSRF route check and guard proxy apply to
// it and to every redirect, exactly as for page scans. Rendering also turns
// SVGs, which most vision APIs reject, into pixels.
// Returns null if the image can't be loaded (blocked, 404, not an image).
export async function captureImage(browser: ScanBrowser, src: string, maxSide = MAX_IMAGE_SIDE): Promise<CapturedImage | null> {
  const { page, context } = await browser.newPage();
  try {
    await page.setContent('<!doctype html><body style="margin:0;background:#fff"></body>');
    // src is passed as an argument (data), never spliced into HTML or code.
    const sized = page.evaluate(
      async ({ url, max }) => {
        const img = document.createElement("img");
        img.src = url;
        img.style.display = "block";
        document.body.appendChild(img);
        await img.decode();
        const w = img.naturalWidth || 300;
        const h = img.naturalHeight || 150;
        const scale = Math.min(1, max / Math.max(w, h));
        const width = Math.max(1, Math.round(w * scale));
        const height = Math.max(1, Math.round(h * scale));
        img.style.width = `${width}px`;
        img.style.height = `${height}px`;
        return { width, height };
      },
      { url: src, max: maxSide },
    )
      // A failed decode means "no image"; also keeps a late rejection after
      // the timeout from surfacing as an unhandled rejection.
      .catch(() => null);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), CAPTURE_TIMEOUT_MS);
    });
    const size = await Promise.race([sized, timeout]).finally(() => clearTimeout(timer));
    if (!size) return null;
    const jpeg = await page.locator("img").screenshot({ type: "jpeg", quality: 80, timeout: CAPTURE_TIMEOUT_MS });
    return { dataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}`, ...size };
  } catch {
    return null;
  } finally {
    await context.close().catch(() => {});
  }
}
