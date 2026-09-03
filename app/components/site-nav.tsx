"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import ThemeToggle from "./theme-toggle";
import { useFintech } from "./global-fintech-provider";
import { signOut, type RmSession } from "../lib/use-rm";
import { useInitialSession } from "../lib/initial-session";
import { ROLE_LABEL } from "../lib/rm-types";
import { useSpot, fmtSpot, fmtChange, spotDir } from "./use-spot";
import BrandLogo from "./brand-logo";

/**
 * Masked account reference for the nav chip: the last four characters of the
 * real user id. Every customer used to see the same literal "RM-•••• 7741".
 */
export function maskedAccountId(userId: string): string {
  const tail = userId.replace(/[^a-z0-9]/gi, "").slice(-4).toUpperCase();
  return `RM-•••• ${tail || "····"}`;
}

const GOLD_MENU = [
  {
    heading: { href: "/gold", label: "Shop gold" },
    links: [
      { href: "/gold", label: "All gold" },
      { href: "/best-sellers", label: "Best sellers" },
      { href: "/new-arrivals", label: "New arrivals" },
      { href: "/on-sale", label: "On sale" },
    ],
  },
  {
    heading: { href: "/gold/us-mint", label: "U.S. Mint" },
    links: [
      { href: "/gold/us-mint/american-eagles", label: "American Eagles" },
      { href: "/gold/us-mint/buffalos", label: "Buffalos" },
      { href: "/gold/us-mint/pre-1933", label: "Pre-1933 U.S. Gold" },
      { href: "/gold/us-mint/commemoratives", label: "Commemoratives" },
      { href: "/gold/us-mint/collectibles", label: "Collectibles" },
    ],
  },
  {
    heading: { href: "/gold/perth-mint", label: "The Perth Mint" },
    links: [
      { href: "/gold/perth-mint/lunar-series", label: "Lunar Series" },
      { href: "/gold/perth-mint/kangaroos", label: "Kangaroos" },
      { href: "/gold/perth-mint/kookaburras", label: "Kookaburras" },
      { href: "/gold/perth-mint/swans", label: "Swans" },
      { href: "/gold/perth-mint/koalas", label: "Koalas" },
      { href: "/gold/perth-mint/bars", label: "Bars" },
      { href: "/gold/perth-mint/collectibles", label: "Collectibles" },
    ],
  },
  {
    heading: { href: "/gold/royal-mint", label: "The Royal Mint" },
    links: [
      { href: "/gold/royal-mint/britannias", label: "Britannias" },
      { href: "/gold/royal-mint/sovereigns", label: "Sovereigns" },
      { href: "/gold/royal-mint/queens-beasts", label: "Queen's Beasts" },
      { href: "/gold/royal-mint/tudor-beasts", label: "Tudor Beasts" },
      { href: "/gold/royal-mint/myths-legends", label: "Myths & Legends" },
      { href: "/gold/royal-mint/collectibles", label: "Collectibles" },
    ],
  },
  {
    heading: { href: "/gold/royal-canadian-mint", label: "Royal Canadian Mint" },
    links: [
      { href: "/gold/royal-canadian-mint/maple-leafs", label: "Maple Leafs" },
      { href: "/gold/royal-canadian-mint/five-nines", label: ".99999 Gold" },
      { href: "/gold/royal-canadian-mint/wildlife", label: "Wildlife Series" },
      { href: "/gold/royal-canadian-mint/bars", label: "Bars" },
      { href: "/gold/royal-canadian-mint/collectibles", label: "Collectibles" },
    ],
  },
];

