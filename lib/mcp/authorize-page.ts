/**
 * The /authorize consent screen's HTML, as pure string-building functions —
 * kept separate from lib/mcp/oauth.ts's protocol logic and independently
 * testable, specifically for the one property that matters most here:
 * `client_name` is attacker-controlled (any stranger can set it via the
 * public, unauthenticated DCR /register endpoint — see oauth.ts's own
 * header), so it MUST be HTML-escaped before it ever reaches a response
 * body. This file is small on purpose — the one thing worth getting
 * exactly right is escaping, not layout.
 *
 * WHY THIS PAGE EXISTS AT ALL — the finding from Eng2's R2 red-team
 * (docs/ai-connector/PROGRAM-PLAN.md): "no consent screen, single user,
 * auto-approve" was the original plan, and it is a real vulnerability, not
 * a UX simplification. DCR is a public endpoint (RFC 7591) — anyone can
 * register a client with their OWN redirect_uri and craft a link to
 * /authorize naming it. If /authorize silently auto-approved any
 * registered client for an already-logged-in session, that crafted link
 * would complete a full authorization-code-interception attack against
 * Ayman's account the moment he clicked it, with nothing to notice.
 * Requiring an explicit click on a screen that NAMES the requesting client
 * and shows the exact redirect host is the standard OAuth mitigation for
 * exactly this ("confused deputy") attack class, and it survives being the
 * only user, because the thing that needed confirming was never "which
 * user" — it was "does this look like an app you meant to authorize."
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const PAGE_STYLE = `
  body { background: #1a1a1f; color: #e8e6e3; font-family: system-ui, -apple-system, sans-serif;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; }
  .card { max-width: 420px; width: 100%; background: #24242b; border: 1px solid #3a3a44; border-radius: 12px; padding: 28px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .sub { color: #a0a0aa; font-size: 13px; margin: 0 0 20px; }
  .client { background: #1a1a1f; border: 1px solid #3a3a44; border-radius: 8px; padding: 14px; margin-bottom: 20px; }
  .client-name { font-weight: 600; font-size: 15px; }
  .client-detail { color: #a0a0aa; font-size: 12px; margin-top: 4px; word-break: break-all; }
  .scopes { font-size: 13px; color: #cfcfd6; margin-bottom: 20px; }
  .actions { display: flex; gap: 10px; }
  button { flex: 1; padding: 10px 16px; border-radius: 8px; border: none; font-size: 14px; cursor: pointer; }
  .allow { background: #7a2e2e; color: #fff; }
  .deny { background: transparent; color: #a0a0aa; border: 1px solid #3a3a44; }
  a { color: #c98a8a; }
`;

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PAGE_STYLE}</style></head><body><div class="card">${body}</div></body></html>`;
}

export function renderLoginRequiredPage(loginUrl: string): string {
  return page(
    "Sign in — Life OS",
    `<h1>Sign in to Life OS first</h1>
     <p class="sub">This connector needs you to be signed in before it can request access.</p>
     <a href="${escapeHtml(loginUrl)}">Go to sign in</a>`
  );
}

export function renderErrorPage(message: string): string {
  return page("Can't authorize — Life OS", `<h1>Can't complete this request</h1><p class="sub">${escapeHtml(message)}</p>`);
}

export interface ConsentPageParams {
  clientName: string | null;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  /** Every original query param, re-emitted as hidden fields so the POST can re-validate from scratch. */
  hiddenFields: Record<string, string>;
  formAction: string;
}

export function renderConsentPage(params: ConsentPageParams): string {
  const redirectHost = (() => {
    try {
      return new URL(params.redirectUri).host;
    } catch {
      return params.redirectUri;
    }
  })();
  const hidden = Object.entries(params.hiddenFields)
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join("");

  return page(
    "Authorize a connector — Life OS",
    `<h1>Allow this app to access Life OS?</h1>
     <p class="sub">Check that this is the app you meant to connect before allowing it.</p>
     <div class="client">
       <div class="client-name">${escapeHtml(params.clientName ?? "Unnamed app")}</div>
       <div class="client-detail">Will send you to: <strong>${escapeHtml(redirectHost)}</strong></div>
       <div class="client-detail">Client ID: ${escapeHtml(params.clientId)}</div>
     </div>
     <div class="scopes">Requesting: ${params.scopes.map(escapeHtml).join(", ")}</div>
     <form method="POST">
       ${hidden}
       <div class="actions">
         <button class="deny" type="submit" name="decision" value="deny">Deny</button>
         <button class="allow" type="submit" name="decision" value="allow">Allow</button>
       </div>
     </form>`
  );
}

export { escapeHtml };
