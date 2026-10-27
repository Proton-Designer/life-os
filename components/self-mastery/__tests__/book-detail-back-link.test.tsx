import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// The book page while it is still processing (the page Home's "book loading"
// card opens) had no way back to the library except pressing the
// Self-Mastery tab again (2026-10-26).
vi.mock("@/lib/self-mastery/get-book-detail", () => ({
  getBookDetail: async () => ({
    id: "b1", title: "Actionable Gamification", author: null, sourceUrl: null, status: "processing",
    stage: "extracting_lessons", progressPct: 30, createdAt: new Date().toISOString(), looksStalled: false,
    agentWork: null, canRead: false, readProgress: null, lessons: [], memoryStrength: 0, errorMessage: null, ingestionMode: "lessons",
  }),
}));
vi.mock("@/lib/promotions/read", () => ({ getPromotableAreas: async () => [], getActivePromotionForLesson: async () => null }));
vi.mock("../auto-refresh-while-processing", () => ({ AutoRefreshWhileProcessing: () => null }));

const { BookDetailView } = await import("../book-detail-view");

describe("BookDetailView back link", () => {
  it("links back to the library it was opened from", async () => {
    render(await BookDetailView({ bookId: "b1", libraryHref: "/personal/self_mastery" }));
    expect(screen.getByRole("link", { name: /library/i }).getAttribute("href")).toBe("/personal/self_mastery");
  });
});
