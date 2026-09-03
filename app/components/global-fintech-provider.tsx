"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createLock } from "../lib/checkout";
import CommandPalette from "./command-palette";
import PriceAlertModal from "./price-alert-modal";
import SerialVerifyModal from "./serial-verify-modal";
import SellBackModal, { SellBackItem } from "./sellback-modal";
import DeliveryModal, { DeliveryItem } from "./delivery-modal";
import { InitialSessionContext, type InitialSession } from "../lib/initial-session";

export type ToastType = "gain" | "info" | "gold" | "loss";

/** Minimal shape needed to open a price lock from anywhere in the UI. */
/**
 * Prototype-era product ids still used by the home page hero/tiles and the nav
 * "Instant Buy", mapped to the launch catalog. Prices always come from /api/quote.
 */
const LEGACY_PRODUCT_IDS: Record<string, string> = {
  "buffalo-1oz": "561",
  "eagle-1oz": "6",
  "eagle-2025": "6",
  "britannia-1oz": "25",
  "britannia-2025": "25",
  "maple-1oz": "28",
  "maple-2025": "28",
  "kangaroo-1oz": "22",
  "kangaroo-2025": "22",
};

export interface OrderItem {
  id: string;
  title: string;
  price: number;
  weight?: number;
  image?: string;
  mint?: string;
  sku?: string;
  serial?: string;
}

interface Toast {
  id: string;
  title: string;
  message: string;
  type: ToastType;
  timestamp: string;
}

interface FintechContextType {
  openCheckout: (item: OrderItem) => void;
  closeCheckout: () => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  openPriceAlert: (symbol?: string, targetPrice?: number) => void;
  closePriceAlert: () => void;
  openVerifySerial: (serial?: string) => void;
  closeVerifySerial: () => void;
  openSellBack: (item: SellBackItem) => void;
  closeSellBack: () => void;
  openDelivery: (item: DeliveryItem) => void;
  closeDelivery: () => void;
  watchlist: string[];
  toggleWatchlist: (productId: string) => void;
  isWatchlisted: (productId: string) => boolean;
  addToast: (title: string, message: string, type?: ToastType) => void;
}

const FintechContext = createContext<FintechContextType | null>(null);

export function useFintech() {
  const context = useContext(FintechContext);
  if (!context) {
    throw new Error("useFintech must be used within a GlobalFintechProvider");
  }
  return context;
}

