"use client";

import Image from "next/image";
import React, { useState, useEffect, useRef } from "react";
import Modal from "./modal";
import { useFintech } from "./global-fintech-provider";
import { useSpot, fmtSpot } from "./use-spot";

/** Slim row returned by /api/search — the catalog itself stays on the server. */
interface SearchRow {
  id: string;
  title: string;
  sku: string;
  mint: string;
  metal: string;
  image: string;
  /** Live engine cash price; null when the piece is quote-only. */
  cashPrice: number | null;
  /** Derived from `cashPrice` server-side — never the static badge text. */
  priceText: string;
}

export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { openCheckout, openPriceAlert, openVerifySerial } = useFintech();
  const spot = useSpot();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Results are stored with the query they answer, so "searching" is derived
  // (the stored answer is for an older query) rather than set inside the effect.
  const [result, setResult] = useState<{ q: string; rows: SearchRow[] }>({ q: "", rows: [] });
  const q = query.trim();
  const active = q.length >= 2;
  const filteredProducts = active ? result.rows : [];
  const searching = active && result.q !== q;

  // Debounced server-side search. Previously every keystroke linear-scanned all
  // 25,457 products in the browser with no debounce (audit P-02).
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        const json = await res.json();
        setResult({ q, rows: json.results ?? [] });
      } catch {
        // aborted or offline — leave the last results in place
      }
    }, 150);
    return () => { clearTimeout(t); controller.abort(); };
  }, [q, active]);

  const quickActions = [
    {
      label: "Enter Vault Portfolio",
      icon: "🏛️",
      shortcut: "G V",
      action: () => (window.location.href = "/vault"),
    },
    {
      label: "Open Market Floor",
      icon: "📈",
      shortcut: "G M",
      action: () => (window.location.href = "/market"),
    },
    {
      label: "Verify Vault Passport / Serial",
      icon: "🔍",
      shortcut: "V S",
      action: () => {
        onClose();
        openVerifySerial();
      },
    },
    {
      label: "Set Gold Spot Alert ($2,400)",
      icon: "🔔",
      shortcut: "S A",
      action: () => {
        onClose();
        openPriceAlert("XAU/USD", 2400);
      },
    },
    {
      label: "Explore Silver Catalog",
      icon: "🥈",
      shortcut: "G S",
      action: () => (window.location.href = "/silver"),
    },
    {
      label: "Explore Platinum & Palladium",
      icon: "⚡",
      shortcut: "G P",
      action: () => (window.location.href = "/platinum"),
    },
  ];

  return (
    <Modal onClose={onClose} label="Command palette" className="fin-cmd">
        {/* Search Header */}
        <div className="fin-cmd__head">
          <svg className="fin-cmd__icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="fin-cmd__input"
            placeholder="Type a coin, mint, SKU, serial, or command... (ESC to exit)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="fin-cmd__esc num" onClick={onClose}>
            ESC
          </span>
        </div>

        {/* Spot Ticker Bar Inside Command Palette */}
        <div className="fin-cmd__ticker num">
          <span>SPOT</span>
          <b className="gain">XAU {fmtSpot(spot, "XAU")}</b>
          <span className="fin-cmd__ticker-sep">·</span>
          <span>XAG {fmtSpot(spot, "XAG")}</span>
          <span className="fin-cmd__ticker-sep">·</span>
          <span>XPT {fmtSpot(spot, "XPT")}</span>
        </div>

        {/* Results Body */}
        <div className="fin-cmd__body">
          {filteredProducts.length > 0 && (
            <div className="fin-cmd__section">
              <div className="fin-cmd__section-title num">Matching Bullion &amp; Numismatics</div>
              {filteredProducts.map((p) => (
                <div
                  key={p.id}
                  className="fin-cmd__item"
                  onClick={() => {
                    onClose();
                    window.location.href = `/product/${p.id}`;
                  }}
                >
                  <div className="fin-cmd__item-left">
                    {p.image && <Image src={p.image} alt={p.title} className="fin-cmd__item-thumb" width={72} height={72} quality={60} />}
                    <div>
                      <b className="fin-cmd__item-name">{p.title}</b>
                      <span className="fin-cmd__item-sub num">
                        {p.mint} · {p.metal}
                      </span>
                    </div>
                  </div>
                  <div className="fin-cmd__item-right num">
                    <span className="fin-cmd__item-price">{p.cashPrice != null ? p.priceText : "Quote"}</span>
                    {/* Only a live-priced piece can be locked; a quote-only one
                        goes to its product page to request a desk price. */}
                    <button
                      type="button"
                      className="btn btn--gold btn--sm"
                      disabled={p.cashPrice == null}
                      title={p.cashPrice == null ? "Priced by the desk — open the product to request a quote" : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (p.cashPrice == null) return;
                        onClose();
                        openCheckout({
                          id: p.id,
                          title: p.title,
                          price: p.cashPrice,
                          image: p.image,
                          mint: p.mint,
                          sku: p.sku,
                        });
                      }}
                    >
                      Instant Buy
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {active && !searching && filteredProducts.length === 0 && (
            <div className="fin-cmd__section">
              <div className="fin-cmd__section-title num">No matches</div>
            </div>
          )}

          <div className="fin-cmd__section">
            <div className="fin-cmd__section-title num">Quick Terminal Actions</div>
            {quickActions.map((qa, i) => (
              <div key={i} className="fin-cmd__item" onClick={qa.action}>
                <div className="fin-cmd__item-left">
                  <span className="fin-cmd__action-icon">{qa.icon}</span>
                  <span className="fin-cmd__item-name">{qa.label}</span>
                </div>
                <span className="fin-cmd__shortcut num">{qa.shortcut}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="fin-cmd__foot num">
          <span>Use <b>↑ ↓</b> to navigate</span>
          <span><b>ENTER</b> to select</span>
          <span><b>CMD + K</b> to toggle</span>
        </div>
    </Modal>
  );
}
