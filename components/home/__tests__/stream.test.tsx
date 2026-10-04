// @vitest-environment node
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Stream } from "../stream";

async function html(node: React.ReactElement, opts: { onError?: (e: unknown) => void } = {}): Promise<{ shell: string; full: string }> {
  const stream = await renderToReadableStream(node, { onError: opts.onError });
  const reader = stream.getReader();
  const dec = new TextDecoder();
  const first = await reader.read();
  const shell = dec.decode(first.value);
  let full = shell;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    full += dec.decode(value);
  }
  return { shell, full };
}

describe("Stream (NAV-01b)", () => {
  it("flushes the fallback in the shell and the resolved content after it", async () => {
    const slow = new Promise<string>((r) => setTimeout(() => r("sector data"), 30));
    const { shell, full } = await html(
      <div>
        <p>fast module</p>
        <Stream promise={slow} fallback={<i>skeleton</i>}>
          {(v) => <b>{v}</b>}
        </Stream>
      </div>
    );
    expect(shell).toContain("fast module");
    expect(shell).toContain("skeleton");
    expect(shell).not.toContain("sector data"); // the slow module did not block the shell
    expect(full).toContain("sector data");
  });

  it("positive control: awaiting the same promise inline would NOT have the fallback (content only after the wait)", async () => {
    const slow = new Promise<string>((r) => setTimeout(() => r("inline data"), 30));
    async function Inline() {
      return <b>{await slow}</b>;
    }
    const { shell } = await html(<div><p>fast module</p><Inline /></div>);
    // with no Suspense boundary the first flush already includes the awaited content
    expect(shell).toContain("inline data");
  });

  it("a rejected promise is reported through React's error path (not swallowed)", async () => {
    const errors: unknown[] = [];
    const failing = Promise.reject(new Error("boom"));
    failing.catch(() => undefined);
    await html(
      <Stream promise={failing} fallback={<i>skeleton</i>}>
        {(v: string) => <b>{v}</b>}
      </Stream>,
      { onError: (e) => errors.push(e) }
    );
    expect(errors.some((e) => (e as Error).message === "boom")).toBe(true);
  });
});
