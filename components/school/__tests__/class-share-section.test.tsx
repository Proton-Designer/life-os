import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ClassShareSection } from "../class-share-section";

const createClassShareMock = vi.fn();
const revokeClassShareMock = vi.fn();
const getClassShareStatusMock = vi.fn();
const getSharePreviewMock = vi.fn();
vi.mock("@/app/(app)/school/class-share-actions", () => ({
  createClassShare: (...args: unknown[]) => createClassShareMock(...args),
  revokeClassShare: (...args: unknown[]) => revokeClassShareMock(...args),
  getClassShareStatus: (...args: unknown[]) => getClassShareStatusMock(...args),
  getSharePreview: (...args: unknown[]) => getSharePreviewMock(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn() }, configurable: true });
});

describe("ClassShareSection", () => {
  it("not shared by default: offers a preview, never a link", async () => {
    getClassShareStatusMock.mockResolvedValue({ active: false, createdAt: null });
    render(<ClassShareSection classId="class-1" />);

    expect(await screen.findByText(/Not shared/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
  });

  it("Preview shows exactly what would become public, including the class name, before any share exists", async () => {
    getClassShareStatusMock.mockResolvedValue({ active: false, createdAt: null });
    getSharePreviewMock.mockResolvedValue({ className: "Orgo II", questions: [{ prompt: "Q1", answer: "A1", topic: null }] });
    const user = userEvent.setup();
    render(<ClassShareSection classId="class-1" />);

    await user.click(await screen.findByRole("button", { name: /Preview/ }));

    expect(await screen.findByText(/Orgo II/)).toBeInTheDocument();
    expect(screen.getByText("Q1")).toBeInTheDocument();
    expect(getSharePreviewMock).toHaveBeenCalledWith("class-1");
  });

  it("Create link shows the full URL exactly once, then Sharing is on", async () => {
    getClassShareStatusMock.mockResolvedValue({ active: false, createdAt: null });
    getSharePreviewMock.mockResolvedValue({ className: "Orgo II", questions: [] });
    createClassShareMock.mockResolvedValue({ rawToken: "raw-token-abc" });
    const user = userEvent.setup();
    render(<ClassShareSection classId="class-1" />);

    await user.click(await screen.findByRole("button", { name: /Preview/ }));
    await user.click(await screen.findByRole("button", { name: "Create link" }));

    expect(await screen.findByText(/raw-token-abc/)).toBeInTheDocument();
    expect(screen.getByText(/Sharing is on/)).toBeInTheDocument();
    expect(createClassShareMock).toHaveBeenCalledWith("class-1");
  });

  it("a create error is shown, never silently swallowed", async () => {
    getClassShareStatusMock.mockResolvedValue({ active: false, createdAt: null });
    getSharePreviewMock.mockResolvedValue({ className: "Orgo II", questions: [] });
    createClassShareMock.mockResolvedValue({ error: "This class is already shared." });
    const user = userEvent.setup();
    render(<ClassShareSection classId="class-1" />);

    await user.click(await screen.findByRole("button", { name: /Preview/ }));
    await user.click(await screen.findByRole("button", { name: "Create link" }));

    expect(await screen.findByText("This class is already shared.")).toBeInTheDocument();
  });

  it("when already active, shows Sharing is on with no link (never recoverable) and a Revoke button", async () => {
    getClassShareStatusMock.mockResolvedValue({ active: true, createdAt: "2026-09-15T00:00:00Z" });
    render(<ClassShareSection classId="class-1" />);

    expect(await screen.findByText(/Sharing is on/)).toBeInTheDocument();
    expect(screen.getByText(/only shown once, at creation/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeInTheDocument();
  });

  it("Revoke calls the action and returns to the not-shared state", async () => {
    getClassShareStatusMock.mockResolvedValue({ active: true, createdAt: "2026-09-15T00:00:00Z" });
    revokeClassShareMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ClassShareSection classId="class-1" />);

    await user.click(await screen.findByRole("button", { name: "Revoke" }));

    expect(revokeClassShareMock).toHaveBeenCalledWith("class-1");
    await waitFor(() => expect(screen.getByText(/Not shared/)).toBeInTheDocument());
  });
});
