import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Inbox } from "lucide-react";
import { EmptyState } from "../empty-state";

describe("EmptyState", () => {
  it("renders a muted icon and the message", () => {
    render(<EmptyState icon={Inbox} message="Nothing logged yet — start with Fajr" />);
    expect(screen.getByText("Nothing logged yet — start with Fajr")).toBeInTheDocument();
  });

  it('never renders the banned "No data" copy verbatim as the whole message', () => {
    render(<EmptyState icon={Inbox} message="Nothing logged yet — start with Fajr" />);
    expect(screen.queryByText(/^No data$/)).not.toBeInTheDocument();
  });

  it("renders a primary action as a link when href is given", () => {
    render(
      <EmptyState icon={Inbox} message="No tasks yet" action={{ label: "Add a task", href: "/school" }} />
    );
    expect(screen.getByRole("link", { name: "Add a task" })).toHaveAttribute("href", "/school");
  });

  it("renders a primary action as a button when onClick is given", async () => {
    const onClick = vi.fn();
    render(<EmptyState icon={Inbox} message="No tasks yet" action={{ label: "Add a task", onClick }} />);
    screen.getByRole("button", { name: "Add a task" }).click();
    expect(onClick).toHaveBeenCalled();
  });

  it("renders with no action at all when none is passed", () => {
    render(<EmptyState icon={Inbox} message="No tasks yet" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
