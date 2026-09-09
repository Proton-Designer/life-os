import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getOAuthClient, mintAuthorizationCode, parseScopeParam } from "@/lib/mcp/oauth";
import { renderConsentPage, renderErrorPage, renderLoginRequiredPage } from "@/lib/mcp/authorize-page";
import type { McpScope } from "@/lib/mcp/tokens";

/**
 * RFC 6749 sec 4.1 authorization endpoint, with a MANDATORY consent step —
 * see lib/mcp/authorize-page.ts's header for exactly why that step is not
 * optional, even though this app has exactly one user forever.
 *
 * "No login screen, no consent screen for a second user who doesn't exist"
 * (PROGRAM-PLAN.md's original framing) survives HALF true after the R2
 * red-team: no *login* screen beyond Life OS's own existing one (this route
 * checks the session Life OS already has — a plain cookie, nothing new), but
 * a confirmation step DOES exist, because "which user" was never the
 * question a consent screen answers here — "does this look like the app you
 * meant to connect" is, and DCR's public /register endpoint means that
 * question can be asked by a stranger, not just by Claude.
 *
 * SCOPE DECISION, STATED PLAINLY: an unauthenticated visitor is shown a
 * plain "sign in first" page with a link to /login, not a redirect-then
 * -return-here flow. Claude's own connector click-through happens in the
 * user's browser, where Ayman is normally already logged into Life OS on
 * the same domain — the un-authenticated branch is the uncommon case, not
 * the one to optimize. Wiring a `next=` return-through-login round trip
 * would mean editing app/login/actions.ts, a shared file with its own
 * history; not worth the coupling for a path that, in practice, is rarely
 * hit and costs one manual re-click when it is.
 */

interface ResolvedAuthorize {
  clientId: string;
  clientName: string | null;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string | null;
  resource: string | null;
  scopes: McpScope[];
}

type ResolveResult =
  | { stage: "client_error"; message: string }
  | { stage: "needs_login" }
  | { stage: "redirect_error"; redirectUri: string; state: string | null; error: string; description: string }
  | { stage: "ready"; resolved: ResolvedAuthorize };

/**
 * Shared by GET (render the consent page) and POST (act on the decision) —
 * both need the identical validation, and re-running it on POST rather than
 * trusting the hidden form fields blindly is what makes the POST handler
 * correct even against a tampered form submission.
 */
async function resolveAuthorizeRequest(params: URLSearchParams): Promise<ResolveResult> {
  const clientId = params.get("client_id");
  const redirectUriParam = params.get("redirect_uri");
  const responseType = params.get("response_type");
  const codeChallenge = params.get("code_challenge");
  const codeChallengeMethod = params.get("code_challenge_method");
  const state = params.get("state");
  const resource = params.get("resource");
  const scopeParam = params.get("scope");

  if (!clientId) return { stage: "client_error", message: "Missing client_id." };
  if (!redirectUriParam) return { stage: "client_error", message: "Missing redirect_uri." };

  const serviceClient = createServiceRoleClient();
  const client = await getOAuthClient(serviceClient, clientId);
  if (!client) return { stage: "client_error", message: "Unknown client_id. Register the client before authorizing it." };

  // Exact string match, never a prefix/host comparison — see RFC 6749 sec
  // 3.1.2.3 and lib/mcp/oauth.ts's isValidRedirectUri, which only governs
  // what CAN be registered, not what's presented at authorize time.
  if (!client.redirect_uris.includes(redirectUriParam)) {
    return { stage: "client_error", message: "redirect_uri does not match any URI registered for this client." };
  }

  // From here on, redirectUriParam is a value this client registered for
  // itself — safe to redirect errors to, per RFC 6749 sec 4.1.2.1.
  if (responseType !== "code") {
    return { stage: "redirect_error", redirectUri: redirectUriParam, state, error: "unsupported_response_type", description: "Only response_type=code is supported." };
  }
  if (codeChallengeMethod !== "S256" || !codeChallenge) {
    return { stage: "redirect_error", redirectUri: redirectUriParam, state, error: "invalid_request", description: "PKCE with code_challenge_method=S256 is required." };
  }
  const parsedScopes = parseScopeParam(scopeParam);
  if (parsedScopes === null) {
    return { stage: "redirect_error", redirectUri: redirectUriParam, state, error: "invalid_scope", description: `Unknown scope in "${scopeParam}".` };
  }
  const scopes: McpScope[] = parsedScopes.length > 0 ? parsedScopes : ["read", "write"];

  const user = await getAuthedUser();
  if (!user) return { stage: "needs_login" };

  return {
    stage: "ready",
    resolved: {
      clientId,
      clientName: client.client_name,
      redirectUri: redirectUriParam,
      codeChallenge,
      codeChallengeMethod,
      state,
      resource,
      scopes,
    },
  };
}

