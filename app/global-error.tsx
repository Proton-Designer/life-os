"use client";

import { useEffect } from "react";

// NAV-01c: the root layout itself failed. This replaces it, so it brings its own <html>/<body> and
// cannot rely on globals.css or any component: inline styles in the app's dark palette only.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a0c", color: "#f4f4f5", fontFamily: "system-ui, sans-serif" }}>
        <div role="alert" style={{ maxWidth: 420, padding: 24 }}>
          <p style={{ fontSize: 16, fontWeight: 600, margin: "0 0 8px" }}>Something went wrong</p>
          <p style={{ fontSize: 14, margin: "0 0 16px", color: "#a1a1aa" }}>The app didn&apos;t load. Your data is safe. Try again.</p>
          {error.digest ? <p style={{ fontSize: 12, margin: "0 0 16px", color: "#71717a", fontFamily: "monospace" }}>Reference: {error.digest}</p> : null}
          <button type="button" onClick={() => retry()} style={{ background: "#f4f4f5", color: "#0a0a0c", border: 0, borderRadius: 8, padding: "8px 14px", fontSize: 14, cursor: "pointer" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
