import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AI_PLATFORMS, AskAiLauncher, AskAiLinks } from "../ask-ai-launcher";

describe("AskAiLinks", () => {
  it("renders one plain https link per platform, opening in a new tab", () => {
    render(<AskAiLinks />);
    for (const platform of AI_PLATFORMS) {
      const link = screen.getByRole("link", { name: platform.label });
      expect(link).toHaveAttribute("href", platform.href);
      expect(link.getAttribute("href")).toMatch(/^https:\/\//);
      // No custom "is the app installed" detection JS — a plain link that
      // opens in a new tab/context, per the handoff doc's explicit ban on
      // hand-rolled protocol/app-detection logic.
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("names only the platform — no promised app hand-off in the copy", () => {
    render(<AskAiLinks />);
    for (const platform of AI_PLATFORMS) {
      expect(screen.getByRole("link", { name: platform.label }).textContent?.trim()).toBe(
        platform.label
      );
    }
  });
});

describe("AskAiLauncher", () => {
  it("hides the three links until the trigger is opened, in both variants", async () => {
    const user = userEvent.setup();
    render(
      <>
        <AskAiLauncher variant="icon-rail" />
        <AskAiLauncher variant="expanded" />
      </>
    );

    expect(screen.queryByRole("link", { name: "Claude" })).not.toBeInTheDocument();

    for (const trigger of screen.getAllByRole("button", { name: "Ask AI" })) {
      await user.click(trigger);
      expect(screen.getAllByRole("link", { name: "Claude" }).length).toBeGreaterThan(0);
      await user.click(trigger); // close it back up before opening the next
    }
  });

  it("labels the icon-rail trigger for screen readers only (icon-only chrome)", () => {
    render(<AskAiLauncher variant="icon-rail" />);
    const trigger = screen.getByRole("button", { name: "Ask AI" });
    expect(trigger.querySelector(".sr-only")).toHaveTextContent("Ask AI");
  });
});
