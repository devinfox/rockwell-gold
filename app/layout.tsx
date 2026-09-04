import type { Metadata } from "next";
import "./styles.css";
import "./rm.css";
import GlobalFintechProvider from "./components/global-fintech-provider";
import { readSession } from "./lib/session";

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://rockwellmetals.com";
const DESCRIPTION =
  "Buy physical gold, silver and platinum at live spot-linked prices. 120-second price lock, allocated and insured vault custody, serial-level custody passports, and instant sell-back liquidity. Settle by wire or card.";

// The Open Graph / Twitter images are generated server-side from the repo's
// own assets by app/opengraph-image.tsx and app/product/[id]/opengraph-image.tsx
// (Next's file convention attaches them automatically).
export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  applicationName: "Rockwell Metals",
  title: {
    default: "Rockwell Metals — Physical gold, traded like a digital asset",
    template: "%s",
  },
  description: DESCRIPTION,
  keywords: [
    "buy gold", "buy silver", "buy platinum", "gold bullion", "silver bullion", "gold coins", "silver coins",
    "American Gold Eagle", "Gold Buffalo", "Gold Maple Leaf", "Britannia", "gold price", "spot price", "live gold price",
    "allocated vault storage", "precious metals IRA", "sell gold", "bullion dealer",
  ],
  category: "finance",
  openGraph: {
    type: "website",
    siteName: "Rockwell Metals",
    locale: "en_US",
    url: SITE,
    title: "Rockwell Metals — Physical gold, traded like a digital asset",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Rockwell Metals — Physical gold, traded like a digital asset",
    description: "Live spot-linked bullion. 120-second price lock, allocated vault custody, serial passports, instant sell-back.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  alternates: { canonical: "/" },
  formatDetection: { telephone: false },
};

// Restores the visitor's saved theme before first paint. This previously *wrote*
// localStorage["rm-theme"] = "light" unconditionally on every page load, which
// erased the user's choice on every navigation and made the toggle useless
// (audit T-03). It now only reads.
const themeInit = `try{
  var t = localStorage.getItem("rm-theme");
  if (t !== "light" && t !== "dark") {
    t = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", t);
}catch(e){
  document.documentElement.setAttribute("data-theme","light");
}`;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Resolve the session once on the server so the client tree renders the
  // signed-in state on first paint (audit: Low — "Sign in" flashed until
  // /api/auth answered). Reading the cookie here makes the whole tree
  // dynamic; the site is already cookie-personalised, so that is the intent.
  const claims = await readSession();
  const initialSession = claims
    ? { userId: claims.uid, name: claims.name, email: claims.email, role: claims.role }
    : null;
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body suppressHydrationWarning>
        <a className="skip-link" href="#main">Skip to main content</a>
        <GlobalFintechProvider initialSession={initialSession}>{children}</GlobalFintechProvider>
      </body>
    </html>
  );
}