const SILVER_MENU = [
  {
    heading: { href: "/silver", label: "Shop silver" },
    links: [
      { href: "/silver", label: "All silver" },
      { href: "/best-sellers", label: "Best sellers" },
      { href: "/new-arrivals", label: "New arrivals" },
      { href: "/on-sale", label: "On sale" },
    ],
  },
  {
    heading: { href: "/silver/us-mint", label: "U.S. Mint" },
    links: [
      { href: "/silver/us-mint/american-silver-eagles", label: "American Silver Eagles" },
      { href: "/silver/us-mint/morgan-dollars", label: "Morgan Silver Dollars" },
      { href: "/silver/us-mint/peace-dollars", label: "Peace Silver Dollars" },
      { href: "/silver/us-mint/junk-silver", label: "90% Junk Silver" },
      { href: "/silver/us-mint/commemoratives", label: "Commemoratives" },
      { href: "/silver/us-mint/collectibles", label: "Collectibles" },
    ],
  },
  {
    heading: { href: "/silver/perth-mint", label: "The Perth Mint" },
    links: [
      { href: "/silver/perth-mint/silver-lunar", label: "Silver Lunar Series" },
      { href: "/silver/perth-mint/silver-kookaburras", label: "Silver Kookaburras" },
      { href: "/silver/perth-mint/silver-koalas", label: "Silver Koalas" },
      { href: "/silver/perth-mint/silver-swans", label: "Silver Swans" },
      { href: "/silver/perth-mint/dragon-series", label: "Dragon & Rectangular" },
      { href: "/silver/perth-mint/collectibles", label: "Collectibles" },
    ],
  },
  {
    heading: { href: "/silver/royal-mint", label: "The Royal Mint" },
    links: [
      { href: "/silver/royal-mint/silver-britannias", label: "Silver Britannias" },
      { href: "/silver/royal-mint/queens-beasts", label: "Queen's Beasts" },
      { href: "/silver/royal-mint/tudor-beasts", label: "Tudor Beasts" },
      { href: "/silver/royal-mint/myths-legends", label: "Myths & Legends" },
      { href: "/silver/royal-mint/music-legends", label: "Music Legends" },
      { href: "/silver/royal-mint/collectibles", label: "Collectibles" },
    ],
  },
  {
    heading: { href: "/silver/royal-canadian-mint", label: "Royal Canadian Mint" },
    links: [
      { href: "/silver/royal-canadian-mint/silver-maples", label: "Silver Maple Leafs" },
      { href: "/silver/royal-canadian-mint/wildlife-series", label: "Wildlife Series" },
      { href: "/silver/royal-canadian-mint/birds-landscapes", label: "Birds & Landscapes" },
      { href: "/silver/royal-canadian-mint/pysanka-series", label: "Pysanka Easter Eggs" },
      { href: "/silver/royal-canadian-mint/silver-bars", label: "Silver Bars" },
      { href: "/silver/royal-canadian-mint/collectibles", label: "Collectibles" },
    ],
  },
];

