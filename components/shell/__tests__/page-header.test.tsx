import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHeader } from "../page-header";

describe("PageHeader", () => {
  it("renders the title as a top-level heading", () => {
    render(<PageHeader title="Deen" />);
    expect(screen.getByRole("heading", { name: "Deen", level: 1 })).toBeInTheDocument();
  });

  it("renders an optional description under the title", () => {
    render(<PageHeader title="Insights" description="Where your time actually goes" />);
    expect(screen.getByText("Where your time actually goes")).toBeInTheDocument();
  });

  it("renders an optional right-hand actions slot", () => {
    render(
      <PageHeader title="Business" actions={<button type="button">Set kill list</button>} />
    );
    expect(screen.getByRole("button", { name: "Set kill list" })).toBeInTheDocument();
  });

  it("omits the description block entirely when none is passed", () => {
    render(<PageHeader title="Fitness" />);
    expect(screen.queryByText(/./, { selector: "p" })).not.toBeInTheDocument();
  });
});
