// @vitest-environment node
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";

// The boundary is a client component (useRouter); capture what Stream hands it (a label and children only).
const boundaryProps: { label: string }[] = [];
vi.mock("@/components/shell/inline-error-boundary", () => ({
  InlineErrorBoundary: ({ label, children }: { label: string; children: React.ReactNode }) => {
    boundaryProps.push({ label });
    return <>{children}</>;
  },
}));
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

  // NAV-01c: every Stream sits inside an InlineErrorBoundary named for its module.
  it("wraps the Suspense in an InlineErrorBoundary with the given label (default 'This section')", async () => {
    boundaryProps.length = 0;
    const ok = Promise.resolve("x");
    await html(
      <div>
        <Stream promise={ok} fallback={null} label="Sector progress">
          {(v) => <b>{v}</b>}
        </Stream>
        <Stream promise={ok} fallback={null}>
          {(v) => <b>{v}</b>}
        </Stream>
      </div>
    );
    expect(boundaryProps.map((p) => p.label)).toEqual(["Sector progress", "This section"]);
  });

  it("positive control: nothing wraps a bare Suspense (the helper only records real boundary renders)", async () => {
    boundaryProps.length = 0;
    await html(<div>no stream here</div>);
    expect(boundaryProps).toEqual([]);
  });
});
