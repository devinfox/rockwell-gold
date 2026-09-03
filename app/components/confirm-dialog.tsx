"use client";

// In-app confirmation for irreversible operations.
//
// Sell-back disbursement, order dispatch and account freeze were all guarded by
// native window.confirm — unstyled, main-thread blocking, unable to restate what
// is being confirmed, and it freezes browser-automation sessions outright
// (audit T-06).

import React, { useState, useCallback } from "react";
import Modal from "./modal";

export interface ConfirmRequest {
  title: string;
  body: React.ReactNode;
  /** Label for the confirming button. */
  confirmLabel?: string;
  /** Styles the confirm button as destructive. */
  destructive?: boolean;
}

export function ConfirmDialog({
  request,
  onResolve,
}: {
  request: ConfirmRequest;
  onResolve: (ok: boolean) => void;
}) {
  return (
    <Modal onClose={() => onResolve(false)} label={request.title} className="fin-modal fin-modal--sm">
      <div style={{ padding: 20 }}>
        <h2 className="rm-title" style={{ fontSize: 18, marginBottom: 8 }}>{request.title}</h2>
        <div className="rm-sub" style={{ marginBottom: 18 }}>{request.body}</div>
        <div className="rm-actions">
          <button
            className={`btn ${request.destructive ? "btn--ghost" : "btn--gold"}`}
            type="button"
            style={request.destructive ? { color: "var(--loss)", borderColor: "var(--loss)" } : undefined}
            onClick={() => onResolve(true)}
            autoFocus
          >
            {request.confirmLabel ?? "Confirm"}
          </button>
          <button className="btn btn--ghost" type="button" onClick={() => onResolve(false)}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Promise-based confirmation, so call sites read like the window.confirm they
 * replace: `if (!(await confirm({...}))) return;`
 */
export function useConfirm() {
  const [pending, setPending] = useState<{
    request: ConfirmRequest;
    resolve: (ok: boolean) => void;
  } | null>(null);

  const confirm = useCallback(
    (request: ConfirmRequest) =>
      new Promise<boolean>((resolve) => setPending({ request, resolve })),
    [],
  );

  const element = pending ? (
    <ConfirmDialog
      request={pending.request}
      onResolve={(ok) => {
        pending.resolve(ok);
        setPending(null);
      }}
    />
  ) : null;

  return { confirm, confirmElement: element };
}