const PLATINUM_MENU = [
  {
    heading: { href: "/platinum", label: "Shop platinum" },
    links: [
      { href: "/platinum", label: "All platinum" },
      { href: "/platinum/bars-rounds", label: "Bars & Rounds" },
      { href: "/platinum/coins", label: "Platinum Coins" },
      { href: "/best-sellers", label: "Best sellers" },
      { href: "/new-arrivals", label: "New arrivals" },
      { href: "/on-sale", label: "On sale" },
    ],
  },
  {
    heading: { href: "/platinum/us-mint", label: "U.S. Mint" },
    links: [
      { href: "/platinum/us-mint/american-eagles", label: "American Eagles (BU)" },
      { href: "/platinum/us-mint/proof-eagles", label: "Proof Platinum Eagles" },
      { href: "/platinum/us-mint/burnished-eagles", label: "Burnished Eagles" },
      { href: "/platinum/us-mint/sets", label: "Proof & Fractional Sets" },
    ],
  },
  {
    heading: { href: "/platinum/bars-rounds", label: "Bars & Brands" },
    links: [
      { href: "/platinum/bars-rounds/pamp-suisse", label: "PAMP Suisse" },
      { href: "/platinum/bars-rounds/valcambi", label: "Valcambi" },
      { href: "/platinum/bars-rounds/apmex", label: "APMEX Platinum" },
      { href: "/platinum/bars-rounds/credit-suisse", label: "Credit Suisse" },
      { href: "/platinum/bars-rounds/baird-co", label: "Baird & Co." },
      { href: "/platinum/bars-rounds/cast-minted", label: "Secondary Market Bars" },
    ],
  },
  {
    heading: { href: "/platinum/perth-mint", label: "The Perth Mint" },
    links: [
      { href: "/platinum/perth-mint/plat-koalas", label: "Platinum Koalas" },
      { href: "/platinum/perth-mint/plat-kangaroos", label: "Platinum Kangaroos" },
      { href: "/platinum/perth-mint/plat-kookaburras", label: "Platinum Kookaburras" },
      { href: "/platinum/perth-mint/plat-lunar", label: "Platinum Lunar Series" },
      { href: "/platinum/perth-mint/collectibles", label: "Perth Collectibles" },
    ],
  },
  {
    heading: { href: "/platinum/royal-canadian-mint", label: "World & Royal Mints" },
    links: [
      { href: "/platinum/royal-canadian-mint/plat-maples", label: "Platinum Maple Leafs" },
      { href: "/platinum/royal-mint/plat-britannias", label: "The Royal Mint Britannias" },
      { href: "/platinum/austrian-mint/philharmonics", label: "Austrian Philharmonics" },
      { href: "/platinum/other-mints/nobles-pandas", label: "Isle of Man Nobles & Pandas" },
      { href: "/platinum/other-mints/collectibles", label: "World Proofs & Sets" },
    ],
  },
];

