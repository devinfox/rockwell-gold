import type { Metadata } from "next";
import Link from "next/link";
import SiteNav from "../../components/site-nav";
import SiteFooter from "../../components/site-footer";

export const metadata: Metadata = {
  title: "Reset your password — Rockwell Metals",
  description: "Account recovery for Rockwell Metals customers.",
};

/**
 * No email delivery is connected on this environment, so recovery runs through
 * the support desk: a support agent verifies identity, issues a one-time
 * temporary password (server action `resetPassword`, audit-logged), and the
 * customer replaces it on first sign-in. When transactional email lands, this
 * page becomes the "enter your email" step of a token-based reset.
 */
export default function Page() {
  return (
    <>
      <SiteNav />
      <main className="wrap rm-main auth-wrap">
        <div className="auth">
          <aside className="auth__aside">
            <div>
              <p className="eyebrow"><span className="eyebrow__dot" aria-hidden="true"></span> Account recovery</p>
              <h2>Locked out?</h2>
            </div>
            <p>Recovery is handled by a person, not a link. That is deliberate for an account that holds allocated metal.</p>
          </aside>
          <div className="auth__card">
            <div className="rm-form">
              <div className="rm-panel rm-panel--well">
                <p className="rm-panel__k">How it works</p>
                <ol className="rm-kv" style={{ paddingLeft: 18, display: "grid", gap: 8, listStyle: "decimal" }}>
                  <li>Open a support ticket from the desk, or call the number on your statement, and say you need a password reset.</li>
                  <li>A support agent verifies your identity against the details on file.</li>
                  <li>You receive a one-time temporary password. It works once; you choose a new password as soon as you sign in.</li>
                </ol>
              </div>
              <p className="rm-note">Every reset is written to the audit ledger with the agent who issued it.</p>
              <div className="rm-actions">
                <Link className="btn btn--gold btn--block" href="/support">Contact the support desk</Link>
                <Link className="btn btn--ghost btn--block" href="/auth/sign-in">Back to sign in</Link>
              </div>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
