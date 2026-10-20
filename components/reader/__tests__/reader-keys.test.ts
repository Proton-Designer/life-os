// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readerKeyAction } from "../reader-keys";

function ev(key: string, extra: Partial<Parameters<typeof readerKeyAction>[0]> = {}) {
  return { key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false, target: document.body, ...extra };
}

describe("readerKeyAction", () => {
  it("maps the reader keys", () => {
    expect(readerKeyAction(ev(" "), "rsvp")).toBe("toggle");
    expect(readerKeyAction(ev("ArrowLeft"), "rsvp")).toBe("back");
    expect(readerKeyAction(ev("ArrowRight"), "rsvp")).toBe("forward");
    expect(readerKeyAction(ev("ArrowLeft", { shiftKey: true }), "rsvp")).toBe("backParagraph");
    expect(readerKeyAction(ev("ArrowRight", { shiftKey: true }), "page")).toBe("forwardParagraph");
    expect(readerKeyAction(ev("ArrowUp"), "rsvp")).toBe("wpmUp");
    expect(readerKeyAction(ev("ArrowDown"), "rsvp")).toBe("wpmDown");
  });
  it("leaves up/down to native scrolling in page view", () => {
    expect(readerKeyAction(ev("ArrowUp"), "page")).toBeNull();
    expect(readerKeyAction(ev("ArrowDown"), "page")).toBeNull();
  });
  it("ignores unrelated keys and modified/handled events", () => {
    expect(readerKeyAction(ev("a"), "rsvp")).toBeNull();
    expect(readerKeyAction(ev(" ", { metaKey: true }), "rsvp")).toBeNull();
    expect(readerKeyAction(ev("ArrowLeft", { altKey: true }), "rsvp")).toBeNull();
    expect(readerKeyAction(ev(" ", { defaultPrevented: true }), "rsvp")).toBeNull();
  });
  it("does not steal keys from inputs, dialogs, or Space on a focused button", () => {
    const input = document.createElement("input");
    const btn = document.createElement("button");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const inner = document.createElement("span");
    dialog.appendChild(inner);
    expect(readerKeyAction(ev(" ", { target: input }), "rsvp")).toBeNull();
    expect(readerKeyAction(ev("ArrowLeft", { target: inner }), "rsvp")).toBeNull();
    expect(readerKeyAction(ev(" ", { target: btn }), "rsvp")).toBeNull();
    expect(readerKeyAction(ev("ArrowRight", { target: btn }), "rsvp")).toBe("forward");
  });
});

describe("readerKeyAction listen", () => {
  it("l toggles listen mode, but not with a modifier or inside a field", () => {
    expect(readerKeyAction(ev("l"), "rsvp")).toBe("listen");
    expect(readerKeyAction(ev("l", { metaKey: true }), "rsvp")).toBeNull();
    const input = document.createElement("input");
    expect(readerKeyAction(ev("l", { target: input }), "page")).toBeNull();
  });
});
