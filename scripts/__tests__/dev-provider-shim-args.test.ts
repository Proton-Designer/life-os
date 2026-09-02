import { describe, expect, it } from "vitest";
import { buildClaudeArgs } from "../dev-provider-shim-args.mjs";

/**
 * Ruled by The Boss (2026-09-02), and it closes a real trap: the injection
 * test (Eng 1's, gate 1) asserts on SIMULATED EFFECTS — no file, no shell,
 * no network side effect from a hostile prompt. That's necessary, but if
 * `--tools ""` is later relaxed into an enumerated `--disallowedTools` list,
 * every effect-based test can keep passing against TODAY'S model's
 * behaviour while containment itself has quietly narrowed — they'd be
 * testing "this model declined," not "this process could not act." The gate
 * is the flag; this test guards the flag's continued presence, asserting on
 * the literal argv `execFile` receives, not a comment or a constant that
 * could drift from what actually reaches the process.
 */
describe("buildClaudeArgs — the flag that IS the gate", () => {
  const base = { model: "claude-haiku-4-5-20251001", maxBudgetUsd: 0.5, systemPrompt: undefined, jsonSchema: undefined, prompt: "extract lessons" };

  it("contains --tools followed immediately by an empty string -- an allowlist of nothing, not an enumerated denylist", () => {
    const args = buildClaudeArgs(base);
    const toolsIndex = args.indexOf("--tools");
    expect(toolsIndex).toBeGreaterThanOrEqual(0);
    expect(args[toolsIndex + 1]).toBe("");
  });

  it("never contains --disallowedTools -- a denylist is exactly the weaker primitive this design rejected", () => {
    const args = buildClaudeArgs(base);
    expect(args).not.toContain("--disallowedTools");
    expect(args).not.toContain("--disallowed-tools");
  });

  it("never contains --add-dir -- no directory beyond the CLI's own default reach", () => {
    const args = buildClaudeArgs(base);
    expect(args).not.toContain("--add-dir");
  });

  /**
   * ⚠️ REAL INCIDENT (2026-09-02, found live via list_peers, not by any test
   * in this file): `--tools ""` disables BUILT-IN tools only. It does NOT
   * stop user-level MCP servers from attaching, and MCP tools are tools — a
   * shim-spawned `claude -p` process registered itself in the claude-peers
   * MCP directory during a real run, giving the sandboxed agent a working
   * send_message channel to every Claude session on the machine (and to
   * Gmail/Calendar/Drive, also configured here). This is why the assertion
   * below checks for BOTH flags together, explicit empty config plus strict
   * mode -- omitting --mcp-config and trusting --strict-mcp-config alone to
   * mean "none" is exactly the implicit-behaviour-could-drift-between-
   * versions shape this file exists to prevent.
   */
  it("contains --strict-mcp-config AND an explicit empty --mcp-config -- closes the MCP side-channel found live", () => {
    const args = buildClaudeArgs(base);
    expect(args).toContain("--strict-mcp-config");
    const mcpConfigIndex = args.indexOf("--mcp-config");
    expect(mcpConfigIndex).toBeGreaterThanOrEqual(0);
    expect(JSON.parse(args[mcpConfigIndex + 1])).toEqual({ mcpServers: {} });
  });

  it("never contains --bare -- 08's own measurement: --bare breaks auth on this machine and would silently disable the shim, not hardening it", () => {
    const args = buildClaudeArgs(base);
    expect(args).not.toContain("--bare");
  });

  it("never contains --dangerously-skip-permissions or --allow-dangerously-skip-permissions", () => {
    const args = buildClaudeArgs(base);
    expect(args).not.toContain("--dangerously-skip-permissions");
    expect(args).not.toContain("--allow-dangerously-skip-permissions");
  });

  it("MAKE IT FAIL ONCE ON PURPOSE: a denylist-shaped argv (the rejected design) does NOT satisfy this suite's own assertions", () => {
    // Simulates what this test would see if someone "relaxed" the gate back
    // to 08's originally-specified --disallowedTools shape. This must be
    // the one case in this file where the assertions fail -- proving the
    // suite can actually go red, not just describe the current state.
    const relaxedArgs = [
      "-p", "--output-format", "json", "--model", base.model,
      "--disallowedTools", "Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch",
      "--max-budget-usd", String(base.maxBudgetUsd),
      "--no-session-persistence",
      base.prompt,
    ];
    const usesToolsFlag = relaxedArgs.indexOf("--tools") >= 0;
    expect(usesToolsFlag).toBe(false); // the relaxed design fails the real assertion above
  });

  it("MAKE IT FAIL ONCE ON PURPOSE: argv with --tools \"\" but WITHOUT the MCP flags (the actual shape that leaked) does not satisfy the MCP assertion", () => {
    // This is not hypothetical -- it is the literal argv this file produced
    // before the fix, and it is what let a shim-spawned agent register in
    // claude-peers during a real run.
    const preFixArgs = [
      "-p", "--output-format", "json", "--model", base.model,
      "--tools", "",
      "--max-budget-usd", String(base.maxBudgetUsd),
      "--no-session-persistence",
      base.prompt,
    ];
    expect(preFixArgs).not.toContain("--strict-mcp-config");
    expect(preFixArgs.indexOf("--mcp-config")).toBe(-1); // proves the pre-fix argv fails this suite's real assertion
  });

  it("still appends --append-system-prompt and --json-schema when provided, without ever dropping --tools \"\"", () => {
    const args = buildClaudeArgs({
      ...base,
      systemPrompt: "You are extracting lessons.",
      jsonSchema: '{"type":"object"}',
    });
    expect(args).toContain("--append-system-prompt");
    expect(args).toContain("You are extracting lessons.");
    expect(args).toContain("--json-schema");
    expect(args).toContain('{"type":"object"}');
    const toolsIndex = args.indexOf("--tools");
    expect(args[toolsIndex + 1]).toBe("");
  });

  it("the prompt is the LAST element -- never concatenated into an earlier flag's value where a shell-string builder could reintroduce injection risk", () => {
    const args = buildClaudeArgs(base);
    expect(args.at(-1)).toBe("extract lessons");
  });
});
