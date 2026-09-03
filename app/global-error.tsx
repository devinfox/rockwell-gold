"use client";

// Catches errors thrown in the root layout itself, so it must render <html>/<body>.
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", background: "#fbfaf7", color: "#15120c" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: ".5rem" }}>Rockwell Metals is temporarily unavailable.</h1>
        <p style={{ color: "#7a756b", marginBottom: "1.5rem" }}>
          We hit an unexpected error. Please try again in a moment.
        </p>
        {error.digest && (
          <p style={{ fontFamily: "monospace", fontSize: ".8rem", color: "#7a756b" }}>Reference: {error.digest}</p>
        )}
        <button
          type="button"
          onClick={() => retry()}
          style={{ marginTop: "1rem", padding: ".6rem 1.2rem", border: "1px solid #9a7226", background: "#9a7226", color: "#fff", borderRadius: 6, cursor: "pointer" }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
