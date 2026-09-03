"use client";

// Customer onboarding, identity & KYC tiering (blueprint §1.1).

import React, { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SiteNav from "../components/site-nav";
import SiteFooter from "../components/site-footer";
import { useFintech } from "../components/global-fintech-provider";
import { signIn as apiSignIn, signUp as apiSignUp, rmAction, useRm } from "../lib/use-rm";
import { TIER_LIMIT } from "../lib/rm-types";
import { safeNext, withNext } from "../lib/safe-next";

function BrandHighlights({ items }: { items?: { t: string; d: string }[] }) {
  const highlights = items ?? [
    { t: "100% Allocated & Segregated", d: "Your physical bullion is held in high-security private vaults, fully insured by Lloyd's of London up to $250M." },
    { t: "Live Price Lock Settlement", d: "Freeze spot prices with a 120-second guarantee and settle instantly via bank wire, crypto, or card." },
    { t: "Direct Armored Delivery", d: "Withdraw your physical coins and bars anytime with tracked, tamper-evident armored carrier delivery." },
  ];
  return (
    <div className="auth__tiers">
      {highlights.map((h, i) => (
        <div key={i} className="auth__tier is-on">
          <b>{h.t}</b>
          <span>{h.d}</span>
        </div>
      ))}
    </div>
  );
}

function AuthShell({ children, aside, eyebrow, title, sub }: {
  children: React.ReactNode; aside?: React.ReactNode; eyebrow: string; title: string; sub: string;
}) {
  return (
    <>
      <SiteNav />
      <main className="wrap rm-main auth-wrap">
        <div className="auth">
          <aside className="auth__aside">
            <div>
              <p className="eyebrow"><span className="eyebrow__dot" aria-hidden="true"></span> {eyebrow}</p>
              <h2>{title}</h2>
            </div>
            <p>{sub}</p>
            {aside ?? <BrandHighlights />}
          </aside>
          <div className="auth__card">{children}</div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

// ————— /auth/sign-in —————

export function SignInClient() {
  const router = useRouter();
  const params = useSearchParams();
  const { addToast } = useFintech();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const s = await apiSignIn(email.trim(), password);
      addToast("Signed in", `Welcome back, ${s.name}.`, "gain");
      // Same-origin paths only — `?next=https://evil.example` must never be followed.
      router.push(safeNext(params.get("next"), s.role === "CUSTOMER" ? "/vault" : "/admin"));
      router.refresh();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Sign-in failed");
      setBusy(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Rockwell ID · Secure Access"
      title="Welcome back."
      sub="Access your physical bullion vault, track live market orders, and manage custody records."
      aside={<BrandHighlights />}
    >
      <form className="rm-form" onSubmit={submit}>
        <div className="rm-field">
          <label className="rm-label" htmlFor="si-email">Email address</label>
          <input
            id="si-email"
            className="rm-input"
            type="email"
            required
            autoFocus
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>

        <div className="rm-field">
          <label className="rm-label" htmlFor="si-pass">Password</label>
          <input
            id="si-pass"
            className="rm-input"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
          />
        </div>

        {err && <p className="rm-note" role="alert" style={{ color: "var(--loss)" }}>{err}</p>}

        <button className="btn btn--gold btn--lg btn--block" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10, textAlign: "center" }}>
        <p className="auth__fine">
          No account? <a href={withNext("/auth/sign-up", params.get("next"))}>Open one in 60 seconds</a>
          {" · "}
          <a href="/auth/forgot-password">Forgot your password?</a>
        </p>
        <p className="auth__fine" style={{ fontSize: 11 }}>
          Staff sign in with the same form — your role decides where you land.
        </p>
      </div>
    </AuthShell>
  );
}

// ————— /auth/sign-up —————

export function SignUpClient() {
  const router = useRouter();
  const params = useSearchParams();
  const { addToast } = useFintech();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agree) { setErr("Please accept the custody charter to open an account."); return; }
    if (password.length < 10) { setErr("Choose a password of at least 10 characters."); return; }
    setBusy(true);
    setErr(null);
    try {
      await apiSignUp({ fullName: name, email, phone, password });
      // A shopper who arrived from a price lock goes straight back to it —
      // the 120 s hold must not be lost to an onboarding detour. Everyone
      // else starts identity verification.
      const next = safeNext(params.get("next"), "");
      addToast(
        "Account created",
        next ? "Welcome to Rockwell Metals. Verify your identity any time from your vault." : "Welcome to Rockwell Metals. Let's verify your identity.",
        "gain",
      );
      router.push(next || "/auth/kyc-verification");
      router.refresh();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Sign-up failed");
      setBusy(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Open Account · Instant Onboarding"
      title="Own physical metal in minutes."
      sub="Start stacking allocated gold with zero custody fees for your first year and instant spot execution."
      aside={
        <BrandHighlights
          items={[
            { t: "Individual Stacker Vault", d: "Direct ownership of serial-numbered gold & silver with optional weekly auto-invest." },
            { t: "100% Segregated Custody", d: "Physical bullion stored in private high-security vaults, insured by Lloyd's of London up to $250M." },
            { t: "Guaranteed Purity & Assay", d: "Every coin and bar is ultrasonic and XRF tested before vault allocation." },
          ]}
        />
      }
    >
      <form className="rm-form" onSubmit={submit}>
        <div className="rm-formrow">
          <div className="rm-field">
            <label className="rm-label" htmlFor="su-name">Full name</label>
            <input id="su-name" className="rm-input" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Adrian Reyes" />
          </div>
          <div className="rm-field">
            <label className="rm-label" htmlFor="su-phone">Mobile phone <span className="hint">Optional · for delivery coordination</span></label>
            <input id="su-phone" className="rm-input num" type="tel" autoComplete="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 (555) 000-0000" />
          </div>
        </div>
        <div className="rm-field">
          <label className="rm-label" htmlFor="su-email">Email address</label>
          <input id="su-email" className="rm-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <div className="rm-field">
          <label className="rm-label" htmlFor="su-pass">
            Password <span className="hint">At least 10 characters</span>
          </label>
          <input id="su-pass" className="rm-input" type="password" required minLength={10} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Choose a strong password" />
        </div>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12.5, color: "var(--text-secondary)", cursor: "pointer" }}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 3 }} />
          <span>I agree to the Rockwell <a href="/legal/custody-charter" style={{ color: "var(--gold-ink)" }}>custody charter</a> (allocated, segregated, never lent) and the terms of service.</span>
        </label>
        {err && <p className="rm-note" role="alert" style={{ color: "var(--loss)" }}>{err}</p>}
        <button className="btn btn--gold btn--lg btn--block" type="submit" disabled={busy}>
          {busy ? "Creating account…" : "Create account · Start stacking"}
        </button>
        <p className="auth__fine">Already stacking? <a href={withNext("/auth/sign-in", params.get("next"))}>Sign in</a></p>
      </form>
    </AuthShell>
  );
}

