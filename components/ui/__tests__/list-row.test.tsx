import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ListRow } from "../list-row";
import { Badge } from "../badge";

describe("ListRow", () => {
  it("renders leading, label, trailing, and meta", () => {
    render(
      <ListRow
        leading={<span data-testid="leading">●</span>}
        label="Ship the thing"
        trailing={<Badge variant="positive">Done</Badge>}
        meta="Today"
      />
    );
    expect(screen.getByTestId("leading")).toBeInTheDocument();
    expect(screen.getByText("Ship the thing")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("meets the 52px minimum tap target", () => {
    render(<ListRow leading={null} label="Row" />);
    expect(screen.getByTestId("list-row").className).toContain("min-h-[52px]");
  });

  it("renders as a link when href is given", () => {
    render(<ListRow leading={null} label="Insights" href="/insights" />);
    expect(screen.getByRole("link", { name: /insights/i })).toHaveAttribute("href", "/insights");
  });

  it("renders as a button and calls onClick when given without href", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<ListRow leading={null} label="Kill item 1" onClick={onClick} />);
    await user.click(screen.getByRole("button", { name: /kill item 1/i }));
    expect(onClick).toHaveBeenCalled();
  });

  it("renders as plain non-interactive content when neither href nor onClick is given", () => {
    render(<ListRow leading={null} label="Static row" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Static row")).toBeInTheDocument();
  });
});
