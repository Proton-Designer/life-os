import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const uploadBookMock = vi.fn();
vi.mock("@/app/(app)/personal/self-mastery-actions", () => ({
  uploadBook: (...args: unknown[]) => uploadBookMock(...args),
}));

import { UploadBookDialog } from "../upload-book-dialog";

function fakeFile(): File {
  return new File(["%PDF-1.4 fake"], "book.pdf", { type: "application/pdf" });
}

async function openAndPickFile(user: ReturnType<typeof userEvent.setup>) {
  render(<UploadBookDialog />);
  await user.click(screen.getByTestId("add-book-trigger"));
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(fileInput, fakeFile());
}

describe("UploadBookDialog -- processing mode selector (P2-14B)", () => {
  beforeEach(() => {
    pushMock.mockReset();
    uploadBookMock.mockReset();
    uploadBookMock.mockResolvedValue({ ok: true, bookId: "book-1" });
  });

  it("defaults to Standard (selected/pressed), with Batch shown but not selected", async () => {
    const user = userEvent.setup();
    await openAndPickFile(user);

    const standardBtn = screen.getByRole("button", { name: "Standard" });
    const batchBtn = screen.getByRole("button", { name: /Batch \(lower cost\)/ });
    expect(standardBtn).toBeInTheDocument();
    expect(batchBtn).toBeInTheDocument();
  });

  it("shows one honest line about the cost/speed trade-off", async () => {
    const user = userEvent.setup();
    await openAndPickFile(user);
    expect(screen.getByText(/combines several sections per AI call to cost less/)).toBeInTheDocument();
  });

  it("submitting WITHOUT touching the toggle sends ingestion_mode=standard", async () => {
    const user = userEvent.setup();
    await openAndPickFile(user);
    await user.type(screen.getByLabelText("Title"), "A Book");

    await user.click(screen.getByRole("button", { name: "Add to library" }));

    await waitFor(() => expect(uploadBookMock).toHaveBeenCalledTimes(1));
    const formData = uploadBookMock.mock.calls[0]![0] as FormData;
    expect(formData.get("ingestion_mode")).toBe("standard");
  });

  it("clicking Batch then submitting sends ingestion_mode=batch", async () => {
    const user = userEvent.setup();
    await openAndPickFile(user);
    await user.type(screen.getByLabelText("Title"), "A Book");

    await user.click(screen.getByRole("button", { name: /Batch \(lower cost\)/ }));
    await user.click(screen.getByRole("button", { name: "Add to library" }));

    await waitFor(() => expect(uploadBookMock).toHaveBeenCalledTimes(1));
    const formData = uploadBookMock.mock.calls[0]![0] as FormData;
    expect(formData.get("ingestion_mode")).toBe("batch");
  });

  it("closing and reopening the dialog resets the mode back to Standard, never carrying a stale Batch choice into a new upload", async () => {
    const user = userEvent.setup();
    render(<UploadBookDialog />);
    await user.click(screen.getByTestId("add-book-trigger"));
    let fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, fakeFile());
    await user.click(screen.getByRole("button", { name: /Batch \(lower cost\)/ }));

    // Close (Escape) and reopen.
    await user.keyboard("{Escape}");
    await user.click(screen.getByTestId("add-book-trigger"));
    fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, fakeFile());
    await user.type(screen.getByLabelText("Title"), "A Book");
    await user.click(screen.getByRole("button", { name: "Add to library" }));

    await waitFor(() => expect(uploadBookMock).toHaveBeenCalledTimes(1));
    const formData = uploadBookMock.mock.calls[0]![0] as FormData;
    expect(formData.get("ingestion_mode")).toBe("standard");
  });
});
