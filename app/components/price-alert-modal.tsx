"use client";

import { useSpot, fmtSpot, isIndicative } from "./use-spot";
import React, { useState } from "react";
import Modal from "./modal";
import { useFintech } from "./global-fintech-provider";

/** Where the modal keeps alerts. This is the only place they are stored. */
export const PRICE_ALERTS_KEY = "rm-price-alerts";

export interface StoredPriceAlert {
  id: string;
  symbol: string;
  direction: "above" | "below";
  targetPrice: number;
  channel: "push" | "sms" | "email";
  contact: string;
  createdAt: string;
}

/** "XAU/USD" → "XAU"; the spot feed is keyed by metal symbol. */
function metalOf(symbol: string): string {
  return symbol.split("/")[0]?.trim().toUpperCase() || "XAU";
}

export default function PriceAlertModal({
  symbol = "XAU/USD",
  defaultPrice = 2400.0,
  onClose,
}: {
  symbol?: string;
  defaultPrice?: number;
  onClose: () => void;
}) {
  const spot = useSpot();
  const metal = metalOf(symbol);
  const indicative = isIndicative(spot);
  const [targetPrice, setTargetPrice] = useState(defaultPrice);
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [channel, setChannel] = useState<"push" | "sms" | "email">("push");
  const [phoneOrEmail, setPhoneOrEmail] = useState("");
  const [isSaved, setIsSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { addToast } = useFintech();

  // Alerts are kept in this browser's localStorage only. Nothing on the
  // server watches the market for them yet, and the UI says so — it used to
  // announce "Alert Active & Monitored 24/7" while persisting nothing
  // (audit: Medium — fake alert-armed simulation).
  const handleSave = () => {
    const entry: StoredPriceAlert = {
      id: Math.random().toString(36).slice(2, 10),
      symbol,
      direction,
      targetPrice,
      channel,
      contact: phoneOrEmail.trim(),
      createdAt: new Date().toISOString(),
    };
    try {
      const raw = localStorage.getItem(PRICE_ALERTS_KEY);
      const list: StoredPriceAlert[] = raw ? JSON.parse(raw) : [];
      list.push(entry);
      localStorage.setItem(PRICE_ALERTS_KEY, JSON.stringify(list.slice(-50)));
    } catch {
      setSaveError("This browser refused to store the alert (private mode or storage disabled).");
      return;
    }
    setSaveError(null);
    setIsSaved(true);
    addToast(
      "Price alert saved on this device",
      `${symbol} ${direction} $${targetPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })} — stored in this browser only; delivery is not connected yet.`,
      "info"
    );
    setTimeout(() => {
      onClose();
    }, 1600);
  };

  return (
    <Modal onClose={onClose} label="Set a price alert" className="fin-modal fin-modal--sm">
        <div className="fin-modal__head">
          <div className="fin-modal__title-group">
            <span className="section__index num">Telemetry Alert</span>
            <h2 className="fin-modal__title">Create Price Alert</h2>
          </div>
          <button className="fin-modal__close" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        {!isSaved ? (
          <div className="fin-modal__body">
            <div className="fin-alert-hero num">
              <span className="fin-alert-hero__sym">{symbol}</span>
              <span className="fin-alert-hero__live">
                Current: {fmtSpot(spot, metal)}
                {indicative && <> <span style={{ color: "var(--text-muted)" }}>· indicative</span></>}
              </span>
            </div>
            {indicative && (
              <p className="rm-note num" style={{ marginTop: -4 }}>
                No live feed right now — the mark above is a reference value, not a market observation.
              </p>
            )}

            <div className="fin-form-group">
              <div className="fin-form-group__label">
                <span>Trigger Condition</span>
              </div>
              <div className="fin-tier-pills" role="radiogroup" aria-label="Trigger condition">
                <button
                  type="button"
                  role="radio"
                  aria-checked={direction === "above"}
                  className={`fin-tier-pill ${direction === "above" ? "is-active" : ""}`}
                  onClick={() => setDirection("above")}
                >
                  Rises Above (≥)
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={direction === "below"}
                  className={`fin-tier-pill ${direction === "below" ? "is-active" : ""}`}
                  onClick={() => setDirection("below")}
                >
                  Drops Below (≤)
                </button>
              </div>
            </div>

            <div className="fin-form-group">
              <div className="fin-form-group__label">
                <span>Target Strike Price ($ USD)</span>
              </div>
              <div className="fin-input-wrapper">
                <span className="fin-input-affix num">$</span>
                <input
                  type="number"
                  step="5"
                  className="fin-input num"
                  aria-label="Target strike price in USD"
                  value={targetPrice}
                  onChange={(e) => setTargetPrice(parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>

            <div className="fin-form-group">
              <div className="fin-form-group__label">
                <span>Notification Channel</span>
              </div>
              <div className="fin-rail-cards" role="radiogroup" aria-label="Notification channel">
                {([
                  ["push", "In-App Push", "Banner in this browser"],
                  ["sms", "SMS Text", "Direct mobile carrier alert"],
                  ["email", "Email", "Detailed market digest link"],
                ] as const).map(([key, name, desc]) => (
                  <div
                    key={key}
                    role="radio"
                    tabIndex={0}
                    aria-checked={channel === key}
                    className={`fin-rail-card ${channel === key ? "is-active" : ""}`}
                    onClick={() => setChannel(key)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setChannel(key); } }}
                  >
                    <b className="fin-rail-card__name">{name}</b>
                    <p className="fin-rail-card__desc num">{desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {channel !== "push" && (
              <div className="fin-form-group">
                <div className="fin-form-group__label">
                  <span>{channel === "sms" ? "Mobile Phone Number" : "Email Address"}</span>
                </div>
                <input
                  type={channel === "sms" ? "tel" : "email"}
                  className="fin-input"
                  aria-label={channel === "sms" ? "Mobile phone number" : "Email address"}
                  placeholder={channel === "sms" ? "+1 (555) 000-0000" : "you@vault.com"}
                  value={phoneOrEmail}
                  onChange={(e) => setPhoneOrEmail(e.target.value)}
                />
              </div>
            )}

            <p className="rm-note num" style={{ marginTop: 4 }}>
              Alerts are saved in this browser only. Server-side monitoring and {channel === "push" ? "push" : channel === "sms" ? "SMS" : "email"} delivery are not connected yet, so this alert will not notify you until they are.
            </p>
            {saveError && <p className="rm-note" role="alert" style={{ color: "var(--loss)" }}>{saveError}</p>}

            <div className="fin-modal__footer">
              <button className="btn btn--gold btn--block btn--lg" type="button" onClick={handleSave}>
                Save alert at ${targetPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </button>
            </div>
          </div>
        ) : (
          <div className="fin-modal__body fin-modal__body--confirmed">
            <div className="fin-success-badge">✓</div>
            <h3 className="fin-confirmed__title">Alert saved on this device</h3>
            <p className="fin-confirmed__sub num">
              {symbol} {direction} ${targetPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })} is stored in this browser&apos;s local storage. It is not yet monitored server-side and will not send a notification.
            </p>
          </div>
        )}
    </Modal>
  );
}
