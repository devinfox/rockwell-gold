import Link from "next/link";
import SiteNav from "../components/site-nav";
import SiteFooter from "../components/site-footer";

/** Shared frame for the policy pages. */
export default function LegalShell({
  index,
  title,
  sub,
  children,
  draft = false,
}: {
  index: string;
  title: string;
  sub: string;
  children: React.ReactNode;
  /** Marks a document that still needs review by counsel before launch. */
  draft?: boolean;
}) {
  return (
    <>
      <SiteNav />
      <main className="wrap rm-main" id="main" style={{ maxWidth: 780 }}>
        <nav className="rm-crumbs" aria-label="Breadcrumb">
          <Link href="/">Home</Link><span aria-hidden="true">/</span>
          <span aria-current="page">{title}</span>
        </nav>
        <div className="rm-head">
          <span className="section__index num">{index}</span>
          <h1 className="rm-title">{title}</h1>
          <p className="rm-sub">{sub}</p>
        </div>

        {draft && (
          <div className="rm-panel" style={{ borderColor: "var(--gold-deep)", marginBottom: 20 }}>
            <p className="rm-panel__k">Draft — not yet reviewed by counsel</p>
            <p className="rm-note">
              This document describes how the platform currently behaves. It has not been reviewed by
              a qualified lawyer and is not a substitute for one. Have counsel review and adopt it
              before this site takes real customers or real money.
            </p>
          </div>
        )}

        <article className="legal">{children}</article>
      </main>
      <SiteFooter />
    </>
  );
}
