import "server-only";

// Shared pieces for the Open Graph / Twitter cards rendered by next/og
// (app/opengraph-image.tsx, app/product/[id]/opengraph-image.tsx).
//
// Everything here is drawn from the repo's own assets: the brand ingot mark
// (app/components/brand-logo.tsx), the fonts under /fonts, and the coin
// artwork under /public/assets. Satori (the renderer behind ImageResponse)
// needs fonts as buffers and local images as data URLs, so this module loads
// them once per server process.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const OG_SIZE = { width: 1200, height: 630 } as const;

/** Card palette — the night variant of the storefront's brand tokens. */
export const OG = {
  bg: "#0B0C0F",
  bg2: "#15171C",
  ink: "#F4EFE3",
  muted: "#A9A497",
  hairline: "rgba(244,239,227,0.12)",
  gold: "#D4AF4F",
  goldBright: "#F0D38A",
  goldDeep: "#8A6B2C",
  gain: "#5FD39A",
} as const;

const ROOT = process.cwd();
const cache = new Map<string, Promise<Buffer>>();

function file(rel: string): Promise<Buffer> {
  let p = cache.get(rel);
  if (!p) {
    p = readFile(join(ROOT, rel));
    cache.set(rel, p);
  }
  return p;
}

export async function ogFonts() {
  const [jakarta700, jakarta400, mono600, mono400] = await Promise.all([
    file("fonts/PlusJakartaSans-700.ttf"),
    file("fonts/PlusJakartaSans-400.ttf"),
    file("fonts/JetBrainsMono-600.ttf"),
    file("fonts/JetBrainsMono-400.ttf"),
  ]);
  return [
    { name: "Jakarta", data: jakarta700, weight: 700 as const, style: "normal" as const },
    { name: "Jakarta", data: jakarta400, weight: 400 as const, style: "normal" as const },
    { name: "Mono", data: mono600, weight: 600 as const, style: "normal" as const },
    { name: "Mono", data: mono400, weight: 400 as const, style: "normal" as const },
  ];
}

// Satori's rasteriser reads plain PNG/JPEG only: no WebP (the catalog format)
// and no PNGs carrying animation chunks (the prototype coin art). Everything
// is normalised to a static PNG with sharp, which ships with Next.
const pngCache = new Map<string, Promise<string>>();

async function toPngDataUrl(key: string, load: () => Promise<Buffer>, maxPx: number): Promise<string> {
  let p = pngCache.get(key);
  if (!p) {
    p = (async () => {
      const sharp = (await import("sharp")).default;
      const src = await load();
      const out = await sharp(src, { animated: false, pages: 1 })
        .resize({ width: maxPx, height: maxPx, fit: "inside", withoutEnlargement: true })
        .png({ compressionLevel: 6 })
        .toBuffer();
      return `data:image/png;base64,${out.toString("base64")}`;
    })();
    pngCache.set(key, p);
    p.catch(() => pngCache.delete(key));
  }
  return p;
}

/** A public/ asset as a static PNG data URL. */
export function assetDataUrl(rel: string, maxPx = 900): Promise<string> {
  return toPngDataUrl(`asset:${rel}`, () => file(join("public", rel)), maxPx);
}

/** A remote product image (WebP on the Rockwell bucket) as a static PNG data URL; null if unreachable. */
export async function remoteImageDataUrl(url: string, maxPx = 800): Promise<string | null> {
  try {
    return await toPngDataUrl(`url:${url}`, async () => {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: "force-cache" });
      if (!res.ok) throw new Error(`image ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }, maxPx);
  } catch (e) {
    console.error("[og] product image unavailable:", url, e instanceof Error ? e.message : e);
    return null;
  }
}

export const usd = (v: number, dp = 2) =>
  "$" + v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

/** The three rising ingots from BrandLogo, night colours. */
export function IngotMark({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <polygon points="6,41 16,41 14.6,27 7.4,27" fill={OG.goldDeep} />
      <polygon points="19,41 29,41 27.6,17 20.4,17" fill={OG.gold} />
      <polygon points="32,41 42,41 40.6,7 33.4,7" fill={OG.goldBright} />
    </svg>
  );
}

export function BrandRow({ descriptor = "METALS", scale = 1 }: { descriptor?: string; scale?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 * scale }}>
      <IngotMark size={44 * scale} />
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
        <span style={{ fontFamily: "Jakarta", fontWeight: 700, fontSize: 30 * scale, color: OG.ink, letterSpacing: -0.5 }}>Rockwell</span>
        <span style={{ fontFamily: "Mono", fontWeight: 600, fontSize: 11 * scale, color: OG.gold, letterSpacing: 4 * scale, marginTop: 4 * scale }}>{descriptor}</span>
      </div>
    </div>
  );
}

export function Chip({ children, tone = "dark" }: { children: string; tone?: "dark" | "light" }) {
  const light = tone === "light";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "8px 14px",
        borderRadius: 999,
        border: `1px solid ${light ? "rgba(122,94,39,0.35)" : OG.hairline}`,
        background: light ? "rgba(122,94,39,0.08)" : "rgba(244,239,227,0.04)",
        fontFamily: "Mono",
        fontWeight: 600,
        fontSize: 15,
        letterSpacing: 1,
        color: light ? "#7A5E27" : OG.muted,
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}

/** Live spot strip, monospace, one line. */
export function SpotStrip({ prices, live }: { prices: Record<string, number>; live: boolean }) {
  const cell = (sym: string, v: number, dp: number) => (
    <div key={sym} style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span style={{ color: OG.muted, fontSize: 15, letterSpacing: 2 }}>{sym}</span>
      <span style={{ color: OG.ink, fontSize: 21, fontWeight: 600 }}>{usd(v, dp)}</span>
    </div>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 28, fontFamily: "Mono" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 9, height: 9, borderRadius: 9, background: live ? OG.gain : OG.gold, boxShadow: `0 0 12px ${live ? OG.gain : OG.gold}` }} />
        <span style={{ color: live ? OG.gain : OG.gold, fontSize: 13, letterSpacing: 3, fontWeight: 600 }}>{live ? "LIVE SPOT" : "INDICATIVE"}</span>
      </div>
      {cell("XAU", prices.XAU, 2)}
      {cell("XAG", prices.XAG, 2)}
      {cell("XPT", prices.XPT, 2)}
    </div>
  );
}
