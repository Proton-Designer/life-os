import { useState } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const del = vi.fn();
const refresh = vi.fn();
vi.mock("@/app/(app)/personal/reader-actions", () => ({ deleteBook: (...a: unknown[]) => del(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { DeleteBookButton, deleteConsequences } from "../delete-book-button";

beforeEach(() => {
  del.mockReset().mockResolvedValue({ ok: true, hardDeleted: true });
  refresh.mockReset();
});

const open = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: "Delete Dune" }));

describe("DeleteBookButton", () => {
  it("never deletes on the first click: it asks, naming the book and what goes with it", async () => {
    const user = userEvent.setup();
    render(<DeleteBookButton bookId="b-1" title="Dune" readerOnly />);
    await open(user);
    expect(del).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("Delete “Dune”?");
    const list = screen.getByTestId("delete-consequences");
    expect(list).toHaveTextContent("bookmark");
    expect(list).toHaveTextContent("highlights");
    expect(list).toHaveTextContent("reading history");
    expect(screen.getByRole("dialog")).toHaveTextContent("can't be undone");
  });
  it("Keep it closes without deleting; the confirm button deletes the right book and refreshes", async () => {
    const user = userEvent.setup();
    render(<DeleteBookButton bookId="b-1" title="Dune" readerOnly />);
    await open(user);
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(del).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await open(user);
    await user.click(screen.getByTestId("confirm-delete-book"));
    await waitFor(() => expect(del).toHaveBeenCalledWith("b-1"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
  it("shows the failure in a role=alert and stays open", async () => {
    del.mockResolvedValue({ ok: false, message: "That book wasn't found." });
    const user = userEvent.setup();
    render(<DeleteBookButton bookId="b-1" title="Dune" readerOnly />);
    await open(user);
    await user.click(screen.getByTestId("confirm-delete-book"));
    expect(await screen.findByRole("alert")).toHaveTextContent("wasn't found");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    del.mockRejectedValue(new Error("offline"));
    await user.click(screen.getByTestId("confirm-delete-book"));
    expect(await screen.findByRole("alert")).toHaveTextContent("didn't go through");
  });
  it("a book with lessons gets the conditional wording (hidden if reviewed), not the reader-only promise", async () => {
    const user = userEvent.setup();
    render(<DeleteBookButton bookId="b-2" title="Dune" readerOnly={false} />);
    await open(user);
    const list = screen.getByTestId("delete-consequences");
    expect(list).toHaveTextContent("reviewed");
    expect(list).toHaveTextContent("hidden");
    expect(screen.getByRole("dialog")).not.toHaveTextContent("can't be undone");
    expect(deleteConsequences(true)).not.toEqual(deleteConsequences(false));
  });
  // The real page: refresh() re-renders the list without the deleted card, unmounting its DeleteBookButton.
  function Library({ ids }: { ids: string[] }) {
    const [shown, setShown] = useState(ids);
    refresh.mockImplementation(() => setTimeout(() => act(() => setShown((l) => l.filter((x) => x !== "b-2"))), 20));
    return (
      <main>
        <h1>Library</h1>
        {shown.length === 0 ? <button type="button" data-testid="try-reader-empty">Try the reader</button> : null}
        {shown.map((id) => (
          <DeleteBookButton key={id} bookId={id} title={`Book ${id}`} readerOnly />
        ))}
      </main>
    );
  }
  it("keeps focus on the neighbouring card's delete button after the deleted card unmounts", async () => {
    const user = userEvent.setup();
    render(<Library ids={["b-1", "b-2", "b-3"]} />);
    await user.click(screen.getByRole("button", { name: "Delete Book b-2" }));
    await user.click(screen.getByTestId("confirm-delete-book"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Delete Book b-2" })).toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete Book b-3" })).toHaveFocus());
    expect(document.body).not.toHaveFocus();
  });
  it("falls back to the Try the reader link when the last book is deleted", async () => {
    const user = userEvent.setup();
    render(<Library ids={["b-2"]} />);
    await user.click(screen.getByRole("button", { name: "Delete Book b-2" }));
    await user.click(screen.getByTestId("confirm-delete-book"));
    await waitFor(() => expect(screen.getByTestId("try-reader-empty")).toHaveFocus());
  });
  it("a reviewed lesson book's wording names what is kept", async () => {
    const user = userEvent.setup();
    render(<DeleteBookButton bookId="b-2" title="Dune" readerOnly={false} />);
    await open(user);
    for (const kept of ["review history", "bookmark", "highlights", "reading history", "stored files"]) expect(screen.getByTestId("delete-consequences")).toHaveTextContent(kept);
  });
});
