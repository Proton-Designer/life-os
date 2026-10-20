import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/(app)/personal/reader-actions", () => ({ cancelReaderImport: vi.fn(), confirmReaderImport: vi.fn(), createReaderImport: vi.fn(), prepareReaderDoc: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

import { LibraryDropTarget } from "../library-drop-target";

const fileDrag = (file?: File) => ({ dataTransfer: { types: ["Files"], files: file ? [file] : [] } });
const textDrag = () => ({ dataTransfer: { types: ["text/plain"], files: [] } });

describe("LibraryDropTarget", () => {
  it("shows the hint while a file is dragged over the page and hides it when the drag leaves", () => {
    render(<LibraryDropTarget>page</LibraryDropTarget>);
    fireEvent.dragEnter(window, fileDrag());
    expect(screen.getByTestId("library-drop-hint")).toBeInTheDocument();
    fireEvent.dragLeave(window, fileDrag());
    expect(screen.queryByTestId("library-drop-hint")).toBeNull();
  });
  it("ignores non-file drags (selected text, links)", () => {
    render(<LibraryDropTarget>page</LibraryDropTarget>);
    fireEvent.dragEnter(window, textDrag());
    expect(screen.queryByTestId("library-drop-hint")).toBeNull();
    fireEvent.drop(window, textDrag());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("a dropped file opens the import dialog with it chosen, and the hint goes away", async () => {
    render(<LibraryDropTarget>page</LibraryDropTarget>);
    fireEvent.dragEnter(window, fileDrag());
    await act(async () => void fireEvent.drop(window, fileDrag(new File(["x"], "book.epub"))));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("import-file-label")).toHaveTextContent("book.epub");
    expect(screen.queryByTestId("library-drop-hint")).toBeNull();
  });
  it("a drop the dialog's own zone already handled does not open a second dialog", async () => {
    render(<LibraryDropTarget>page</LibraryDropTarget>);
    const handled = new Event("drop", { cancelable: true }) as Event & { dataTransfer?: unknown };
    handled.preventDefault();
    Object.assign(handled, fileDrag(new File(["x"], "again.epub")));
    await act(async () => void window.dispatchEvent(handled));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
