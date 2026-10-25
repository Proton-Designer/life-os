import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentJobView } from "@/lib/agent-jobs/types";

const listMock = vi.fn(async (_classId: string): Promise<AgentJobView[]> => []);
const cancelMock = vi.fn(async (_id: string) => ({ ok: true }));
const dismissMock = vi.fn(async (_id: string) => ({ ok: true }));
vi.mock("@/app/(app)/agent-jobs-actions", () => ({
  listAgentJobs: (c: string) => listMock(c),
  cancelAgentJob: (id: string) => cancelMock(id),
  dismissAgentJob: (id: string) => dismissMock(id),
}));
const refreshMock = vi.fn();
const stableRouter = { refresh: refreshMock }; // next/navigation's router is a stable object; a fresh one per render would re-run the load effect
vi.mock("next/navigation", () => ({ useRouter: () => stableRouter }));

import { AgentJobsStatus } from "../agent-jobs-status";
import { WaitingForAgent } from "../waiting-for-agent";

const job = (over: Partial<AgentJobView> & { id: string }): AgentJobView => ({ kind: "school.announcement_extract", state: "waiting", createdAt: "2026-10-25T21:05:00Z", error: null, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue([]);
});

describe("WaitingForAgent", () => {
  it("waiting: says so, with a 12-hour queued time, and a Cancel", () => {
    render(<WaitingForAgent what="Your announcement" state="waiting" createdAt="2026-10-25T21:05:00Z" timezone="UTC" onCancel={() => {}} />);
    expect(screen.getByText("Waiting for your agent")).toBeInTheDocument();
    expect(screen.getByTestId("waiting-for-agent")).toHaveTextContent("9:05 PM");
    expect(screen.getByTestId("waiting-for-agent").textContent).not.toMatch(/21:05/);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });
  it("working and failed read differently; failed offers Dismiss and shows the reason", () => {
    const { rerender } = render(<WaitingForAgent what="Your syllabus" state="working" createdAt="2026-10-25T21:05:00Z" timezone="UTC" onCancel={() => {}} />);
    expect(screen.getByText("Your agent is working on this")).toBeInTheDocument();
    rerender(<WaitingForAgent what="Your syllabus" state="failed" createdAt="2026-10-25T21:05:00Z" timezone="UTC" error="The text is unreadable." onDismiss={() => {}} />);
    expect(screen.getByText("Your agent couldn't finish this")).toBeInTheDocument();
    expect(screen.getByTestId("waiting-for-agent")).toHaveTextContent("The text is unreadable.");
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });
});

describe("AgentJobsStatus", () => {
  it("renders nothing when there are no jobs", async () => {
    const { container } = render(<AgentJobsStatus classId="c1" kinds={["school.announcement_extract"]} timezone="UTC" />);
    await waitFor(() => expect(listMock).toHaveBeenCalledWith("c1"));
    expect(container).toBeEmptyDOMElement();
  });

  it("shows only the kinds it was given, and Cancel cancels that job and re-reads", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValueOnce([job({ id: "a" }), job({ id: "b", kind: "school.syllabus_extract" })]);
    render(<AgentJobsStatus classId="c1" kinds={["school.announcement_extract"]} timezone="UTC" />);
    await screen.findByText("Waiting for your agent");
    expect(screen.getAllByTestId("waiting-for-agent")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancelMock).toHaveBeenCalledWith("a");
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
  });

  it("when a waiting job leaves the live set (an agent finished it) the page is refreshed so the result shows", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listMock.mockResolvedValueOnce([job({ id: "a" })]);
    render(<AgentJobsStatus classId="c1" kinds={["school.announcement_extract"]} timezone="UTC" />);
    await screen.findByText("Waiting for your agent");
    listMock.mockResolvedValue([]); // done: no card needed, the staged batch is on the page
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    vi.useRealTimers();
  });

  it("ready drafts: Review hands the drafts to the caller and dismisses the job", async () => {
    const user = userEvent.setup();
    const drafts = [{ prompt: "Q?", answer: "A", topic: null, sourceSnippet: null }];
    listMock.mockResolvedValue([job({ id: "d", kind: "school.question_draft", state: "ready_drafts", drafts })]);
    const onReview = vi.fn();
    render(<AgentJobsStatus classId="c1" kinds={["school.question_draft"]} timezone="UTC" onReviewDrafts={onReview} />);
    await screen.findByTestId("agent-drafts-ready");
    expect(screen.getByTestId("agent-drafts-ready")).toHaveTextContent("Your agent drafted 1 question");
    await user.click(screen.getByRole("button", { name: "Review" }));
    expect(onReview).toHaveBeenCalledWith("d", drafts);
    expect(dismissMock).toHaveBeenCalledWith("d");
  });
});
