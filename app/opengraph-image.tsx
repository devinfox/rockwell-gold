// Site-wide Open Graph card (also used by twitter-image.tsx). Rendered on the
// server from the repo's own coin artwork, brand mark and fonts, with the
// current spot marks along the bottom — so a link pasted into iMessage,
// Slack, X or LinkedIn shows a card that is never stale.

import { ImageResponse } from "next/og";
import { getSpot } from "./lib/spot";
import { OG, OG_SIZE, assetDataUrl, ogFonts, BrandRow, Chip, SpotStrip } from "./lib/og";

export const alt = "Rockwell Metals — physical gold, silver and platinum, traded like a digital asset";
export const size = OG_SIZE;
export const contentType = "image/png";
// Spot moves; the card follows it every few minutes.
export const revalidate = 300;

export default async function Image() {
  const [fonts, spot, buffalo, maple, eagle] = await Promise.all([
    ogFonts(),
    getSpot(),
    assetDataUrl("assets/coin-buffalo.png"),
    assetDataUrl("assets/coin-maple.png"),
    assetDataUrl("assets/coin-eagle-ms.png"),
  ]);

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
        {/* gold atmosphere behind the coins */}
        <div
          style={{
            position: "absolute",
            right: -140,
            top: -120,
            width: 820,
            height: 820,
            borderRadius: 820,
            background: `radial-gradient(circle at center, rgba(212,175,79,0.32) 0%, rgba(212,175,79,0.10) 38%, rgba(11,12,15,0) 68%)`,
          }}
        />
        {/* fine ledger rule along the bottom */}
        <div style={{ position: "absolute", left: 72, right: 72, bottom: 108, height: 1, background: OG.hairline }} />

        {/* coin stack */}
        <img src={eagle} width={300} height={300} style={{ position: "absolute", right: 96, top: 42, opacity: 0.55 }} />
        <img src={maple} width={300} height={300} style={{ position: "absolute", right: 318, top: 262, opacity: 0.82 }} />
        <div style={{ position: "absolute", right: 58, top: 118, width: 440, height: 440, display: "flex", borderRadius: 440, boxShadow: "0 40px 90px rgba(0,0,0,0.6)" }}>
          <img src={buffalo} width={440} height={440} />
        </div>

        {/* copy */}
        <div style={{ position: "absolute", left: 72, top: 64, display: "flex", flexDirection: "column", gap: 0, width: 500 }}>
          <BrandRow />
          <div style={{ display: "flex", flexDirection: "column", marginTop: 74, lineHeight: 1.02, letterSpacing: -2.2 }}>
            <span style={{ fontSize: 74, fontWeight: 700, color: OG.goldBright }}>Physical gold.</span>
            <span style={{ fontSize: 74, fontWeight: 700, color: OG.ink }}>Traded like a</span>
            <span style={{ fontSize: 74, fontWeight: 700, color: OG.ink }}>digital asset.</span>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 34, flexWrap: "wrap" }}>
            <Chip>Allocated vault</Chip>
            <Chip>120s price lock</Chip>
            <Chip>Serial passport</Chip>
            <Chip>Instant sell-back</Chip>
          </div>
        </div>

        {/* spot strip */}
        <div style={{ position: "absolute", left: 72, right: 72, bottom: 52, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <SpotStrip prices={spot.prices} live={spot.live && !spot.stale} />
          <span style={{ fontFamily: "Mono", fontSize: 15, letterSpacing: 2, color: OG.muted }}>ROCKWELLMETALS.COM</span>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
