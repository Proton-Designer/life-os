/**
 * P4-12: the expiry choices Settings offers when creating a personal access
 * token. Deliberately NOT server-only and dependency-free: the Settings form
 * (a Client Component) renders the same list the Server Action validates, so
 * the two can never drift.
 *
 * An expiry is an INSTANT (now + N x 24h), not a calendar date, so no
 * timezone is involved and lib/date-utils' local-date rule doesn't apply.
 */

export const TOKEN_EXPIRY_CHOICES = ["7", "30", "90", "never"] as const;
export type TokenExpiryChoice = (typeof TOKEN_EXPIRY_CHOICES)[number];

/** Default: 90 days. Long enough not to nag, short enough that a forgotten token dies on its own. */
export const DEFAULT_TOKEN_EXPIRY: TokenExpiryChoice = "90";

export const TOKEN_EXPIRY_LABELS: Record<TokenExpiryChoice, string> = {
  "7": "7 days",
  "30": "30 days",
  "90": "90 days",
  never: "Never",
};

export function isTokenExpiryChoice(value: unknown): value is TokenExpiryChoice {
  return typeof value === "string" && (TOKEN_EXPIRY_CHOICES as readonly string[]).includes(value);
}

/** ISO instant the token stops working, or null for "never". */
export function expiresAtForChoice(choice: TokenExpiryChoice, now: Date = new Date()): string | null {
  if (choice === "never") return null;
  return new Date(now.getTime() + Number(choice) * 24 * 60 * 60 * 1000).toISOString();
}
