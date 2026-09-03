import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Content-Security-Policy.
 *
 * script-src carries 'unsafe-inline' because the root layout injects the
 * theme-restore script inline (app/layout.tsx) and Next itself emits inline
 * bootstrap scripts. The next hardening step is a per-request nonce (generate
 * in proxy.ts, forward via the `x-nonce` header, and pass it to the inline
 * <script nonce>), after which 'unsafe-inline' can be dropped.
 *
 * In development Next needs 'unsafe-eval' (React Refresh / source maps) and a
 * WebSocket back to the dev server for HMR, so those are added only then.
 */
const CSP_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'self'"],
  "script-src": ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : [])],
  "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
  "img-src": [
    "'self'",
    "data:",
    "blob:",
    "https://*.supabase.co",
    "https://www.images-apmex.com",
    "https://images-apmex.com",
    "https://sdbullion.com",
    "https://*.sdbullion.com",
    "https://cdn.jmbullion.com",
  ],
  "connect-src": ["'self'", "https://*.supabase.co", ...(isDev ? ["ws://localhost:*", "ws://127.0.0.1:*"] : [])],
  "frame-ancestors": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "object-src": ["'none'"],
};

export const CONTENT_SECURITY_POLICY = Object.entries(CSP_DIRECTIVES)
  .map(([k, v]) => `${k} ${v.join(" ")}`)
  .join("; ");

const nextConfig: NextConfig = {
  // Nothing about the framework needs advertising in a response header.
  poweredByHeader: false,

  // products.json and the studio dataset are read with fs at runtime rather than
  // imported (see app/data/catalog.ts), so the bundler no longer traces them.
  // These entries keep them in the deployed output.
  outputFileTracingIncludes: {
    // launch-pricing.json is the live rule book; without it the engine refuses
    // to start (app/lib/pricing/live.ts), so it must ship with every function.
    "/**": ["./app/data/products.json", "./app/data/launch-pricing.json"],
    // Open Graph cards are drawn from local fonts and coin artwork (app/lib/og.tsx).
    "/opengraph-image": ["./fonts/*.ttf", "./public/assets/coin-*.png"],
    "/twitter-image": ["./fonts/*.ttf", "./public/assets/coin-*.png"],
    "/product/[id]/opengraph-image": ["./fonts/*.ttf"],
    "/product/[id]/twitter-image": ["./fonts/*.ttf"],
    "/api/catalog-batch": ["./app/data/unprocessed_jmbullion_remaining.json"],
  },

  images: {
    // Product imagery is still served from third-party CDNs pending the
    // Supabase migration (audit B-08). These are the hosts currently referenced
    // by app/data/products.json — narrow this once images are self-hosted.
    // Keep in step with the img-src directive above.
    remotePatterns: [
      { protocol: "https", hostname: "www.images-apmex.com" },
      { protocol: "https", hostname: "images-apmex.com" },
      { protocol: "https", hostname: "sdbullion.com" },
      { protocol: "https", hostname: "**.sdbullion.com" },
      { protocol: "https", hostname: "cdn.jmbullion.com" },
      { protocol: "https", hostname: "**.supabase.co" },
    ],
    formats: ["image/avif", "image/webp"],
    // Tile widths actually used by the catalog grid and PDP, so the optimizer
    // isn't asked to generate sizes nothing requests.
    imageSizes: [72, 96, 128, 220, 280],
    deviceSizes: [640, 828, 1080, 1200, 1920],
    qualities: [60, 70, 80],
    minimumCacheTTL: 2678400, // 31 days — product imagery is immutable

  },

  // Security headers. The storefront loads no third-party scripts.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
      {
        // Never let an intermediary cache an authenticated payload.
        source: "/api/:path*",
        headers: [{ key: "Vary", value: "Cookie" }],
      },
    ];
  },
};

export default nextConfig;
