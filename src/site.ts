// The products to post about come from Thomas's website, not the Vault
// (Thomas, 2026-11-18: "make it scan wright-ai-solutions.com instead of the
// vault for current products"). The site's "Our Services" section lists the
// products you can sign up for today; each card has a name, a sentence and a
// sign-up link. Retired products drop off the site, so they drop off here.
import type { Product } from "./vault.ts";

export const SITE_URL = () => process.env.PRODUCTS_SITE_URL?.trim() || "https://wright-ai-solutions.com/";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The product cards in the site's "Our Services" section. */
export function parseSiteProducts(html: string, base: string): Product[] {
  const start = html.search(/<section[^>]*id="our-services"/);
  if (start < 0) return [];
  const end = html.indexOf("</section>", start);
  const section = html.slice(start, end < 0 ? undefined : end);
  const out: Product[] = [];
  for (const card of section.match(/<article[^>]*class="[^"]*product-card[^"]*"[\s\S]*?<\/article>/g) ?? []) {
    const name = text(card.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1] ?? "");
    const description = text(card.match(/<p>([\s\S]*?)<\/p>/)?.[1] ?? "") || null;
    const href = card.match(/<a[^>]*href="([^"]+)"[^>]*class="[^"]*product-signup/)?.[1] ?? card.match(/<a[^>]*href="(https?:\/\/[^"]+)"/)?.[1];
    if (!name || !href) continue;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    // The product's own front page, not its sign-up form.
    if (/\/sign-?up(\.html)?\/?$/i.test(url.pathname)) url = new URL("/", url);
    out.push({ id: `site:${slug(name)}`, name, description, url: url.toString() });
  }
  return out;
}

/** The products on the site today; throws when the site can't be read or lists none. */
export async function siteProducts(fetchImpl: typeof fetch = fetch, site = SITE_URL()): Promise<Product[]> {
  const res = await fetchImpl(site, { headers: { "User-Agent": "Mozilla/5.0 (Social Media Specialist)" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${site} answered ${res.status}`);
  const products = parseSiteProducts(await res.text(), site);
  if (!products.length) throw new Error(`${site} has no product cards in its "Our Services" section`);
  return products;
}
