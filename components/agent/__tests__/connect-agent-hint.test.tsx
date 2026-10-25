import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConnectAgentHint } from "../connect-agent-hint";

describe("ConnectAgentHint", () => {
  it("says what is missing and offers both ways to get it, as links, not as an error", () => {
    render(<ConnectAgentHint what="weekly narrative" />);
    expect(screen.getByTestId("connect-agent-hint")).toHaveTextContent("No weekly narrative yet.");
    expect(screen.getByRole("link", { name: "Connect an agent" })).toHaveAttribute("href", "/settings#connectors");
    expect(screen.getByRole("link", { name: "add a key" })).toHaveAttribute("href", "/settings#ai");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
