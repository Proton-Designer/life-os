import { describe, expect, it, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Regression coverage for the apostrophe-stripping report (2026-09-14):
 * an engineer's commit message came out with every apostrophe silently
 * removed ("jobid 1s" instead of "jobid 1's"). Traced empirically (a
 * scratch-repo demonstration, not just reading the source) to the CALL
 * SITE, not this script: `scripts/agent-commit.sh`'s own `"$MESSAGE"`
 * expansion is a plain double-quoted variable reference and was never the
 * bug — a message wrapped in `'single quotes'` at the invocation (this
 * file's own documented advice, to defeat backtick command substitution)
 * breaks the instant it contains a literal apostrophe, and getting the
 * correct escape (`'it'\''s'`) right by hand is exactly the kind of thing
 * that goes quietly wrong. The fix is the new `-`/stdin form this file
 * tests below: a QUOTED heredoc is immune to the whole class of shell-
 * quoting hazard (apostrophes, backticks, dollar signs, newlines), so
 * nobody has to get manual escaping right again. The pre-existing
 * argv-message form is proven unchanged, and the locking/path-scoping
 * behavior (directory rejection) is proven untouched.
 */

const SCRIPT = path.resolve(__dirname, "../agent-commit.sh");

function makeScratchRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "agent-commit-test-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  writeFileSync(path.join(dir, "file.txt"), "hello\n");
  execFileSync("git", ["add", "file.txt"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  return dir;
}

/** git log's own trailing newline stripped, so this compares like-for-like against the message string a test constructs. */
function lastCommitMessage(dir: string): string {
  return execFileSync("git", ["log", "-1", "--format=%B"], { cwd: dir, encoding: "utf8" }).replace(/\n+$/, "");
}

describe("scripts/agent-commit.sh", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("commits a plain argv message unchanged -- the pre-existing form still works exactly as before", () => {
    dir = makeScratchRepo();
    writeFileSync(path.join(dir, "file.txt"), "v2\n");
    execFileSync("bash", [SCRIPT, "plain message, no special characters", "file.txt"], { cwd: dir });
    expect(lastCommitMessage(dir)).toBe("plain message, no special characters");
  });

  it("commits an apostrophe verbatim via the argv form -- Node's execFile never invokes a shell, so this specific layer was never the bug", () => {
    dir = makeScratchRepo();
    writeFileSync(path.join(dir, "file.txt"), "v2\n");
    execFileSync("bash", [SCRIPT, "today's kill list yet", "file.txt"], { cwd: dir });
    expect(lastCommitMessage(dir)).toBe("today's kill list yet");
  });

  it("commits an apostrophe, a backtick, and a dollar sign verbatim via the new stdin ('-') form", () => {
    dir = makeScratchRepo();
    writeFileSync(path.join(dir, "file.txt"), "v2\n");
    const message = "fix: it's `broken`, and $HOME too";
    execFileSync("bash", [SCRIPT, "-", "file.txt"], { cwd: dir, input: message });
    expect(lastCommitMessage(dir)).toBe(message);
  });

  it("a multi-line stdin message round-trips exactly, with no extra trailing blank line from the heredoc's own newline", () => {
    dir = makeScratchRepo();
    writeFileSync(path.join(dir, "file.txt"), "v2\n");
    const message = "first line\n\nsecond line with an apostrophe: it's here";
    // Simulates a real heredoc body, which always ends in one newline
    // before the closing delimiter.
    execFileSync("bash", [SCRIPT, "-", "file.txt"], { cwd: dir, input: `${message}\n` });
    expect(lastCommitMessage(dir)).toBe(message);
  });

  it("still refuses a directory argument -- path-scoping is unchanged", () => {
    dir = makeScratchRepo();
    mkdirSync(path.join(dir, "subdir"));
    writeFileSync(path.join(dir, "subdir", "f.txt"), "x\n");
    expect(() => execFileSync("bash", [SCRIPT, "should be refused", "subdir"], { cwd: dir, stdio: "pipe" })).toThrow();
    // And nothing was committed.
    expect(lastCommitMessage(dir)).toBe("init");
  });

  it("still refuses when nothing is staged for the given path -- unrelated logic untouched", () => {
    dir = makeScratchRepo();
    // file.txt has no changes at all.
    expect(() => execFileSync("bash", [SCRIPT, "nothing changed", "file.txt"], { cwd: dir, stdio: "pipe" })).toThrow();
  });
});