export default function SiteNav({
  current = "",
  variant = "default",
}: {
  current?: string;
  variant?: "default" | "vault";
}) {
  const { openCommandPalette, openCheckout, openVerifySerial } = useFintech();
  const router = useRouter();
  const pathname = usePathname();
  // Seeded from the server-resolved session so the first paint is already
  // signed-in (audit: auth-state flash); the fetch below re-confirms it.
  const initialSession = useInitialSession();
  const [session, setSession] = useState<RmSession | null>(initialSession);
  const [menuOpen, setMenuOpen] = useState(false);
  const spot = useSpot();

  // Mobile menu: React owns the toggle (audit: Medium — the hamburger had no
  // handler outside the two legacy scripts). Escape closes; so does navigation.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  // Route changed (client navigation) — collapse the menu. State is adjusted
  // during render rather than in an effect, per the React "adjusting state on
  // prop change" pattern.
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setMenuOpen(false);
  }

  // The session is an httpOnly cookie, so the nav asks the server who it is.
  useEffect(() => {
    let alive = true;
    const sync = async () => {
      try {
        const res = await fetch("/api/auth", { cache: "no-store" });
        const json = await res.json();
        if (alive) setSession(json.session ?? null);
      } catch {
        if (alive) setSession(null);
      }
    };
    sync();
    window.addEventListener("rm-session", sync);
    return () => {
      alive = false;
      window.removeEventListener("rm-session", sync);
    };
  }, []);

  const staff = session && session.role !== "CUSTOMER";

  const here = (href: string) =>
    current === href ? { className: "is-here", "aria-current": "page" as const } : {};
  const goldHere = current === "/gold" || current.startsWith("/gold/");
  const silverHere = current === "/silver" || current.startsWith("/silver/");
  const platHere = current === "/platinum" || current.startsWith("/platinum/");

  return (
    <header className={`nav${menuOpen ? " nav--open" : ""}`} id="top" data-nav-react="1">
      <div className="nav__inner wrap">
        <Link className="nav__brand" href="/" aria-label="Rockwell Metals home">
          <BrandLogo descriptor="METALS" size={32} />
        </Link>

        <nav className="nav__links" id="primary-nav" aria-label="Primary">
          <Link href="/market" {...here("/market")}>Market floor</Link>
          <Link href="/best-sellers" {...here("/best-sellers")}>Best sellers</Link>
          <Link href="/new-arrivals" {...here("/new-arrivals")}>New arrivals</Link>
          <div className="nav__drop">
            <Link
              href="/gold"
              className={goldHere ? "is-here" : undefined}
              aria-current={current === "/gold" ? "page" : undefined}
              aria-haspopup="true"
            >
              Gold
              <svg className="nav__caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5L6 8l3.5-3.5" /></svg>
            </Link>
            <div className="nav__droppanel nav__droppanel--mega">
              {GOLD_MENU.map((col) => (
                <div className="nav__dropcol" key={col.heading.label}>
                  <Link className="nav__drophead" href={col.heading.href} {...here(col.heading.href)}>{col.heading.label}</Link>
                  {col.links.map((l) => (
                    <Link key={l.href} href={l.href} {...here(l.href)}>{l.label}</Link>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="nav__drop">
            <Link
              href="/silver"
              className={silverHere ? "is-here" : undefined}
              aria-current={current === "/silver" ? "page" : undefined}
              aria-haspopup="true"
            >
              Silver
              <svg className="nav__caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5L6 8l3.5-3.5" /></svg>
            </Link>
            <div className="nav__droppanel nav__droppanel--mega">
              {SILVER_MENU.map((col) => (
                <div className="nav__dropcol" key={col.heading.label}>
                  <Link className="nav__drophead" href={col.heading.href} {...here(col.heading.href)}>{col.heading.label}</Link>
                  {col.links.map((l) => (
                    <Link key={l.href} href={l.href} {...here(l.href)}>{l.label}</Link>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="nav__drop">
            <Link
              href="/platinum"
              className={platHere ? "is-here" : undefined}
              aria-current={current === "/platinum" ? "page" : undefined}
              aria-haspopup="true"
            >
              Platinum
              <svg className="nav__caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5L6 8l3.5-3.5" /></svg>
            </Link>
            <div className="nav__droppanel nav__droppanel--mega">
              {PLATINUM_MENU.map((col) => (
                <div className="nav__dropcol" key={col.heading.label}>
                  <Link className="nav__drophead" href={col.heading.href} {...here(col.heading.href)}>{col.heading.label}</Link>
                  {col.links.map((l) => (
                    <Link key={l.href} href={l.href} {...here(l.href)}>{l.label}</Link>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <Link href="/other-metals" {...here("/other-metals")}>Other metals</Link>
          <Link href="/on-sale" {...here("/on-sale")}>On sale</Link>
          <Link href="/drops" {...here("/drops")}>Drops</Link>
          <Link href="/vault" {...here("/vault")}>Vault</Link>

          {/* Account entries for the stacked mobile menu: the header chip,
              "Sign in" and "Instant Buy" are hidden under 760px, so the
              signed-in / signed-out surfaces need a home in the panel. */}
          <div className="nav__mobile-only">
            {session ? (
              <>
                <Link href={staff ? "/admin" : "/vault"}>
                  <span className="acct__av" aria-hidden="true">
                    {session.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                  </span>
                  {session.name.split(" ")[0]} · {staff ? ROLE_LABEL[session.role] : maskedAccountId(session.userId)}
                </Link>
                <Link href="/orders">Orders</Link>
                <Link href="/tax-center">Tax center</Link>
                <Link href="/support">Support</Link>
                <Link
                  href="/"
                  onClick={async (e) => {
                    e.preventDefault();
                    await signOut();
                    setSession(null);
                    setMenuOpen(false);
                    router.push("/");
                    router.refresh();
                  }}
                >
                  Sign out
                </Link>
              </>
            ) : (
              <>
                <Link href="/auth/sign-in">Sign in</Link>
                <Link href="/auth/sign-up">Open an account</Link>
              </>
            )}
          </div>
        </nav>

        <div className="nav__right">
          {/* Quick Cmd+K Button */}
          <button
            type="button"
            className="nav__cmd-trigger num"
            onClick={openCommandPalette}
            aria-label="Open Command Palette (Cmd+K)"
            title="Search coins, mints, commands (Cmd+K)"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <span>Search</span>
            <kbd className="num">⌘K</kbd>
          </button>

          <ThemeToggle />

          {variant === "vault" ? (
            <>
              <button
                type="button"
                className="btn btn--gold nav__cta"
                onClick={() =>
                  openCheckout({
                    id: "buffalo-1oz",
                    title: "American Gold Buffalo · 1 oz",
                    price: 2559,
                    mint: "U.S. Mint",
                    image: "/assets/coin-buffalo.png",
                  })
                }
              >
                + Buy gold
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn--ghost nav__cta-verify num"
                onClick={() => openVerifySerial()}
              >
                Verify serial
              </button>
              <button
                type="button"
                className="btn btn--gold nav__cta"
                onClick={() =>
                  openCheckout({
                    id: "buffalo-1oz",
                    title: "American Gold Buffalo · 1 oz",
                    price: 2559,
                    mint: "U.S. Mint",
                    image: "/assets/coin-buffalo.png",
                  })
                }
              >
                Instant Buy
              </button>
            </>
          )}

          {session ? (
            <div className="nav__drop">
              <Link className="acct" href={staff ? "/admin" : "/vault"} aria-label="Account" aria-haspopup="true">
                <span className="acct__av" aria-hidden="true">
                  {session.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                </span>
                <span className="acct__meta">
                  <span className="acct__name">{session.name.split(" ")[0]} {session.name.split(" ")[1]?.[0] ?? ""}.</span>
                  <span className="acct__id num" title={staff ? ROLE_LABEL[session.role] : undefined}>
                    {staff ? `STAFF · ${ROLE_LABEL[session.role]}` : maskedAccountId(session.userId)}
                  </span>
                </span>
              </Link>
              <div className="nav__droppanel" style={{ left: "auto", right: 0, transform: "translate(0, 4px)" }}>
                <Link href="/vault">Your vault</Link>
                <Link href="/orders">Orders</Link>
                <Link href="/tax-center">Tax center</Link>
                <Link href="/support">Support</Link>
                {staff && <Link href="/admin">Ops console</Link>}
                <Link
                  href="/"
                  onClick={async (e) => {
                    e.preventDefault();
                    await signOut();
                    setSession(null);
                    router.push("/");
                    router.refresh();
                  }}
                >
                  Sign out
                </Link>
              </div>
            </div>
          ) : (
            <Link className="btn btn--ghost nav__cta" href="/auth/sign-in">Sign in</Link>
          )}

          <button
            type="button"
            className="nav__menu"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="primary-nav"
            data-nav-react="1"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span></span><span></span><span></span>
          </button>
        </div>
      </div>

      {/* live pricing bar — sticky with the nav */}
      <div className="nav__tickbar">
        <Link className="wrap spot spot--bar" href="/#pulse" aria-label="Live spot prices — gold, silver, platinum">
          <span className="spot--bar__left">
            <span className="spot__dot" aria-hidden="true"></span>
            <span className="spot__label">{spot?.live ? "Live spot" : "Indicative spot"}</span>
          </span>
          <span className="spot--bar__ticks">
            {[
              { sym: "XAU", label: "XAU/USD" },
              { sym: "XAG", label: "XAG/USD" },
              { sym: "XPT", label: "XPT/USD" },
            ].map((t) => (
              <span className="tick num" key={t.sym} data-tick={`${t.sym}/USD`}>
                <span className="tick__sym">{t.label}</span>
                <b className="tick__val">{fmtSpot(spot, t.sym)}</b>
                {spot?.live && (
                  <i className="tick__chg chg" data-dir={spotDir(spot, t.sym)}>{fmtChange(spot, t.sym)}</i>
                )}
              </span>
            ))}
          </span>
        </Link>
      </div>
    </header>
  );
}
