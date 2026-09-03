"use client";

// Serial lookup against the caller's own ledger. The store only ever returns a
// customer their own holdings, so a match means "this serial is on your
// ledger" — nothing more is claimed. This modal used to accept any string
// starting with "RM-" after a fake scanning delay (audit: Medium).

import React, { useState } from "react";
import Link from "next/link";
import Modal from "./modal";
import { useRm, ago, fmtDate } from "../lib/use-rm";
import type { HoldingStatus } from "../lib/rm-types";

const STATUS_LABEL: Record<HoldingStatus, string> = {
  VAULTED: "Vaulted · allocated",
  DELIVERY_REQUESTED: "Reserved · withdrawal or sell-back pending",
  TRANSIT: "In armored transit",
  SOLD_BACK: "Sold back to the floor",
};

export default function SerialVerifyModal({
  initialSerial = "",
  onClose,
}: {
  initialSerial?: string;
  onClose: () => void;
}) {
  const { db, session } = useRm(0);
  const [serialInput, setSerialInput] = useState(initialSerial);
  /** The serial most recently submitted for lookup; null until the button is pressed. */
  const [checked, setChecked] = useState<string | null>(null);

  const query = (checked ?? "").trim().toUpperCase();
  const holding = query && db ? db.holdings.find((h) => h.serialNumber.toUpperCase() === query) ?? null : null;

  return (
    <Modal onClose={onClose} label="Verify a vault serial" className="fin-modal fin-modal--md">
        <div className="fin-modal__head">
          <div className="fin-modal__title-group">
            <span className="section__index num">Custody Passport</span>
            <h2 className="fin-modal__title">Ledger Lookup</h2>
          </div>
          <button className="fin-modal__close" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        <div className="fin-modal__body">
          <p className="fin-verify__intro">
            Every vaulted piece is serial-registered to its owner&apos;s ledger at intake. Enter a serial to check whether it sits on yours.
          </p>

          <div className="fin-verify-input-group">
            <input
              type="text"
              className="fin-input num"
              placeholder="e.g. RM-AU-BUF-7741"
              aria-label="Serial number"
              value={serialInput}
              onChange={(e) => {
                setSerialInput(e.target.value);
                if (checked !== null) setChecked(null);
              }}
              onKeyDown={(e) => { if (e.key === "Enter" && serialInput.trim()) setChecked(serialInput); }}
            />
            <button
              type="button"
              className="btn btn--gold"
              onClick={() => setChecked(serialInput)}
              disabled={!serialInput.trim()}
            >
              Check ledger
            </button>
          </div>

          {checked !== null && !db && (
            <p className="fin-modal__fine num" aria-live="polite">Reading your ledger…</p>
          )}

          {checked !== null && db && !session && (
            <div className="fin-verify-result fin-verify-result--err" role="status">
              <b className="loss num">Sign in to check your ledger</b>
              <p className="num">
                Serials are verified against the holdings registered to your account. <Link href="/auth/sign-in">Sign in →</Link>
              </p>
            </div>
          )}

          {checked !== null && db && session && holding && (
            <div className="fin-verify-result" role="status">
              <div className="fin-verify-result__badge gain num">
                <span className="tag__pulse"></span> ON YOUR LEDGER · VAULTED SINCE {fmtDate(holding.createdAt).toUpperCase()}
              </div>

              <div className="fin-passport-grid num">
                <div>
                  <span>Serial Number</span>
                  <b>{holding.serialNumber}</b>
                </div>
                <div>
                  <span>Piece</span>
                  <b>{holding.title}</b>
                </div>
                <div>
                  <span>Purity · Weight</span>
                  <b>{holding.purityPct}% · {holding.weightOz} oz</b>
                </div>
                <div>
                  <span>Grade</span>
                  <b>{holding.grade}</b>
                </div>
                <div>
                  <span>Custody Location</span>
                  <b>{holding.vaultBay}</b>
                </div>
                <div>
                  <span>Ledger Status</span>
                  <b className={holding.status === "VAULTED" ? "gain" : undefined}>
                    {STATUS_LABEL[holding.status]} · verified {ago(holding.lastVerifiedAt)}
                  </b>
                </div>
              </div>

              <p className="fin-modal__fine num">
                <Link href={`/vault/holdings/${encodeURIComponent(holding.serialNumber)}`}>Open the full passport →</Link>
              </p>
            </div>
          )}

          {checked !== null && db && session && !holding && (
            <div className="fin-verify-result fin-verify-result--err" role="status">
              <b className="loss num">✕ {query} is not on your ledger</b>
              <p className="num">
                No holding registered to your account carries this serial. Check the passport that shipped with the piece, or contact the desk if you believe this is an error.
              </p>
            </div>
          )}
        </div>
    </Modal>
  );
}
