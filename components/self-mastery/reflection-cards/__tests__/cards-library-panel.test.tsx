import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

const createReflectionCardMock = vi.fn();
const archiveReflectionCardMock = vi.fn();
vi.mock("@/app/(app)/personal/reflection-cards-actions", () => ({
  createReflectionCard: (...args: unknown[]) => createReflectionCardMock(...args),
  archiveReflectionCard: (...args: unknown[]) => archiveReflectionCardMock(...args),
}));

import { CardsLibraryPanel } from "../cards-library-panel";
import type { ReflectionCard } from "@/lib/reflection-cards/types";

const GOAL_CARD: ReflectionCard = {
  id: "c1",
  userId: "u1",
  kind: "goal",
  content: "Ship the thing.",
  active: true,
  lastShownAt: null,
  createdAt: "2026-09-18T00:00:00.000Z",
};

describe("CardsLibraryPanel", () => {
  beforeEach(() => {
    createReflectionCardMock.mockReset();
    archiveReflectionCardMock.mockReset();
  });

  it("shows an honest empty state with an action when there are no cards", () => {
    render(<CardsLibraryPanel initialCards={[]} />);
    expect(screen.getByText(/No cards yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add a card/ })).toBeInTheDocument();
  });

  it("lists existing cards by kind and content", () => {
    render(<CardsLibraryPanel initialCards={[GOAL_CARD]} />);
    expect(screen.getByText("Ship the thing.")).toBeInTheDocument();
    expect(screen.getByText("Goal")).toBeInTheDocument();
  });

  it("creating a card calls createReflectionCard and adds it to the list", async () => {
    createReflectionCardMock.mockResolvedValue({ ok: true, message: "Card created.", card: GOAL_CARD });
    const user = userEvent.setup();
    render(<CardsLibraryPanel initialCards={[]} />);

    await user.click(screen.getByRole("button", { name: /Add a card/ }));
    await user.type(screen.getByPlaceholderText(/What do you want to be reminded of/), "Ship the thing.");
    await user.click(screen.getByRole("button", { name: "Add card" }));

    expect(createReflectionCardMock).toHaveBeenCalledWith("goal", "Ship the thing.");
    expect(await screen.findByText("Ship the thing.")).toBeInTheDocument();
  });

  it("shows the server error and keeps the dialog open when create fails", async () => {
    createReflectionCardMock.mockResolvedValue({ ok: false, message: "A card needs some content." });
    const user = userEvent.setup();
    render(<CardsLibraryPanel initialCards={[]} />);

    await user.click(screen.getByRole("button", { name: /Add a card/ }));
    await user.type(screen.getByPlaceholderText(/What do you want to be reminded of/), "x");
    await user.click(screen.getByRole("button", { name: "Add card" }));

    expect(await screen.findByText("A card needs some content.")).toBeInTheDocument();
  });

  it("archiving a card calls archiveReflectionCard and rolls back on failure", async () => {
    archiveReflectionCardMock.mockResolvedValue({ ok: false, message: "Card not found." });
    const user = userEvent.setup();
    render(<CardsLibraryPanel initialCards={[GOAL_CARD]} />);

    await user.click(screen.getByRole("button", { name: "Archive card" }));
    expect(archiveReflectionCardMock).toHaveBeenCalledWith("c1");
    // Failed archive rolls back -- the card is still there afterward, not
    // silently dropped from the list.
    expect(await screen.findByText("Ship the thing.")).toBeInTheDocument();
  });

  it("archiving a card removes it from the list on success", async () => {
    archiveReflectionCardMock.mockResolvedValue({ ok: true, message: "Archived." });
    const user = userEvent.setup();
    render(<CardsLibraryPanel initialCards={[GOAL_CARD]} />);

    await user.click(screen.getByRole("button", { name: "Archive card" }));
    await screen.findByText(/No cards yet/);
    expect(screen.queryByText("Ship the thing.")).not.toBeInTheDocument();
  });
});
