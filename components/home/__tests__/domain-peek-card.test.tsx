import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DomainPeekCard } from "../domain-peek-card";

describe("DomainPeekCard", () => {
  it("renders the domain label", () => {
    render(
      <DomainPeekCard domain="deen" href="/deen" pulse={0.5}>
        body
      </DomainPeekCard>
    );
    expect(screen.getByText("Deen")).toBeInTheDocument();
  });

  it("renders an IconChip with the domain's icon", () => {
    render(
      <DomainPeekCard domain="deen" href="/deen" pulse={0.5}>
        body
      </DomainPeekCard>
    );
    expect(screen.getByTestId("domain-peek-card-deen").querySelectorAll("svg").length).toBeGreaterThan(0);
  });

  it("passes children through", () => {
    render(
      <DomainPeekCard domain="business" href="/business" pulse={0.2}>
        <span>custom body</span>
      </DomainPeekCard>
    );
    expect(screen.getByText("custom body")).toBeInTheDocument();
  });
});
