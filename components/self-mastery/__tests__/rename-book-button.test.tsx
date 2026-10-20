import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rename = vi.fn();
const refresh = vi.fn();
vi.mock("@/app/(app)/personal/reader-actions", () => ({ renameBook: (...a: unknown[]) => rename(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { RenameBookButton } from "../rename-book-button";

const ui = () => <RenameBookButton bookId="b-1" title="Old name" author="Ann" />;

beforeEach(() => {
  rename.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset();
});

describe("RenameBookButton", () => {
  it("opens prefilled, saves the trimmed title and author, then refreshes the page", async () => {
    const user = userEvent.setup();
    render(ui());
    await user.click(screen.getByRole("button", { name: "Rename Old name" }));
    const title = screen.getByLabelText("Title");
    expect(title).toHaveValue("Old name");
    expect(screen.getByLabelText("Author (optional)")).toHaveValue("Ann");
    await user.clear(title);
    await user.type(title, "  New name ");
    await user.clear(screen.getByLabelText("Author (optional)"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(rename).toHaveBeenCalledWith("b-1", { title: "New name", author: null }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("caps both fields at 200 characters", async () => {
    const user = userEvent.setup();
    render(ui());
    await user.click(screen.getByRole("button", { name: "Rename Old name" }));
    expect(screen.getByLabelText("Title")).toHaveAttribute("maxlength", "200");
    expect(screen.getByLabelText("Author (optional)")).toHaveAttribute("maxlength", "200");
  });
  it("shows the server's message and stays open when the rename is refused (no refresh)", async () => {
    rename.mockResolvedValue({ ok: false, message: "That book wasn't found." });
    const user = userEvent.setup();
    render(ui());
    await user.click(screen.getByRole("button", { name: "Rename Old name" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("wasn't found");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
  it("won't save an empty title (positive control: the action is not called)", async () => {
    const user = userEvent.setup();
    render(ui());
    await user.click(screen.getByRole("button", { name: "Rename Old name" }));
    await user.clear(screen.getByLabelText("Title"));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.submit(screen.getByLabelText("Title").closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("needs a title");
    expect(rename).not.toHaveBeenCalled();
  });
  it("a network failure is reported, not thrown", async () => {
    rename.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    render(ui());
    await user.click(screen.getByRole("button", { name: "Rename Old name" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("didn't save");
  });
});
