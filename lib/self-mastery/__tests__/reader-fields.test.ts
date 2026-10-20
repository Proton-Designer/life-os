import { describe, it, expect } from "vitest";
import { canOpenInReader, toReadProgress } from "../types";

describe("canOpenInReader", () => {
  it("ready document: yes. Not yet built: yes once the book is ready or has its file", () => {
    expect(canOpenInReader({ readerStatus: "ready", status: "processing", hasFile: false })).toBe(true);
    expect(canOpenInReader({ readerStatus: "none", status: "ready", hasFile: false })).toBe(true); // rebuilt from stored text
    expect(canOpenInReader({ readerStatus: "none", status: "processing", hasFile: true })).toBe(true); // readable mid-ingestion
    expect(canOpenInReader({ readerStatus: "none", status: "failed", hasFile: true })).toBe(true);
  });
  it("nothing to read from, or a half-done import: no", () => {
    expect(canOpenInReader({ readerStatus: "none", status: "uploading", hasFile: false })).toBe(false);
    expect(canOpenInReader({ readerStatus: "preparing", status: "ready", hasFile: true })).toBe(false);
    expect(canOpenInReader({ readerStatus: "failed", status: "ready", hasFile: true })).toBe(false);
  });
});

describe("toReadProgress", () => {
  it("percent of the book, capped, null without a bookmark or word count", () => {
    expect(toReadProgress({ word_index: 250, client_updated_at: "t" }, 1000)).toEqual({ wordIndex: 250, pct: 25, updatedAt: "t" });
    expect(toReadProgress({ word_index: 5000, client_updated_at: "t" }, 1000)?.pct).toBe(100);
    expect(toReadProgress({ word_index: 5, client_updated_at: "t" }, null)?.pct).toBeNull();
    expect(toReadProgress(undefined, 1000)).toBeNull();
  });
});
