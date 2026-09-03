"use client";

// Shared accessible dialog shell.
//
// The six modals each set role="dialog" and aria-modal, but none trapped focus,
// restored focus on close, closed on Escape, or carried an accessible name — a
// keyboard user could tab straight out of an open dialog into the page behind
// it, and a screen reader announced an unnamed dialog (audit T-04).

import React, { useCallback, useEffect, useId, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({
  onClose,
  label,
  className = "fin-modal",
  children,
}: {
  onClose: () => void;
  /** Accessible name for the dialog. */
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const focusables = useCallback(
    () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
    [],
  );

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;

    // Move focus into the dialog.
    const first = focusables()[0];
    (first ?? panelRef.current)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      // Trap: wrap focus at both ends of the dialog.
      const items = focusables();
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && (active === firstEl || active === panelRef.current)) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    // Stop the page behind the dialog from scrolling.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      restoreTo.current?.focus?.();
    };
  }, [onClose, focusables]);

  return (
    <div
      className="fin-modal-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Accessible name; visually hidden because each modal draws its own heading. */}
        <span id={titleId} className="sr-only">{label}</span>
        {children}
      </div>
    </div>
  );
}
