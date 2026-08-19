import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LockInSession } from "../lock-in-session";

vi.mock("@/lib/checkins/compute-session-checkin-slots", () => ({
  computeSessionCheckinSlots: () => ({ dueSlot: null, missedSlots: [] }),
}));
vi.mock("@/app/(app)/checkin/actions", () => ({
  recordMissedCheckin: vi.fn(),
  getCheckinOptionsForNow: vi.fn(async () => []),
}));
vi.mock("@/app/(app)/business/actions", () => ({
  endWorkSession: vi.fn(),
}));

describe("LockInSession", () => {
  it("renders the elapsed time and session ratio in the mono numeral scale", () => {
    render(
      <LockInSession
        sessionId="s1"
        startedAtIso="2026-08-15T12:00:00.000Z"
        initialCheckins={[]}
        sessionSignalMinutes={0}
        sessionNoiseMinutes={0}
        onEnded={() => {}}
      />
    );
    expect(screen.getByTestId("lock-in-elapsed").className).toContain("font-mono");
    expect(screen.getByTestId("lock-in-session-ratio").className).toContain("font-mono");
  });

  it("gives the session card a featured gradient wash and a business icon chip", () => {
    render(
      <LockInSession
        sessionId="s1"
        startedAtIso="2026-08-15T12:00:00.000Z"
        initialCheckins={[]}
        sessionSignalMinutes={0}
        sessionNoiseMinutes={0}
        onEnded={() => {}}
      />
    );
    const card = screen.getByTestId("lock-in-session");
    expect(card.style.backgroundImage).toContain("--accent-business");
    expect(card.style.backgroundColor).toBe("var(--card)");
    expect(card.querySelector("svg")).toBeInTheDocument();
  });

  it("shows a positive badge for a signal (kill_list) checkin and a warning badge for a noise checkin", () => {
    render(
      <LockInSession
        sessionId="s1"
        startedAtIso="2026-08-15T12:00:00.000Z"
        initialCheckins={[
          { checkinTime: "2026-08-15T13:00:00.000Z", tagType: "kill_list", tagLabel: "On task", answered: true },
          { checkinTime: "2026-08-15T14:00:00.000Z", tagType: "noise", tagLabel: "Distracted", answered: true },
          { checkinTime: "2026-08-15T15:00:00.000Z", tagType: null, tagLabel: null, answered: false },
        ]}
        sessionSignalMinutes={30}
        sessionNoiseMinutes={15}
        onEnded={() => {}}
      />
    );
    expect(screen.getByText("On task")).toHaveClass("text-accent-business");
    expect(screen.getByText("Distracted")).toHaveClass("text-accent-warning");
    expect(screen.getByText("Missed")).toHaveClass("text-muted-foreground");
  });

  // 2026-08-19: the ratio must come from real allocation minutes, not a
  // tag_type count over the activity-log checkins — the log below stays a
  // legitimate label display, but the number at the top is a different
  // input entirely now.
  it("computes the session ratio from sessionSignalMinutes/sessionNoiseMinutes, not from the checkin activity log", () => {
    render(
      <LockInSession
        sessionId="s1"
        startedAtIso="2026-08-15T12:00:00.000Z"
        initialCheckins={[
          { checkinTime: "2026-08-15T13:00:00.000Z", tagType: "kill_list", tagLabel: "On task", answered: true },
          { checkinTime: "2026-08-15T14:00:00.000Z", tagType: "noise", tagLabel: "Distracted", answered: true },
        ]}
        sessionSignalMinutes={90}
        sessionNoiseMinutes={30}
        onEnded={() => {}}
      />
    );
    // 90:30 = 3.0:1, NOT 1:1 (which is what the two activity-log entries
    // above would give if the ratio still counted them).
    expect(screen.getByTestId("lock-in-session-ratio")).toHaveTextContent("3.0 : 1");
  });

  it("shows 'No data' when nothing has been allocated to this session yet", () => {
    render(
      <LockInSession
        sessionId="s1"
        startedAtIso="2026-08-15T12:00:00.000Z"
        initialCheckins={[]}
        sessionSignalMinutes={0}
        sessionNoiseMinutes={0}
        onEnded={() => {}}
      />
    );
    expect(screen.getByTestId("lock-in-session-ratio")).toHaveTextContent("No data");
  });
});
