// Makes the post's image: a 1080x1350 (4:5, Instagram's tallest feed size)
// JPEG with the headline, a line under it, and, for a "screenshot" post, a
// real screenshot of the product's own site in a browser frame. Rendered by
// headless Chromium (Playwright) from the HTML below, so it's sharp and the
// screenshot is always what the site really shows today.
import type { Browser } from "playwright";
import type { PostKind, Theme } from "./vault.ts";

export const WIDTH = 1080;
export const HEIGHT = 1350;

const THEME_COLORS: Record<Theme, { bg: string; bg2: string; text: string; muted: string; accent: string }> = {
  ink: { bg: "#0f172a", bg2: "#1e293b", text: "#f8fafc", muted: "#cbd5e1", accent: "#38bdf8" },
  ocean: { bg: "#0b3a53", bg2: "#0e7490", text: "#f0fdfa", muted: "#ccfbf1", accent: "#fde68a" },
  sunset: { bg: "#7c2d12", bg2: "#c2410c", text: "#fff7ed", muted: "#fed7aa", accent: "#fde047" },
  forest: { bg: "#14532d", bg2: "#166534", text: "#f0fdf4", muted: "#bbf7d0", accent: "#facc15" },
  sand: { bg: "#f5f0e6", bg2: "#e7dcc8", text: "#1c1917", muted: "#57534e", accent: "#b45309" },
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type ImageSpec = {
  kind: PostKind;
  theme: Theme;
  headline: string;
  subline: string | null;
  productName: string | null;
  /** Shown in the browser frame's address bar. */
  host: string | null;
  /** JPEG of the site, for a screenshot post. */
  screenshot?: Buffer | null;
};

export function postHtml(spec: ImageSpec): string {
  const c = THEME_COLORS[spec.theme] ?? THEME_COLORS.ink;
  const shot = spec.kind === "screenshot" && spec.screenshot ? `data:image/jpeg;base64,${spec.screenshot.toString("base64")}` : null;
  const headSize = spec.headline.length > 42 ? 76 : spec.headline.length > 26 ? 88 : 104;
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;800&display=block"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${WIDTH}px;height:${HEIGHT}px}
body{font-family:"Inter","Helvetica Neue",Arial,sans-serif;background:linear-gradient(160deg,${c.bg} 0%,${c.bg2} 100%);color:${c.text};display:flex;flex-direction:column;padding:${shot ? "88px 80px 72px" : "120px 96px 88px"}}
main{${shot ? "" : "margin:auto 0;padding-bottom:40px"}}
${shot ? "" : `main::before{content:"";display:block;width:120px;height:10px;border-radius:5px;background:${c.accent};margin-bottom:48px}`}
.kicker{font-size:30px;letter-spacing:.12em;text-transform:uppercase;color:${c.accent};font-weight:700}
h1{margin-top:28px;font-size:${shot ? headSize : headSize + 24}px;line-height:1.04;font-weight:800;letter-spacing:-.02em}
p{margin-top:28px;font-size:${shot ? 38 : 50}px;line-height:1.3;color:${c.muted};max-width:900px}
.frame{margin-top:auto;border-radius:22px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.35);background:#fff}
.bar{height:46px;background:#e5e7eb;display:flex;align-items:center;gap:10px;padding:0 18px}
.dot{width:14px;height:14px;border-radius:50%}
.url{margin-left:14px;flex:1;height:28px;border-radius:14px;background:#fff;color:#6b7280;font-size:17px;display:flex;align-items:center;padding:0 14px}
.frame img{display:block;width:100%;height:${shot ? 520 : 0}px;object-fit:cover;object-position:top}
.foot{margin-top:${shot ? "40px" : "0"};display:flex;justify-content:space-between;align-items:center;font-size:30px;color:${c.muted}}
.foot b{color:${c.text}}
.pill{border:3px solid ${c.accent};color:${c.text};border-radius:999px;padding:12px 30px;font-weight:700}
</style></head><body>
<main>
${spec.productName ? `<div class="kicker">${esc(spec.productName)}</div>` : ""}
<h1>${esc(spec.headline)}</h1>
${spec.subline ? `<p>${esc(spec.subline)}</p>` : ""}
</main>
${shot ? `<div class="frame"><div class="bar"><span class="dot" style="background:#f87171"></span><span class="dot" style="background:#fbbf24"></span><span class="dot" style="background:#34d399"></span><span class="url">${esc(spec.host ?? "")}</span></div><img src="${shot}"></div>` : ""}
<div class="foot"><span><b>${esc(spec.productName ?? "Wright AI Solutions")}</b></span><span class="pill">Link in bio</span></div>
</body></html>`;
}

export type Renderer = {
  screenshot(url: string): Promise<Buffer>;
  image(spec: ImageSpec): Promise<Buffer>;
  close(): Promise<void>;
};

export async function playwrightRenderer(): Promise<Renderer> {
  const { chromium } = await import("playwright");
  const browser: Browser = await chromium.launch();
  return {
    async screenshot(url) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1 });
      try {
        await page.goto(url, { waitUntil: "load", timeout: 45_000 });
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(1_500);
        return await page.screenshot({ type: "jpeg", quality: 85 });
      } finally {
        await page.close();
      }
    },
    async image(spec) {
      const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
      try {
        // Inter from Google Fonts, so the image looks the same on any machine.
        await page.setContent(postHtml(spec), { waitUntil: "networkidle", timeout: 30_000 }).catch(() => {});
        await page.evaluate(() => document.fonts.ready).catch(() => {});
        return await page.screenshot({ type: "jpeg", quality: 90 });
      } finally {
        await page.close();
      }
    },
    close: () => browser.close(),
  };
}
