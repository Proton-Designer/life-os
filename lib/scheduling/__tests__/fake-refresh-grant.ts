import type { FakeMcpDb } from "./fake-mcp-tables";

/**
 * A JS MIRROR of public.mcp_oauth_refresh_grant (supabase/migrations/217),
 * installed on the in-memory fake so route + scheduler-runner tests keep
 * exercising the whole refresh flow end to end. It is a test double, not the
 * thing under test: the SQL function itself was proven against a real Postgres
 * (all outcomes, rollback, and the concurrent race with a lock-less control)
 * -- see the P4-13 task Log. Keep the two in step: same outcomes, same order
 * (reuse -> burn all unused for the pair + revoke replayed and live tokens;
 * revoked/missing -> spend refresh token, mint nothing; ok -> rotate, revoke
 * old, insert new mcp_oauth token with the same scopes, re-point scheduled
 * actions, insert next refresh row). The in-memory fake is single-threaded,
 * so the advisory lock has no JS counterpart.
 */
export function installRefreshGrantEmulation(db: FakeMcpDb): void {
  let seq = 0;
  db.rpcHandlers.mcp_oauth_refresh_grant = (args) => {
    const t = db.tables;
    const now = new Date().toISOString();
    const refresh = (t.mcp_oauth_refresh_tokens ??= []);
    const tokens = (t.mcp_access_tokens ??= []);
    const schedules = (t.mcp_scheduled_actions ??= []);

    const row = refresh.find((r) => r.token_hash === args.p_refresh_token_hash);
    if (!row) return { outcome: "invalid" };

    const pair = (r: Record<string, unknown>) => r.user_id === row.user_id && r.client_id === row.client_id;

    if (row.rotated_at) {
      const liveIds = refresh.filter((r) => pair(r) && !r.rotated_at).map((r) => r.access_token_id);
      let burned = 0;
      for (const r of refresh) if (pair(r) && !r.rotated_at) { r.rotated_at = now; burned++; }
      let revoked = 0;
      for (const tok of tokens) {
        if (tok.user_id === row.user_id && !tok.revoked_at && (tok.id === row.access_token_id || liveIds.includes(tok.id))) {
          tok.revoked_at = now;
          revoked++;
        }
      }
      return { outcome: "reuse", user_id: row.user_id, client_id: row.client_id, burned_refresh_tokens: burned, revoked_access_tokens: revoked };
    }

    row.rotated_at = now;
    const old = tokens.find((tok) => tok.id === row.access_token_id && tok.user_id === row.user_id);
    if (!old || old.revoked_at || !Array.isArray(old.scopes) || old.scopes.length === 0) {
      return { outcome: "revoked", user_id: row.user_id, client_id: row.client_id };
    }

    old.revoked_at = now;
    const newId = `tok-granted-${++seq}`;
    tokens.push({
      id: newId,
      user_id: row.user_id,
      token_hash: args.p_new_access_token_hash,
      token_last4: args.p_new_access_token_last4,
      label: args.p_label,
      scopes: [...(old.scopes as string[])],
      created_at: now,
      last_used_at: null,
      revoked_at: null,
      expires_at: args.p_expires_at,
      client_kind: "mcp_oauth",
    });
    let repointed = 0;
    for (const s of schedules) if (s.user_id === row.user_id && s.token_id === old.id) { s.token_id = newId; repointed++; }
    refresh.push({ id: `rt-granted-${seq}`, token_hash: args.p_new_refresh_token_hash, access_token_id: newId, client_id: row.client_id, user_id: row.user_id, created_at: now, rotated_at: null });

    return { outcome: "ok", user_id: row.user_id, client_id: row.client_id, access_token_id: newId, scopes: old.scopes, repointed_scheduled_actions: repointed };
  };
}