// ————— /auth/kyc-verification —————

const KYC_STEPS = [
  "Government photo ID captured",
  "Document fields extracted",
  "Selfie matched against the document",
  "Sanctions and PEP screening",
  "Compliance officer review",
];

export function KycVerifyClient() {
  const router = useRouter();
  const params = useSearchParams();
  const { addToast } = useFintech();
  const [phase, setPhase] = useState<"idle" | "sending" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);
  const after = safeNext(params.get("next"), "/auth/kyc-status");

  const submit = async () => {
    setPhase("sending");
    setErr(null);
    try {
      // No identity provider is connected yet, so this queues the account for a
      // compliance officer rather than pretending to clear it (audit F-03).
      await rmAction("kycSubmit", {});
      setPhase("done");
      addToast(
        "Submitted for review",
        "A compliance officer will review your account. You'll be notified when your limits change.",
        "info",
      );
      setTimeout(() => router.push(after), 900);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not submit for review");
      setPhase("idle");
    }
  };

  return (
    <AuthShell
      eyebrow="Identity Verification · Tier 2"
      title="Verify once, trade bigger."
      sub="Verification raises your limits to $100,000 and unlocks bank wire settlement, card checkout and insured delivery."
      aside={
        <BrandHighlights
          items={[
            { t: "Reviewed by a person", d: "A compliance officer checks every submission against sanctions and PEP lists." },
            { t: "Tier 2 Limits ($100,000)", d: "Unlocks Fedwire settlement, card checkout, and armored door-to-door transit." },
            { t: "You keep Tier 1 meanwhile", d: "Crypto spot buys with allocated vault storage stay available while you wait." },
          ]}
        />
      }
    >
      <div className="kyc-stage">
        {phase === "done" ? (
          <div>
            <h3 style={{ color: "var(--gold-ink)" }}>Submitted for review</h3>
            <p>Your account is queued with the compliance desk. Redirecting to your clearance status…</p>
          </div>
        ) : (
          <div>
            <h3>Driver&apos;s license or passport</h3>
            <p>
              Document capture is not connected on this environment yet. Submitting queues your
              account for manual compliance review.
            </p>
          </div>
        )}
      </div>

      <div className="kyc-progress">
        {KYC_STEPS.map((step) => (
          <div key={step} className="kyc-step">
            <span className="kyc-step__dot" aria-hidden="true"></span>
            <span>{step}</span>
          </div>
        ))}
      </div>

      {err && <p className="rm-note" role="alert" style={{ color: "var(--loss)" }}>{err}</p>}

      {phase !== "done" ? (
        <button className="btn btn--gold btn--lg btn--block" type="button" onClick={submit} disabled={phase === "sending"}>
          {phase === "sending" ? "Submitting…" : "Submit for compliance review"}
        </button>
      ) : (
        <button className="btn btn--ghost btn--block" type="button" onClick={() => router.push(after)}>
          {after === "/auth/kyc-status" ? "View verification status →" : "Continue →"}
        </button>
      )}
      <p className="auth__fine">Questions route to a human compliance officer via the support desk.</p>
    </AuthShell>
  );
}

