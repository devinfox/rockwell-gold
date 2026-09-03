"use client";

// Sell-back from the vault. Submits a real `requestSellback` to the ledger
// store; the desk approves and disburses, and the payout reference is
// assigned at disbursement. This modal used to fake the whole flow with a
// setTimeout and a random 0x… hash presented as a settled payout (audit:
// Medium).

import React, { useState, useEffect } from "react";
import Link from "next/link";
import Modal from "./modal";
import { useFintech } from "./global-fintech-provider";
import { rmAction, RmActionError, usd } from "../lib/use-rm";
import type { SellBackRequest } from "../lib/rm-types";

export interface SellBackItem {
  key: string;
  name: string;
  qtyOwned: number;
  weight: number;
  /** Net live bid per unit (spread already applied), as shown on the vault page. */
  bidPrice: number;
  image?: string;
  /** Serial numbers of the vaulted units this item represents, in the order they may be sold. */
  serials?: string[];
}

/** How long the quoted bid is honoured before the modal must be reopened for a fresh one. */
const BID_HOLD_S = 90;

export default function SellBackModal({
  item,
  onClose,
}: {
  item: SellBackItem;
  onClose: () => void;
}) {
  const serials = item.serials ?? [];
  const maxQty = Math.max(0, Math.min(item.qtyOwned, serials.length));
  const [qty, setQty] = useState(maxQty > 0 ? 1 : 0);
  const [payoutRail, setPayoutRail] = useState<"USDC" | "WIRE">("USDC");
  const [timeLeft, setTimeLeft] = useState(BID_HOLD_S);
  const [step, setStep] = useState<"review" | "submitting" | "submitted">("review");
  const [request, setRequest] = useState<SellBackRequest | null>(null);
  const [error, setError] = useState<{ message: string; signIn: boolean } | null>(null);
  const { addToast } = useFintech();

  const expired = timeLeft <= 0;
  const totalProceeds = item.bidPrice * qty;

  // The bid was quoted when the modal opened; it is not refreshed here, so
  // once the hold runs out the only honest move is to reopen for a new one.
  useEffect(() => {
    if (step !== "review" || expired) return;
    const timer = setInterval(() => setTimeLeft((prev) => Math.max(0, prev - 1)), 1000);
    return () => clearInterval(timer);
  }, [step, expired]);

  const fmtMinSec = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m < 10 ? "0" + m : m}:${s < 10 ? "0" + s : s}`;
  };

  const handleExecuteSellBack = async () => {
    if (expired || qty < 1 || serials.length === 0) return;
    setStep("submitting");
    setError(null);
    try {
      const sb = await rmAction<SellBackRequest>("requestSellback", {
        serials: serials.slice(0, qty),
        title: item.name,
        lockedBidUsd: +item.bidPrice.toFixed(2),
        payout: payoutRail,
      });
      setRequest(sb);
      setStep("submitted");
      addToast(
        "Sell-back submitted",
        `${sb.id} · ${usd(sb.lockedBidUsd * sb.quantity)} to your ${payoutRail === "USDC" ? "USDC wallet" : "bank wire"} once the desk approves.`,
        "gain",
      );
    } catch (e) {
      const signIn = e instanceof RmActionError && (e.status === 401 || e.status === 403);
      setError({
        message: signIn ? "Sign in to sell back from your vault." : e instanceof Error ? e.message : "The request could not be submitted. Try again.",
        signIn,
      });
      setStep("review");
    }
  };

  return (
    <Modal onClose={onClose} label="Sell back a holding" className="fin-modal fin-modal--md">
        <div className="fin-modal__head">
          <div className="fin-modal__title-group">
            <span className="section__index num">Instant Liquidity</span>
            <h2 className="fin-modal__title">
              {step === "submitted" ? "Sell-Back Submitted" : "Sell Back to Rockwell Floor"}
            </h2>
          </div>
          <button className="fin-modal__close" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        {step === "review" && (
          <div className="fin-modal__body">
            <div className="fin-lock-bar" data-state={expired ? "expired" : undefined}>
              <div className="fin-lock-bar__left">
                <span className="tag__pulse"></span>
                <span className="num">{expired ? "BID EXPIRED" : "LIVE BID HELD"}</span>
              </div>
              <div className="fin-lock-bar__time num">
                <span>{expired ? "Reopen for a fresh bid" : "Held for"}</span>
                <b>{fmtMinSec(timeLeft)}</b>
              </div>
            </div>

            <div className="fin-order-summary">
              <div className="fin-order-summary__info">
                <h3 className="fin-order-summary__name">{item.name}</h3>
                <p className="fin-order-summary__meta num">
                  You own {item.qtyOwned} {item.qtyOwned === 1 ? "unit" : "units"} in allocated vault · {serials.length} sellable {serials.length === 1 ? "serial" : "serials"}
                </p>
                <div className="fin-order-summary__price-row num">
                  <span className="fin-order-summary__price gain">{usd(item.bidPrice)}</span>
                  <span className="fin-order-summary__unit">net bid / unit · spread applied</span>
                </div>
              </div>
            </div>

            {serials.length === 0 && (
              <p className="fin-modal__fine num">
                No serials were attached to this item. <Link href="/vault/sell-back">Open the sell-back terminal</Link> to choose the exact units.
              </p>
            )}

            <div className="fin-form-group">
              <div className="fin-form-group__label">
                <span>Quantity to Liquidate</span>
                <span className="fin-form-group__hint num">Max available: {maxQty}</span>
              </div>
              <div className="fin-qty-stepper">
                <button
                  type="button"
                  className="fin-qty-stepper__btn"
                  aria-label="Decrease quantity"
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  disabled={maxQty === 0}
                >
                  –
                </button>
                <input
                  type="number"
                  className="fin-qty-stepper__input num"
                  aria-label="Quantity to liquidate"
                  value={qty}
                  min={1}
                  max={maxQty}
                  disabled={maxQty === 0}
                  onChange={(e) => setQty(Math.max(1, Math.min(maxQty, parseInt(e.target.value) || 1)))}
                />
                <button
                  type="button"
                  className="fin-qty-stepper__btn"
                  aria-label="Increase quantity"
                  onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                  disabled={maxQty === 0}
                >
                  +
                </button>
                <button
                  type="button"
                  className="fin-qty-stepper__max num"
                  onClick={() => setQty(maxQty)}
                  disabled={maxQty === 0}
                >
                  MAX
                </button>
              </div>
            </div>

            <div className="fin-form-group">
              <div className="fin-form-group__label">
                <span>Payout Destination Rail</span>
              </div>
              <div className="fin-rail-cards" role="radiogroup" aria-label="Payout rail">
                <button
                  type="button"
                  role="radio"
                  aria-checked={payoutRail === "USDC"}
                  className={`fin-rail-card ${payoutRail === "USDC" ? "is-active" : ""}`}
                  onClick={() => setPayoutRail("USDC")}
                >
                  <b className="fin-rail-card__name">Crypto (USDC)</b>
                  <p className="fin-rail-card__desc num">On-chain once the desk disburses</p>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={payoutRail === "WIRE"}
                  className={`fin-rail-card ${payoutRail === "WIRE" ? "is-active" : ""}`}
                  onClick={() => setPayoutRail("WIRE")}
                >
                  <b className="fin-rail-card__name">Fedwire</b>
                  <p className="fin-rail-card__desc num">To your linked bank account</p>
                </button>
              </div>
            </div>

            {error && (
              <p className="fin-modal__fine num loss" role="alert">
                {error.message}{" "}
                {error.signIn && <Link href="/auth/sign-in">Sign in →</Link>}
              </p>
            )}

            <div className="fin-modal__footer">
              <div className="fin-subtotal-row num">
                <span>You Receive (net of spread)</span>
                <b className="fin-subtotal-row__amount gain">+{usd(totalProceeds)}</b>
              </div>

              <button
                className="btn btn--gold btn--lg btn--block"
                type="button"
                onClick={handleExecuteSellBack}
                disabled={expired || qty < 1 || serials.length === 0}
              >
                {expired ? "Bid expired · reopen for a fresh bid" : `Submit Sell-Back · +${usd(totalProceeds)}`}
              </button>
              <p className="fin-modal__fine num">
                Reviewed and disbursed by the desk · payout reference assigned at disbursement
              </p>
            </div>
          </div>
        )}

        {step === "submitting" && (
          <div className="fin-modal__body fin-modal__body--center">
            <div className="fin-spinner"></div>
            <h3 className="fin-processing__title">Submitting to the desk…</h3>
            <p className="fin-processing__sub num">Recording the request on your ledger.</p>
          </div>
        )}

        {step === "submitted" && request && (
          <div className="fin-modal__body fin-modal__body--confirmed">
            <div className="fin-success-badge">✓</div>
            <h3 className="fin-confirmed__title">Request Recorded</h3>
            <p className="fin-confirmed__sub">
              The units are reserved on your ledger. Proceeds are released when the desk approves and disburses.
            </p>

            <div className="fin-receipt num">
              <div className="fin-receipt__row">
                <span>Request</span>
                <b>{request.id}</b>
              </div>
              <div className="fin-receipt__row">
                <span>Status</span>
                <b>Requested · awaiting desk approval</b>
              </div>
              <div className="fin-receipt__row">
                <span>Units</span>
                <b>{request.title} × {request.quantity}</b>
              </div>
              <div className="fin-receipt__row">
                <span>Net proceeds</span>
                <b className="gain">+{usd(request.lockedBidUsd * request.quantity)}</b>
              </div>
              <div className="fin-receipt__row">
                <span>Payout</span>
                <b>{request.payout === "USDC" ? "USDC" : "Fedwire"} · reference assigned at disbursement</b>
              </div>
            </div>

            <div className="fin-modal__actions">
              <Link className="btn btn--ghost btn--block" href="/vault/sell-back">Track in sell-back terminal</Link>
              <button className="btn btn--gold btn--block" type="button" onClick={onClose}>
                Done · Return to Vault
              </button>
            </div>
          </div>
        )}
    </Modal>
  );
}
