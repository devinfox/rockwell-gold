"use client";

// Route-level error boundary. Next.js 16 passes `retry` (not `reset`) —
// see node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md
import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[rockwell] route error:", error);
  }, [error]);

  return (
    <main className="wrap rm-main" style={{ maxWidth: 640 }}>
      <div className="rm-head">
        <span className="section__index num">ERROR</span>
        <h1 className="rm-title">Something went wrong.</h1>
        <p className="rm-sub">
          That page failed to load. Nothing you were doing was lost — orders and vault holdings are
          written server-side before the page renders.
        </p>
        {error.digest && <p className="rm-note num">Reference: {error.digest}</p>}
      </div>
      <div className="rm-actions">
        <button className="btn btn--gold" type="button" onClick={() => retry()}>Try again</button>
        <Link className="btn btn--ghost" href="/">Back to the storefront</Link>
        <Link className="btn btn--ghost" href="/support">Contact support</Link>
      </div>
    </main>
  );
}