// ————— /auth/kyc-status —————

export function KycStatusClient() {
  const { db, user, session } = useRm();
  const router = useRouter();

  useEffect(() => {
    if (db && !session) router.push("/auth/sign-in?next=/auth/kyc-status");
  }, [db, session, router]);

  const tier = user?.kycTier ?? "TIER_1";
  const cleared = user?.kycStatus === "CLEARED";

  const features: { k: string; on: boolean }[] = [
    { k: "Spot buys via USDC/USDT with instant vault allocation", on: true },
    { k: "Same-day bank wire settlement (Fedwire)", on: tier !== "TIER_1" },
    { k: "Card & Apple Pay checkout", on: tier !== "TIER_1" },
    { k: "Insured armored home delivery", on: tier !== "TIER_1" },
    { k: "Institutional OTC desk ($100k+ allocations)", on: tier === "TIER_3" },
    { k: "Dedicated account manager & custom quotes", on: tier === "TIER_3" },
  ];

  return (
    <AuthShell
      eyebrow="Account Verification Status"
      title="Clearance & limits."
      sub="Your current verification level, transaction limits, and active feature permissions."
      aside={
        <div className="auth__tiers">
          <div className={`auth__tier${tier === "TIER_1" ? " is-on" : ""}`}>
            <b>Tier 1 · Instant <i>≤ $10,000</i></b>
            <span>Instant crypto spot buys with allocated vault storage.</span>
          </div>
          <div className={`auth__tier${tier === "TIER_2" ? " is-on" : ""}`}>
            <b>Tier 2 · Verified <i>$10,000–$100,000</i></b>
            <span>Photo ID verified. Unlocks bank wire, cards, and insured delivery.</span>
          </div>
          <div className={`auth__tier${tier === "TIER_3" ? " is-on" : ""}`}>
            <b>Tier 3 · Institutional <i>$100,000+</i></b>
            <span>Custom volume pricing, OTC desk trader, and bespoke vault bays.</span>
          </div>
        </div>
      }
    >
      <div className="rm-panel rm-panel--well">
        <p className="rm-panel__k">Verification record {cleared ? <span className="st" data-tone="ok">Cleared</span> : <span className="st" data-tone="live">In review</span>}</p>
        <div className="rm-kv">
          <div><span>Account</span><b>{user?.fullName ?? "—"}</b></div>
          <div><span>Clearance level</span><b className="ok">{tier.replace("_", " ")}</b></div>
          <div><span>Order limit</span><b className="num">{TIER_LIMIT[tier]}</b></div>
          <div><span>Account status</span><b>{user?.kycStatus ?? "—"}</b></div>
          <div><span>Two-factor security</span><b>{user?.twoFactorEnabled ? "Passkey / Security Key Enrolled" : "Standard Email & SMS"}</b></div>
        </div>
      </div>

      <div className="rm-field">
        <span className="rm-label">Active capabilities</span>
        <div className="rm-kv">
          {features.map((f) => (
            <div key={f.k}>
              <span style={{ color: f.on ? "var(--text)" : "var(--text-muted)" }}>{f.k}</span>
              <b className="num" style={{ color: f.on ? "var(--gain)" : "var(--text-muted)" }}>{f.on ? "✓ Active" : "Locked"}</b>
            </div>
          ))}
        </div>
      </div>

      <div className="rm-actions">
        <a className="btn btn--gold" href="/market">Enter live market</a>
        {tier !== "TIER_3" && (
          <a className="btn btn--ghost" href="/support/otc-desk">Apply for Tier 3 · Institutional</a>
        )}
      </div>
    </AuthShell>
  );
}

