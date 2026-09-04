"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { initPdp } from "../lib/pdp";
import { createLock } from "../lib/checkout";
import type { Custody, PayMethod } from "../lib/rm-types";
import { useFintech } from "./global-fintech-provider";

export interface PdpRuntimeProps {
  id?: string;
  title?: string;
  /** Unit cash price at qty 1, or 0 when the piece cannot be bought from this page. */
  price?: number;
  image?: string;
  mint?: string;
  sku?: string;
  serial?: string;
}

type QuoteResponse = {
  mode: string;
  cashPrice: number;
  spotUsed: number;
  lockToken: string | null;
};

const PAY_METHODS: readonly PayMethod[] = ["WIRE", "CARD"];
const CUSTODIES: readonly Custody[] = ["VAULT", "DELIVERY"];

/**
 * The rail / custody the customer picked in the buy box. pdp.js keeps the
 * `--on` class on the selected radio; the uppercase enum lives in
 * `data-rail` / `data-custody` on the same buttons (see product/[id]/page.tsx).
 */
function selectedPayMethod(): PayMethod | undefined {
  const v = document.querySelector<HTMLElement>(".pay.pay--on")?.dataset.rail;
  return PAY_METHODS.find((m) => m === v);
}
function selectedCustody(): Custody | undefined {
  const v = document.querySelector<HTMLElement>(".cust.cust--on")?.dataset.custody;
  return CUSTODIES.find((c) => c === v);
}

export default function PdpRuntime({
  id = "",
  title = "",
  price = 0,
  image = "",
  mint = "",
  sku = "",
  serial = "",
}: PdpRuntimeProps) {
  const { openVerifySerial, addToast } = useFintech();
  const router = useRouter();

  // Provider callbacks are recreated on every provider render; holding them in
  // refs keeps this effect from re-initialising the page (duplicated tapes,
  // stacked listeners) whenever a toast or modal opens.
  const verifyRef = useRef(openVerifySerial);
  const toastRef = useRef(addToast);
  useEffect(() => {
    verifyRef.current = openVerifySerial;
    toastRef.current = addToast;
  }, [openVerifySerial, addToast]);

  useEffect(() => {
    document.body.className = "pdp";
    const cleanup = initPdp();
    let locking = false;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const buyBtn = target.closest(".buybox__cta .btn--gold, .buybar__btn");
      if (buyBtn) {
        e.preventDefault();
        // Only a priced, in-stock piece can be locked. "Notify me" and
        // "Request a quote" share the button styling but never reach checkout
        // (audit: High — unpriced products created $0 orders).
        if (!(price > 0) || locking) return;
        locking = true;
        (buyBtn as HTMLButtonElement).disabled = true;

        const box = document.querySelector<HTMLElement>(".buybox");
        const shownUnit = parseFloat(box?.getAttribute("data-price") ?? "");
        const shownSpot = parseFloat(box?.getAttribute("data-spot-used") ?? "");
        const qtyInput = document.querySelector<HTMLInputElement>("[data-qty-input]");
        const qty = Math.min(999, Math.max(1, parseInt(qtyInput?.value || "1", 10) || 1));
        // Rail and custody travel with the lock so checkout can start from
        // the same selection the customer made here (audit: Medium). The
        // checkout page reads `lock.payMethod` / `lock.custody`.
        const payMethod = selectedPayMethod();
        const custody = selectedCustody();

        // Freeze the price server-side: a fresh quote carries the signed lock
        // token placeOrder settles against. The quote is taken at the chosen
        // quantity so the unit price reflects the volume tier shown on the
        // page. If the quote is unreachable the lock still opens and the
        // server prices at the live mark.
        void (async () => {
          let unitPrice = Number.isFinite(shownUnit) && shownUnit > 0 ? shownUnit : price;
          let spotAtLock = Number.isFinite(shownSpot) && shownSpot > 0 ? shownSpot : undefined;
          let lockToken: string | undefined;
          try {
            const r = await fetch(`/api/quote?id=${encodeURIComponent(id)}&qty=${qty}`, { cache: "no-store" });
            if (r.ok) {
              const q = (await r.json()) as QuoteResponse;
              if (q.mode !== "enquire" && q.cashPrice > 0) {
                unitPrice = q.cashPrice;
                spotAtLock = q.spotUsed;
                lockToken = q.lockToken ?? undefined;
              } else {
                toastRef.current("Quote only", "This piece is priced by the desk. Request a quote to buy it.", "info");
                return;
              }
            }
          } catch {
            /* fall through: lock at the shown price, server prices live */
          } finally {
            locking = false;
            (buyBtn as HTMLButtonElement).disabled = false;
          }
          const lock = createLock({ productId: id, title, sku, image, mint, unitPrice, spotAtLock, qty, lockToken, payMethod, custody });
          router.push(`/checkout/${lock.id}`);
        })();
      }

      const verifyBtn = target.closest(".passport__btn");
      if (verifyBtn) {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>("[data-verify-input]");
        verifyRef.current(input?.value || serial);
      }
    };

    document.addEventListener("click", handleClick);
    return () => {
      cleanup();
      document.removeEventListener("click", handleClick);
      document.body.className = "";
    };
  }, [id, title, price, image, mint, sku, serial, router]);

  return null;
}
