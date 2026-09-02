import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PromoteLessonSheet } from "../promote-lesson-sheet";
import { VerdictDueList } from "../verdict-card";
import { hasAction } from "@/lib/promotions/types";
import type { ActivePromotion } from "@/lib/promotions/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/promotions/actions", () => ({ promoteLesson: vi.fn(), recordVerdict: vi.fn() }));

/**
 * These test the three ways this feature is allowed to show nothing, and one
 * way it is not. "Renders nothing" is a claim about the DOM, so it is asserted
 * against the container rather than against the absence of one test id — an
 * absent test id is also what a crashed render produces.
 */

const READY = { status: "ready" as const, areas: [{ id: "a1", key: "learning", label: "Learning" }] };

describe("PromoteLessonSheet", () => {
  it("renders NOTHING when the lesson has no action_template", () => {
    const { container } = render(
      <PromoteLessonSheet
        lessonId="l1"
        lessonTitle="A lesson"
        actionTemplate={null}
        areas={READY}
        existingPromotion={null}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers the trigger when there IS an action_template", () => {
    render(
      <PromoteLessonSheet
        lessonId="l1"
        lessonTitle="A lesson"
        actionTemplate="Do the thing tomorrow morning"
        areas={READY}
        existingPromotion={null}
      />,
    );
    expect(screen.getByTestId("promote-lesson-trigger")).toBeTruthy();
  });

  it("shows the running commitment instead of the form when one is already active", () => {
    render(
      <PromoteLessonSheet
        lessonId="l1"
        lessonTitle="A lesson"
        actionTemplate="Do the thing"
        areas={READY}
        existingPromotion={{ id: "p1", acceptedText: "My own wording", verdictDueAt: "2026-10-02T00:00:00Z" }}
      />,
    );
    expect(screen.getByTestId("promotion-active").textContent).toContain("My own wording");
    // The form must not be reachable: a second active promotion is impossible
    // in the database, so offering it would be offering a guaranteed error.
    expect(screen.queryByTestId("promote-lesson-trigger")).toBeNull();
  });
});

describe("hasAction — the shared predicate", () => {
  // The mounting surface conditions its wrapper on this and the sheet
  // conditions its render on it. If they ever disagree the user gets an empty
  // bordered box, so the agreement is asserted rather than assumed.
  it("agrees with the sheet: whitespace is not an action", () => {
    expect(hasAction("   ")).toBe(false);
    expect(hasAction("")).toBe(false);
    expect(hasAction(null)).toBe(false);
    expect(hasAction(undefined)).toBe(false);
    expect(hasAction("Do the thing")).toBe(true);
  });

  it("the sheet renders nothing for exactly the inputs hasAction rejects", () => {
    for (const template of ["   ", ""]) {
      const { container } = render(
        <PromoteLessonSheet
          lessonId="l1"
          lessonTitle="A lesson"
          actionTemplate={template}
          areas={READY}
          existingPromotion={null}
        />,
      );
      expect(hasAction(template)).toBe(false);
      expect(container).toBeEmptyDOMElement();
    }
  });
});

describe("VerdictDueList", () => {
  it("renders NOTHING when no promotion is due — not an empty state", () => {
    const { container } = render(<VerdictDueList promotions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one card per due promotion", () => {
    const promotions: ActivePromotion[] = [
      {
        id: "p1",
        lessonId: "l1",
        lessonTitle: "A lesson",
        acceptedText: "My own wording",
        areaId: "a1",
        areaLabel: "Learning",
        startedAt: "2026-08-02T00:00:00Z",
        verdictDueAt: "2026-09-01T00:00:00Z",
        priorVerdicts: [{ verdict: "still_testing", verdictAt: "2026-08-20T00:00:00Z", reason: null }],
      },
    ];
    render(<VerdictDueList promotions={promotions} />);
    expect(screen.getAllByTestId("verdict-card")).toHaveLength(1);
    // A deferral is shown, because "you already said not yet once" changes
    // how the question should land.
    expect(screen.getByTestId("verdict-deferred-count").textContent).toContain("once");
  });
});
