import type { Metadata } from "next";
import "./styles.css";
import "./rm.css";
import GlobalFintechProvider from "./components/global-fintech-provider";
import { readSession } from "./lib/session";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://rockwellmetals.com"),
  title: {
    default: "Rockwell Metals — The hard asset, traded like a digital one",
    template: "%s",
  },
  description:
    "A marketplace for physical gold, silver and platinum — allocated vault custody, serial-level custody passports, and instant sell-back liquidity.",
  openGraph: {
    type: "website",
    siteName: "Rockwell Metals",
  },
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
