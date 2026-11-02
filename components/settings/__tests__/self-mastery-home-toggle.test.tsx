import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { setMock } = vi.hoisted(() => ({ setMock: vi.fn() }));
vi.mock("@/app/(app)/settings/self-mastery-actions", () => ({ setSelfMasteryOnHome: setMock }));

import { SelfMasteryHomeToggle } from "../self-mastery-home-toggle";

beforeEach(() => {
  setMock.mockReset();
  setMock.mockResolvedValue({ ok: true });
});

describe("SelfMasteryHomeToggle", () => {
  it("reflects the stored preference", () => {
    const { unmount } = render(<SelfMasteryHomeToggle initial={true} />);
    expect((screen.getByRole("checkbox", { name: /Show Self-Mastery on Home/ }) as HTMLInputElement).checked).toBe(true);
    unmount();
    render(<SelfMasteryHomeToggle initial={false} />);
    expect((screen.getByRole("checkbox", { name: /Show Self-Mastery on Home/ }) as HTMLInputElement).checked).toBe(false);
  });

  it("turning it off saves false at once, and says how to get it back", async () => {
    render(<SelfMasteryHomeToggle initial={true} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Show Self-Mastery on Home/ }));
    await waitFor(() => expect(setMock).toHaveBeenCalledWith(false));
    expect(await screen.findByText(/hidden on Home/i)).toBeInTheDocument();
  });

  it("a refused save flips the box back and shows the error", async () => {
    setMock.mockResolvedValue({ ok: false, message: "No settings row." });
    render(<SelfMasteryHomeToggle initial={true} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Show Self-Mastery on Home/ }));
    expect(await screen.findByText("No settings row.")).toBeInTheDocument();
    expect((screen.getByRole("checkbox", { name: /Show Self-Mastery on Home/ }) as HTMLInputElement).checked).toBe(true);
  });
});