export default function GlobalFintechProvider({
  children,
  initialSession = null,
}: {
  children: ReactNode;
  /** Session resolved server-side by the root layout; seeds useRm/SiteNav before their first fetch. */
  initialSession?: InitialSession | null;
}) {
  const router = useRouter();
  // Modal states
  const [isCmdOpen, setIsCmdOpen] = useState(false);
  const [alertConfig, setAlertConfig] = useState<{ isOpen: boolean; symbol: string; targetPrice: number }>({
    isOpen: false,
    symbol: "XAU/USD",
    targetPrice: 2400.0,
  });
  const [verifySerial, setVerifySerial] = useState<{ isOpen: boolean; serial: string }>({
    isOpen: false,
    serial: "RM-AU-BUF-7741",
  });
  const [sellBackItem, setSellBackItem] = useState<SellBackItem | null>(null);
  const [deliveryItem, setDeliveryItem] = useState<DeliveryItem | null>(null);

  // Watchlist & Toast states
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    try {
      const savedWatchlist = localStorage.getItem("rm-watchlist");
      // localStorage is only readable after mount (SSR renders an empty list).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (savedWatchlist) setWatchlist(JSON.parse(savedWatchlist));
    } catch {}

    // Global Cmd+K keyboard shortcut
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsCmdOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const toggleWatchlist = (productId: string) => {
    setWatchlist((prev) => {
      const next = prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId];
      try {
        localStorage.setItem("rm-watchlist", JSON.stringify(next));
      } catch {}
      addToast(
        prev.includes(productId) ? "Removed from Watchlist" : "Added to Watchlist",
        `Item ${productId} updated in your market watch.`,
        "info"
      );
      return next;
    });
  };

  const isWatchlisted = (productId: string) => watchlist.includes(productId);

  const addToast = (title: string, message: string, type: ToastType = "gold") => {
    const id = Math.random().toString(36).substring(2, 9);
    const newToast: Toast = {
      id,
      title,
      message,
      type,
      timestamp: "just now",
    };
    setToasts((prev) => [newToast, ...prev.slice(0, 4)]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  /**
   * Opens the one real settlement flow: freeze a price, then hand off to
   * /checkout/[lock_id]. This used to open a second, parallel checkout modal
   * that fabricated a transaction hash and a serial and persisted nothing —
   * no order, no holding, no audit entry (audit B-04).
   */
  const openCheckout = async (item: OrderItem) => {
    // Lock against a live server quote, never the price baked into a button.
    // Prototype ids from the home page / nav map onto real catalog products;
    // anything the engine will not price is sent to its product page instead
    // (audit: High — "Instant Buy locked a phantom product at a hardcoded price").
    const id = LEGACY_PRODUCT_IDS[item.id] ?? item.id;
    try {
      const r = await fetch(`/api/quote?id=${encodeURIComponent(id)}&qty=1`, { cache: "no-store" });
      if (!r.ok) throw new Error("no quote");
      const q = (await r.json()) as {
        mode: string; cashPrice: number; spotUsed: number; lockToken: string | null;
        title?: string; sku?: string; image?: string; mint?: string;
      };
      if (q.mode === "enquire" || !(q.cashPrice > 0)) throw new Error("enquire");
      const lock = createLock({
        productId: id,
        title: q.title ?? item.title,
        sku: q.sku ?? item.sku,
        image: q.image ?? item.image,
        mint: q.mint ?? item.mint,
        unitPrice: q.cashPrice,
        spotAtLock: q.spotUsed,
        lockToken: q.lockToken ?? undefined,
      });
      router.push(`/checkout/${lock.id}`);
    } catch {
      addToast("Not available for instant purchase", "Open the product page to request a quote from the desk.", "info");
      router.push(`/product/${encodeURIComponent(id)}`);
    }
  };
  const closeCheckout = () => {};

  const openCommandPalette = () => setIsCmdOpen(true);
  const closeCommandPalette = () => setIsCmdOpen(false);

  const openPriceAlert = (symbol = "XAU/USD", targetPrice = 2400.0) =>
    setAlertConfig({ isOpen: true, symbol, targetPrice });
  const closePriceAlert = () =>
    setAlertConfig((prev) => ({ ...prev, isOpen: false }));

  const openVerifySerial = (serial = "RM-AU-BUF-7741") =>
    setVerifySerial({ isOpen: true, serial });
  const closeVerifySerial = () =>
    setVerifySerial((prev) => ({ ...prev, isOpen: false }));

  const openSellBack = (item: SellBackItem) => setSellBackItem(item);
  const closeSellBack = () => setSellBackItem(null);

  const openDelivery = (item: DeliveryItem) => setDeliveryItem(item);
  const closeDelivery = () => setDeliveryItem(null);

  return (
    <InitialSessionContext.Provider value={initialSession}>
    <FintechContext.Provider
      value={{
        openCheckout,
        closeCheckout,
        openCommandPalette,
        closeCommandPalette,
        openPriceAlert,
        closePriceAlert,
        openVerifySerial,
        closeVerifySerial,
        openSellBack,
        closeSellBack,
        openDelivery,
        closeDelivery,
        watchlist,
        toggleWatchlist,
        isWatchlisted,
        addToast,
      }}
    >
      {children}

      {/* Global Modals */}
      {isCmdOpen && <CommandPalette onClose={closeCommandPalette} />}
      {alertConfig.isOpen && (
        <PriceAlertModal
          symbol={alertConfig.symbol}
          defaultPrice={alertConfig.targetPrice}
          onClose={closePriceAlert}
        />
      )}
      {verifySerial.isOpen && (
        <SerialVerifyModal
          initialSerial={verifySerial.serial}
          onClose={closeVerifySerial}
        />
      )}
      {sellBackItem && (
        <SellBackModal item={sellBackItem} onClose={closeSellBack} />
      )}
      {deliveryItem && (
        <DeliveryModal item={deliveryItem} onClose={closeDelivery} />
      )}

      {/* Global Toast Stream */}
      <div className="toast-container" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-card toast-card--${t.type}`} role={t.type === "loss" ? "alert" : undefined}>
            <div className="toast-card__head">
              <span className="toast-card__dot"></span>
              <b className="toast-card__title">{t.title}</b>
              <span className="toast-card__time num">{t.timestamp}</span>
            </div>
            <p className="toast-card__msg">{t.message}</p>
          </div>
        ))}
      </div>
    </FintechContext.Provider>
    </InitialSessionContext.Provider>
  );
}
