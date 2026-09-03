"use client";

// Self-service password change (server action `changePassword`). Shown on the
// vault dashboard; forced to the top with a notice when staff issued a
// temporary password (`mustChangePassword`).

import React, { useState } from "react";
import { rmAction, RmActionError } from "../lib/use-rm";

export default function ChangePasswordPanel({ mustChange, onChanged }: { mustChange?: boolean; onChanged?: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (next.length < 10) { setErr("Choose a password of at least 10 characters."); return; }
    if (next !== confirm) { setErr("The new passwords do not match."); return; }
    setBusy(true);
    try {
      await rmAction("changePassword", { currentPassword: current, newPassword: next });
      setDone(true);
      setCurrent(""); setNext(""); setConfirm("");
      onChanged?.();
    } catch (e2) {
      setErr(e2 instanceof RmActionError || e2 instanceof Error ? e2.message : "Could not change password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rm-panel" id="security">
      <p className="rm-panel__k">
        Security · password
        {mustChange && <span className="st" data-tone="warn">temporary password in use</span>}
      </p>
      {mustChange && !done && (
        <p className="rm-note" role="alert" style={{ marginBottom: 10 }}>
          You signed in with a one-time password issued by the support desk. Choose your own password now.
        </p>
      )}
      {done ? (
        <p className="rm-note" role="status" style={{ color: "var(--gain)" }}>Password updated. It applies to your next sign-in.</p>
      ) : (
        <form className="rm-form" onSubmit={submit}>
          <div className="rm-field">
            <label className="rm-label" htmlFor="pw-current">Current password</label>
            <input id="pw-current" className="rm-input" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="rm-formrow">
            <div className="rm-field">
              <label className="rm-label" htmlFor="pw-next">New password <span className="hint">At least 10 characters</span></label>
              <input id="pw-next" className="rm-input" type="password" autoComplete="new-password" required minLength={10} value={next} onChange={(e) => setNext(e.target.value)} />
            </div>
            <div className="rm-field">
              <label className="rm-label" htmlFor="pw-confirm">Confirm new password</label>
              <input id="pw-confirm" className="rm-input" type="password" autoComplete="new-password" required minLength={10} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
          </div>
          {err && <p className="rm-note" role="alert" style={{ color: "var(--loss)" }}>{err}</p>}
          <button className="btn btn--ghost" type="submit" disabled={busy}>{busy ? "Updating…" : "Update password"}</button>
        </form>
      )}
    </div>
  );
}