function redirectWithError(redirectUri: string, state: string | null, error: string, description: string): Response {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  return NextResponse.redirect(url.toString(), 302);
}

function html(body: string, status = 200): Response {
  return new NextResponse(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const result = await resolveAuthorizeRequest(searchParams);

  switch (result.stage) {
    case "client_error":
      return html(renderErrorPage(result.message), 400);
    case "redirect_error":
      return redirectWithError(result.redirectUri, result.state, result.error, result.description);
    case "needs_login":
      return html(renderLoginRequiredPage("/login"));
    case "ready": {
      const r = result.resolved;
      const hiddenFields: Record<string, string> = {
        client_id: r.clientId,
        redirect_uri: r.redirectUri,
        response_type: "code",
        code_challenge: r.codeChallenge,
        code_challenge_method: r.codeChallengeMethod,
        scope: r.scopes.join(" "),
      };
      if (r.state) hiddenFields.state = r.state;
      if (r.resource) hiddenFields.resource = r.resource;
      return html(
        renderConsentPage({
          clientName: r.clientName,
          clientId: r.clientId,
          redirectUri: r.redirectUri,
          scopes: r.scopes,
          hiddenFields,
          formAction: "/api/mcp/oauth/authorize",
        })
      );
    }
  }
}

export async function POST(request: Request) {
  const form = await request.formData();
  const params = new URLSearchParams();
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params.set(key, value);
  }

  const result = await resolveAuthorizeRequest(params);

  switch (result.stage) {
    case "client_error":
      return html(renderErrorPage(result.message), 400);
    case "redirect_error":
      return redirectWithError(result.redirectUri, result.state, result.error, result.description);
    case "needs_login":
      // The session that rendered the GET consent page has gone away
      // between then and now (e.g. it expired mid-decision) — never mint a
      // code without re-confirming a live session immediately beforehand.
      return html(renderLoginRequiredPage("/login"));
    case "ready": {
      const r = result.resolved;
      const decision = form.get("decision");

      if (decision === "deny") {
        return redirectWithError(r.redirectUri, r.state, "access_denied", "The user denied the request.");
      }
      if (decision !== "allow") {
        return html(renderErrorPage("Missing or invalid decision."), 400);
      }

      const user = await getAuthedUser();
      if (!user) return html(renderLoginRequiredPage("/login"));

      const supabase = await createClient();
      const mintResult = await mintAuthorizationCode(supabase, {
        clientId: r.clientId,
        userId: user.id,
        redirectUri: r.redirectUri,
        codeChallenge: r.codeChallenge,
        codeChallengeMethod: r.codeChallengeMethod,
        resource: r.resource,
        scopes: r.scopes,
      });
      if (!mintResult.ok) {
        return redirectWithError(r.redirectUri, r.state, "server_error", mintResult.message);
      }

      const url = new URL(r.redirectUri);
      url.searchParams.set("code", mintResult.code);
      if (r.state) url.searchParams.set("state", r.state);
      return NextResponse.redirect(url.toString(), 302);
    }
  }
}
