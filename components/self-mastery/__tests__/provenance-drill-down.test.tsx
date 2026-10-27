import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GAMIFICATION_CHUNK, GAMIFICATION_QUOTE } from "@/lib/self-mastery/__tests__/__fixtures__/gamification-chunk";

const fetchSourceChunkText = vi.fn();
vi.mock("@/app/(app)/personal/self-mastery-actions", () => ({
  fetchSourceChunkText: (id: string) => fetchSourceChunkText(id),
}));

import { ProvenanceDrillDown } from "../provenance-drill-down";

function open() {
  return render(
    <ProvenanceDrillDown
      open
      onOpenChange={() => {}}
      quote={GAMIFICATION_QUOTE}
      pageRef={null}
      sectionTitle={null}
      sourceChunkId="chunk-1"
    />,
  );
}

describe("ProvenanceDrillDown — the passage in context", () => {
  beforeEach(() => {
    fetchSourceChunkText.mockReset();
    fetchSourceChunkText.mockResolvedValue(GAMIFICATION_CHUNK);
  });

  it("marks the quote inside a short window of paragraphs, not one wall of text", async () => {
    open();
    const mark = await waitFor(() => {
      const el = document.querySelector("mark");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(mark).toHaveTextContent(GAMIFICATION_QUOTE);
    expect(document.querySelectorAll("mark")).toHaveLength(1);

    const passage = mark.closest("div")!;
    const paragraphs = passage.querySelectorAll("p");
    expect(paragraphs.length).toBeGreaterThan(2);
    const shown = Array.from(paragraphs).map((p) => p.textContent).join(" ");
    expect(shown.length).toBeLessThan(GAMIFICATION_CHUNK.length);
    expect(shown).not.toContain("With Anchored Juxtapositions, you must have two options");
    expect(screen.getByRole("button", { name: "Show full passage" })).toBeInTheDocument();
  });

  it("'Show full passage' reveals the whole chunk (same single mark) and 'Show less' goes back", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Show full passage" }));
    const flat = (el: Element) => el.textContent!.replace(/\s+/g, " ");
    const mark = document.querySelector("mark")!;
    const text = flat(mark.closest("div")!);
    expect(text).toContain(GAMIFICATION_CHUNK.replace(/\s+/g, " ").slice(0, 200));
    expect(text).toContain("(just like I did)");
    expect(document.querySelectorAll("mark")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(flat(document.querySelector("mark")!.closest("div")!)).not.toContain(GAMIFICATION_CHUNK.slice(0, 120));
    expect(screen.getByRole("button", { name: "Show full passage" })).toBeInTheDocument();
  });

  it("shows a quote-free opening and no mark when the quote isn't in the chunk", async () => {
    fetchSourceChunkText.mockResolvedValue("One. Two. Three. Four. Five. Six. Seven.");
    open();
    await screen.findByRole("button", { name: "Show full passage" });
    expect(document.querySelector("mark")).toBeNull();
  });

  it("keeps the load-failure message", async () => {
    fetchSourceChunkText.mockResolvedValue(null);
    open();
    expect(await screen.findByText(/Couldn.t load the surrounding text/)).toBeInTheDocument();
  });
});
