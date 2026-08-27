import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AddClassDialog } from "../add-class-dialog";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

describe("AddClassDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function openDialog() {
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add class" }));
    return user;
  }

  it("requires a class name and a class code before saving", async () => {
    const createClass = vi.fn();
    const addClassEvent = vi.fn();
    const user = await (async () => {
      render(<AddClassDialog createClass={createClass} addClassEvent={addClassEvent} />);
      return openDialog();
    })();

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Enter a class name")).toBeInTheDocument();
    expect(createClass).not.toHaveBeenCalled();

    await user.type(screen.getByPlaceholderText("Class name"), "Prob & Stats");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Enter a class code")).toBeInTheDocument();
    expect(createClass).not.toHaveBeenCalled();
  });

  it("creates a class with no room/instructor/timings — the MATH 2418 (Lin Alg) null-path shape", async () => {
    const createClass = vi.fn().mockResolvedValue({ id: "c-new" });
    const addClassEvent = vi.fn();
    const user = await (async () => {
      render(<AddClassDialog createClass={createClass} addClassEvent={addClassEvent} />);
      return openDialog();
    })();

    await user.type(screen.getByPlaceholderText("Class name"), "Lin Alg");
    await user.type(screen.getByPlaceholderText("Class code"), "MATH 2418");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(createClass).toHaveBeenCalledWith({ shortName: "Lin Alg", code: "MATH 2418", room: undefined, instructor: undefined })
    );
    // No days picked — timings genuinely optional, no schedule_events call at all.
    expect(addClassEvent).not.toHaveBeenCalled();
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("creates a class with room, professor, and a T/Th schedule sharing the new class's id", async () => {
    const createClass = vi.fn().mockResolvedValue({ id: "c-new" });
    const addClassEvent = vi.fn().mockResolvedValue(undefined);
    const user = await (async () => {
      render(<AddClassDialog createClass={createClass} addClassEvent={addClassEvent} />);
      return openDialog();
    })();

    await user.type(screen.getByPlaceholderText("Class name"), "DSA");
    await user.type(screen.getByPlaceholderText("Class code"), "CS-3345-HON");
    await user.type(screen.getByPlaceholderText("Room (optional)"), "FO 2.404");
    await user.type(screen.getByPlaceholderText("Professor (optional)"), "Andrew Schmidt Nemec");
    await user.click(screen.getByRole("button", { name: "Tue" }));
    await user.click(screen.getByRole("button", { name: "Thu" }));
    await user.type(screen.getByLabelText("Start time"), "1300");
    await user.type(screen.getByLabelText("End time"), "1415");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(createClass).toHaveBeenCalled());
    await waitFor(() =>
      expect(addClassEvent).toHaveBeenCalledWith({
        title: "DSA",
        days: [2, 4],
        eventTime: "13:00",
        endTime: "14:15",
        location: "FO 2.404",
        instructor: "Andrew Schmidt Nemec",
        classId: "c-new",
      })
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("blocks Save with an error when the end time isn't after the start time, and never calls createClass", async () => {
    const createClass = vi.fn();
    const addClassEvent = vi.fn();
    const user = await (async () => {
      render(<AddClassDialog createClass={createClass} addClassEvent={addClassEvent} />);
      return openDialog();
    })();

    await user.type(screen.getByPlaceholderText("Class name"), "Phys Lab");
    await user.type(screen.getByPlaceholderText("Class code"), "PHYS-2126-105");
    await user.click(screen.getByRole("button", { name: "Tue" }));
    await user.type(screen.getByLabelText("Start time"), "1700");
    await user.type(screen.getByLabelText("End time"), "1600");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("End time must be after start time")).toBeInTheDocument();
    expect(createClass).not.toHaveBeenCalled();
    expect(addClassEvent).not.toHaveBeenCalled();
  });

  it("surfaces an error and keeps the dialog open when createClass rejects", async () => {
    const createClass = vi.fn().mockRejectedValue(new Error("network down"));
    const addClassEvent = vi.fn();
    const user = await (async () => {
      render(<AddClassDialog createClass={createClass} addClassEvent={addClassEvent} />);
      return openDialog();
    })();

    await user.type(screen.getByPlaceholderText("Class name"), "Prob & Stats");
    await user.type(screen.getByPlaceholderText("Class code"), "STAT 3355");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("Couldn't save — try again")).toBeInTheDocument());
    expect(screen.getByPlaceholderText("Class name")).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
