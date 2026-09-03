// Rockwell brand lockup — concept A "Bullion Index" from the approved logo
// canvas (artifact "Rockwell Gold Logo Concepts", 2026-08-25): three ingots
// rising like a bar chart, set beside the Space Grotesk wordmark and a
// JetBrains Mono descriptor that swaps per vertical (GOLD / SILVER / PLATINUM /
// METALS). Inline SVG so it stays crisp at every size and follows the theme.

export type BrandVariant = "day" | "night" | "auto";

const INGOTS = {
  // deep → bright gold on the day-mode bone canvas
  day: ["#8A6B2C", "#AE8A39", "#D4AF4F"],
  // reversed / night: brighter top step so it lifts off near-black
  night: ["#8A6B2C", "#D4AF4F", "#F0D38A"],
} as const;

export function BullionIndexMark({ size = 30, variant = "auto", className }: { size?: number; variant?: BrandVariant; className?: string }) {
  const fills = variant === "night" ? INGOTS.night : INGOTS.day;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
      data-variant={variant}
    >
      <polygon points="6,41 16,41 14.6,27 7.4,27" fill={fills[0]} className="brand__ingot brand__ingot--1" />
      <polygon points="19,41 29,41 27.6,17 20.4,17" fill={fills[1]} className="brand__ingot brand__ingot--2" />
      <polygon points="32,41 42,41 40.6,7 33.4,7" fill={fills[2]} className="brand__ingot brand__ingot--3" />
    </svg>
  );
}

export default function BrandLogo({
  descriptor = "METALS",
  size = 30,
  variant = "auto",
}: {
  /** GOLD · SILVER · PLATINUM · METALS (parent brand) */
  descriptor?: string;
  size?: number;
  variant?: BrandVariant;
}) {
  return (
    <span className="brand" data-variant={variant}>
      <BullionIndexMark size={size} variant={variant} className="brand__mark" />
      <span className="brand__text">
        <span className="brand__word">Rockwell</span>
        <span className="brand__desc num">{descriptor}</span>
      </span>
    </span>
  );
}
