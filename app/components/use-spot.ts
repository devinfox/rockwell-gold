"use client";

// Client-side accessor for the shared spot quote. One fetch per mount, cached
// at the HTTP layer, so every ticker on the page shows the same mark instead of
// a hardcoded $2,387.40 literal repeated across twelve files (audit F-05).

import { useEffect, useState } from "react";

export interface SpotView {
  prices: Record<string, number>;
  change: Record<string, number>;
  /** False when these are fallback marks rather than a market observation. */
  live: boolean;
  /** True when the observation is older than the feed's freshness window. */
  stale?: boolean;
  source: string;
}

/** True when a mark must be labelled "indicative": no feed, or a stale one. */
export function isIndicative(spot: SpotView | null): boolean {
  return !spot || !spot.live || !!spot.stale;
}

export function useSpot(): SpotView | null {
  const [spot, setSpot] = useState<SpotView | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/spot")
      .then((r) => r.json())
      .then((s) => { if (alive) setSpot(s); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  return spot;
}

/** Formats a spot mark, or an em-dash when it hasn't loaded. */
export function fmtSpot(spot: SpotView | null, symbol: string, dp = 2): string {
  const v = spot?.prices?.[symbol];
  if (!v) return "—";
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Formats the session change, or an empty string when there is no live feed. */
export function fmtChange(spot: SpotView | null, symbol: string): string {
  if (!spot?.live) return "";
  const c = spot.change?.[symbol];
  if (c === undefined || c === null) return "";
  return `${c >= 0 ? "+" : ""}${(c * 100).toFixed(2)}%`;
}

export const spotDir = (spot: SpotView | null, symbol: string): "up" | "down" =>
  (spot?.change?.[symbol] ?? 0) >= 0 ? "up" : "down";
