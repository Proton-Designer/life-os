import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const retry = vi.fn();
const refresh = vi.fn();
vi.mock("@/app/(app)/personal/self-mastery-actions", () => ({ retryBookIngestion: (...a: unknown[]) => retry(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { RetryBookButton } from "../retry-book-button";
import { SCANNED_PDF_MESSAGE, ENCRYPTED_PDF_MESSAGE, UNREADABLE_PDF_MESSAGE, tooManyPagesMessage } from "@/lib/self-mastery/ingestion/failure-messages";

beforeEach(() => {
  retry.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset();
});

describe("RetryBookButton", () => {
  it("restarts the book and refreshes the page", async () => {
    const user = userEvent.setup();
    render(<RetryBookButton bookId="b-1" title="Atomic Habits" errorMessage="The AI provider kept timing out while processing this book. Please try again later." />);
    await user.click(screen.getByRole("button", { name: "Try again: Atomic Habits" }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith("b-1"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows the server's refusal in an alert and does not refresh", async () => {
    retry.mockResolvedValue({ ok: false, message: "The original file is no longer stored, so this book can't be run again. Upload it again." });
    const user = userEvent.setup();
    render(<RetryBookButton bookId="b-1" title="T" errorMessage={null} />);
    await user.click(screen.getByRole("button", { name: /Try again/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/no longer stored/);
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each([SCANNED_PDF_MESSAGE, ENCRYPTED_PDF_MESSAGE, UNREADABLE_PDF_MESSAGE, tooManyPagesMessage(2000, 1500)])(
    "is not offered for a failure about the file itself: %s",
    (message) => {
      render(<RetryBookButton bookId="b-1" title="T" errorMessage={message} />);
      expect(screen.queryByTestId("retry-book")).toBeNull();
    },
  );
});
