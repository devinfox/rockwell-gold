// Per-product Open Graph card: the product photo from the Rockwell bucket, the
// live cash price and premium over spot, and the custody promise. Shared
// links show the real number at the moment the crawler fetches the card.

import { ImageResponse } from "next/og";
import { findProduct, pdpFill } from "../../data/pdp-fill";
import { livePriceFor } from "../../lib/pricing/live";
import { OG, OG_SIZE, ogFonts, usd, remoteImageDataUrl, BrandRow, Chip, IngotMark } from "../../lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
// Carries the live cash price; rendered per request (see app/opengraph-image.tsx).
export const dynamic = "force-dynamic";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = findProduct(id);
  const fonts = await ogFonts();

  if (!p) {
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: OG.bg, color: OG.ink, fontFamily: "Jakarta", fontSize: 48 }}>
          Rockwell Metals
        </div>
      ),
      { ...size, fonts },
    );
  }

  const [lp, photo] = await Promise.all([livePriceFor(p), remoteImageDataUrl(p.image)]);
  const fill = pdpFill(p);
  const priced = !!lp && lp.mode !== "enquire" && fill.avail.key !== "notify" && fill.avail.key !== "out";
  const metalWord = p.metal.charAt(0).toUpperCase() + p.metal.slice(1);
  const eyebrow = priced ? (lp!.mode === "live" ? "LIVE QUOTE · SPOT-LINKED" : "DESK ASK · MELT FLOOR MONITORED") : "REQUEST A QUOTE";
  const titleSize = p.title.length > 64 ? 36 : p.title.length > 44 ? 42 : 48;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: `linear-gradient(135deg, ${OG.bg} 0%, ${OG.bg2} 100%)`,
          overflow: "hidden",
          fontFamily: "Jakarta",
        }}
      >
        <div
          style={{
            position: "absolute",
            right: -120,
            top: -100,
            width: 700,
            height: 700,
            borderRadius: 700,
            background: "radial-gradient(circle at center, rgba(212,175,79,0.26) 0%, rgba(212,175,79,0.08) 40%, rgba(11,12,15,0) 68%)",
          }}
        />

        {/* product panel */}
        <div
          style={{
            position: "absolute",
            right: 72,
            top: 75,
            width: 480,
            height: 480,
            borderRadius: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            // Product photography is shot on white; the tile is bone so the
            // photo sits in it the way it does on the storefront.
            background: "linear-gradient(160deg, #FFFFFF 0%, #F1ECE0 100%)",
            border: "1px solid rgba(212,175,79,0.45)",
            boxShadow: "0 40px 80px rgba(0,0,0,0.6), 0 0 0 6px rgba(212,175,79,0.08)",
          }}
        >
          {photo ? (
            <img src={photo} width={420} height={420} style={{ objectFit: "contain" }} />
          ) : (
            <IngotMark size={160} />
          )}
          <div style={{ position: "absolute", top: 18, left: 18, display: "flex" }}>
            <Chip tone="light">{metalWord}</Chip>
          </div>
        </div>

        {/* copy */}
        <div style={{ position: "absolute", left: 72, top: 64, width: 560, display: "flex", flexDirection: "column" }}>
          <BrandRow scale={0.86} />
          <span style={{ marginTop: 52, fontFamily: "Mono", fontWeight: 600, fontSize: 14, letterSpacing: 3, color: priced && lp!.mode === "live" ? OG.gain : OG.gold }}>{eyebrow}</span>
          <span style={{ marginTop: 14, fontSize: titleSize, fontWeight: 700, lineHeight: 1.08, letterSpacing: -1.2, color: OG.ink }}>{p.title}</span>
          <span style={{ marginTop: 10, fontFamily: "Mono", fontSize: 16, color: OG.muted, letterSpacing: 0.5 }}>{p.mint} · SKU {p.sku}</span>

          {priced ? (
            <div style={{ display: "flex", flexDirection: "column", marginTop: 34 }}>
              <span style={{ fontFamily: "Mono", fontWeight: 600, fontSize: 64, letterSpacing: -2, color: OG.goldBright, lineHeight: 1 }}>{usd(lp!.cashPrice)}</span>
              <span style={{ marginTop: 12, fontFamily: "Mono", fontSize: 17, color: OG.muted }}>
                cash price · spot {usd(lp!.spotUsed)}/oz · {lp!.premiumPct >= 0 ? "+" : ""}{(lp!.premiumPct * 100).toFixed(1)}% over metal
              </span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", marginTop: 34 }}>
              <span style={{ fontSize: 40, fontWeight: 700, color: OG.goldBright, lineHeight: 1 }}>Priced by the desk</span>
              <span style={{ marginTop: 12, fontFamily: "Mono", fontSize: 17, color: OG.muted }}>request a quote · allocated vault or insured delivery</span>
            </div>
          )}
        </div>

        <div style={{ position: "absolute", left: 72, bottom: 52, display: "flex", gap: 10 }}>
          <Chip>Allocated vault</Chip>
          <Chip>120s price lock</Chip>
          <Chip>Serial passport</Chip>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
