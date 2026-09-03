import Link from "next/link";
import SiteNav from "./components/site-nav";
import SiteFooter from "./components/site-footer";

export default function NotFound() {
  return (
    <>
      <SiteNav />
      <main className="wrap rm-main" id="main" style={{ maxWidth: 640 }}>
        <div className="rm-head">
          <span className="section__index num">404</span>
          <h1 className="rm-title">Not on the floor.</h1>
          <p className="rm-sub">
            That page or product doesn&apos;t exist. It may have sold out and been delisted, or the
            link may be mistyped.
          </p>
        </div>
        <div className="rm-actions">
          <Link className="btn btn--gold" href="/market">Browse the market floor</Link>
          <Link className="btn btn--ghost" href="/gold">Gold</Link>
          <Link className="btn btn--ghost" href="/silver">Silver</Link>
          <Link className="btn btn--ghost" href="/platinum">Platinum</Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
