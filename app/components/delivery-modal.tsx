"use client";

// Physical withdrawal from the vault. Submits a real `requestWithdrawal` to
// the ledger store and shows the shipment it creates. This modal used to fake
// a manifest with setTimeout and Math.random (audit: Medium).

import React, { useState } from "react";
import Link from "next/link";
import Modal from "./modal";
import { useFintech } from "./global-fintech-provider";
import { rmAction, RmActionError, fmtDate } from "../lib/use-rm";
import { CARRIER_LABEL, type Carrier, type Shipment } from "../lib/rm-types";

export interface DeliveryItem {
  key: string;
  name: string;
  qtyOwned: number;
  /** Serial numbers of the vaulted units this item represents, in the order they may ship. */
  serials?: string[];
}

const CARRIERS: { id: Carrier; desc: string }[] = [
  { id: "BRINKS", desc: "Armored vehicle · ID signature on delivery" },
  { id: "FEDEX_PRIORITY", desc: "Priority high-value air courier · insured" },
];

/** Same shape check the checkout applies: a street number and enough of an address to route. */
const addressOk = (a: string) => a.trim().length >= 12 && /\d/.test(a);

export default function DeliveryModal({
  item,
  onClose,
}: {
  item: DeliveryItem;
  onClose: () => void;
}) {
  const serials = item.serials ?? [];
  const maxQty = Math.max(0, Math.min(item.qtyOwned, serials.length));
  const [qty, setQty] = useState(maxQty > 0 ? 1 : 0);
  const [address, setAddress] = useState("");
  const [carrier, setCarrier] = useState<Carrier>("BRINKS");
  const [step, setStep] = useState<"configure" | "submitting" | "created">("configure");
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [error, setError] = useState<{ message: string; signIn: boolean } | null>(null);
  const { addToast } = useFintech();

  const handleRequestDelivery = async () => {
    if (qty < 1 || serials.length === 0) return;
    if (!addressOk(address)) {
      setError({ message: "Enter the full delivery address, including the street number.", signIn: false });
      return;
    }
    setStep("submitting");
    setError(null);
    try {
      const shp = await rmAction<Shipment>("requestWithdrawal", {
        serials: serials.slice(0, qty),
        carrier,
        address: address.trim(),
      });
      setShipment(shp);
      setStep("created");
      addToast("Withdrawal requested", `Shipment ${shp.id} is in the fulfilment queue with ${CARRIER_LABEL[shp.carrier]}.`, "gold");
    } catch (e) {
      const signIn = e instanceof RmActionError && (e.status === 401 || e.status === 403);
      setError({
        message: signIn ? "Sign in to request delivery from your vault." : e instanceof Error ? e.message : "The request could not be submitted. Try again.",
        signIn,
      });
      setStep("configure");
    }
  };

  return (
    <Modal onClose={onClose} label="Request physical delivery" className="fin-modal fin-modal--md">
        <div className="fin-modal__head">
          <div className="fin-modal__title-group">
            <span className="section__index num">Physical Withdrawal</span>
            <h2 className="fin-modal__title">
              {step === "created" ? "Withdrawal Requested" : "Request Physical Delivery"}
            </h2>
          </div>
          <button className="fin-modal__close" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        {step === "configure" && (
          <div className="fin-modal__body">
            <p className="fin-verify__intro">
              Pull allocated bullion from the vault. Shipments are sealed in serialized tamper-evident bags, carried by armored courier, and insured under Lloyd&apos;s to $250M.
            </p>

            <div className="fin-order-summary">
              <div className="fin-order-summary__info">
                <h3 className="fin-order-summary__name">{item.name}</h3>
                <p className="fin-order-summary__meta num">
                  You own {item.qtyOwned} in vault · {serials.length} {serials.length === 1 ? "unit" : "units"} available to ship
                </p>
              </div>
            </div>

            {serials.length === 0 && (
              <p className="fin-modal__fine num">
                No serials were attached to this item. <Link href="/vault/delivery">Open the withdrawal page</Link> to choose the exact units.
              </p>
            )}

            <div className="fin-form-group">
              <div className="fin-form-group__label">
                <span>Quantity to Withdraw</span>
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
                  aria-label="Quantity to withdraw"
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
                <span>Armored Courier Service</span>
              </div>
              <div className="fin-rail-cards" role="radiogroup" aria-label="Courier">
                {CARRIERS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={carrier === c.id}
                    className={`fin-rail-card ${carrier === c.id ? "is-active" : ""}`}
                    onClick={() => setCarrier(c.id)}
                  >
                    <b className="fin-rail-card__name">{CARRIER_LABEL[c.id]}</b>
                    <p className="fin-rail-card__desc num">{c.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="fin-form-group">
              <label className="fin-form-group__label" htmlFor="delivery-address">
                <span>Delivery Address</span>
              </label>
              <input
                id="delivery-address"
                type="text"
                className="fin-input"
                autoComplete="street-address"
                placeholder="Street, city, state, ZIP"
                value={address}
                onChange={(e) => { setAddress(e.target.value); if (error && !error.signIn) setError(null); }}
              />
            </div>

            {error && (
              <p className="fin-modal__fine num loss" role="alert">
                {error.message}{" "}
                {error.signIn && <Link href="/auth/sign-in">Sign in →</Link>}
              </p>
            )}

            <div className="fin-modal__footer">
              <button
                className="btn btn--gold btn--lg btn--block"
                type="button"
                onClick={handleRequestDelivery}
                disabled={qty < 1 || serials.length === 0}
              >
                Request Armored Withdrawal · {qty} {qty === 1 ? "Item" : "Items"}
              </button>
              <p className="fin-modal__fine num">
                Photo ID matching the account is required at delivery
              </p>
            </div>
          </div>
        )}

        {step === "submitting" && (
          <div className="fin-modal__body fin-modal__body--center">
            <div className="fin-spinner"></div>
            <h3 className="fin-processing__title">Submitting withdrawal…</h3>
            <p className="fin-processing__sub num">Reserving the units on your ledger.</p>
          </div>
        )}

        {step === "created" && shipment && (
          <div className="fin-modal__body fin-modal__body--confirmed">
            <div className="fin-success-badge">✓</div>
            <h3 className="fin-confirmed__title">In the Fulfilment Queue</h3>
            <p className="fin-confirmed__sub">
              The units are reserved for withdrawal. Tracking goes live when the vault dispatches the shipment.
            </p>

            <div className="fin-receipt num">
              <div className="fin-receipt__row">
                <span>Shipment</span>
                <b className="gain">{shipment.id}</b>
              </div>
              <div className="fin-receipt__row">
                <span>Status</span>
                <b>Preparing · awaiting dispatch</b>
              </div>
              <div className="fin-receipt__row">
                <span>Contents</span>
                <b>{shipment.contents}</b>
              </div>
              <div className="fin-receipt__row">
                <span>Carrier</span>
                <b>{CARRIER_LABEL[shipment.carrier]} · {shipment.trackingNumber}</b>
              </div>
              <div className="fin-receipt__row">
                <span>Deliver to</span>
                <b>{shipment.address}</b>
              </div>
              <div className="fin-receipt__row">
                <span>Estimated arrival</span>
                <b>{fmtDate(shipment.eta)}</b>
              </div>
              <div className="fin-receipt__row">
                <span>Insurance</span>
                <b>Policy {shipment.insurancePolicy} · seal {shipment.tamperSealBarcode}</b>
              </div>
            </div>

            <div className="fin-modal__actions">
              <Link className="btn btn--ghost btn--block" href="/vault/delivery">Track withdrawal</Link>
              <button className="btn btn--gold btn--block" type="button" onClick={onClose}>
                Done · Return to Vault
              </button>
            </div>
          </div>
        )}
    </Modal>
  );
}
