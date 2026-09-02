// dev-provider-shim-args.mjs — the ONE function that decides what argv
// actually reaches `claude -p`. Split out of dev-provider-shim.mjs so it can
// be unit-tested directly (asserting on the real argument array, not a
// config constant or a comment) without importing the server file itself,
// which has a `server.listen(...)` side effect at module load.
//
// Ruled (The Boss, via the ULM lead, 2026-09-02): an injection test alone
// only proves today's flags contain a well-behaved model. If `--tools ""`
// is later relaxed into an enumerated `--disallowedTools` list, every
// simulated-effect test still passes — they'd be testing the MODEL's
// behaviour, not the CONTAINMENT. This function's own test asserts on the
// literal argv this file returns, so a future edit that weakens the flag is
// caught by a red test, not by hoping the injection test would also fail
// (it might not, against a merely-less-thorough denylist that still covers
// today's model's actual behaviour).
//
// ⚠️ REAL INCIDENT, FOUND LIVE (2026-09-02, The Boss's list_peers, not this
// file's own tests): `--tools ""` is an allowlist for BUILT-IN tools only —
// it does NOT stop user-level MCP servers from attaching, and MCP tools are
// tools. A shim-spawned `claude -p` process registered itself in the
// claude-peers MCP directory during a live run, meaning the sandboxed agent
// had a working `send_message` channel to every Claude session on this
// machine, and to any other user-level MCP configured here (Gmail, Calendar,
// Drive). Transient (the process exits after each call) but real while live.
// `--strict-mcp-config` + an explicit EMPTY `--mcp-config` closes it — both
// flags, not one: omitting `--mcp-config` and relying on `--strict-mcp-config`
// alone to mean "none" is exactly the implicit-behaviour-that-could-change-
// between-versions shape this whole file exists to avoid.
export function buildClaudeArgs({ model, maxBudgetUsd, systemPrompt, jsonSchema, prompt }) {
  const args = [
    "-p",
    "--output-format", "json",
    "--model", model,
    // THE gate. An allowlist of nothing — see dev-provider-shim.mjs's header
    // for why this beats an enumerated --disallowedTools. Kept as the exact
    // two-element pair a real `execFile` argv contains, not a flag+value
    // joined into one string, so the test below can assert on it precisely.
    "--tools", "",
    // Closes the MCP side channel above. Explicit empty config + strict
    // mode together, not either alone.
    "--strict-mcp-config",
    "--mcp-config", '{"mcpServers":{}}',
    "--max-budget-usd", String(maxBudgetUsd),
    "--no-session-persistence",
  ];
  if (systemPrompt) args.push("--append-system-prompt", systemPrompt);
  if (jsonSchema) args.push("--json-schema", jsonSchema);
  args.push(prompt);
  return args;
}
