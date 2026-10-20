// Writes that must survive the tab closing. A Server Action is queued behind others and cancelled with the page; a
// keepalive fetch is handed to the browser and finishes after it. text/plain keeps it a "simple" request (no CORS
// preflight), like navigator.sendBeacon. Position has its own sender in position-sync.ts.

async function post(path: string, payload: unknown): Promise<boolean> {
  try {
    const res = await fetch(path, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "content-type": "text/plain" },
      keepalive: true,
      credentials: "same-origin",
    });
    return res.ok;
  } catch {
    return false; // offline or blocked: the caller decides whether that matters
  }
}

/** Resolves true when the server stored the stretch. */
export function sendSessionBeacon(stretch: unknown): Promise<boolean> {
  return post("/api/reader/session", stretch);
}

/** Resolves true when the server stored the settings patch. */
export function sendSettingsBeacon(patch: unknown): Promise<boolean> {
  return post("/api/reader/settings", patch);
}
