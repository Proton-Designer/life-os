import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { McpWidgetRemoveButton } from "../mcp-widget-remove-button";

describe("McpWidgetRemoveButton", () => {
  it("calls onRemove when clicked", async () => {
    const onRemove = vi.fn(async () => {});
    render(<McpWidgetRemoveButton onRemove={onRemove} />);

    await userEvent.click(screen.getByRole("button", { name: /remove widget/i }));

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("disables itself while the removal is pending", async () => {
    let resolveRemove!: () => void;
    const onRemove = vi.fn(() => new Promise<void>((resolve) => { resolveRemove = resolve; }));
    render(<McpWidgetRemoveButton onRemove={onRemove} />);

    const button = screen.getByRole("button", { name: /remove widget/i });
    await userEvent.click(button);

    expect(button).toBeDisabled();
    resolveRemove();
  });
});
