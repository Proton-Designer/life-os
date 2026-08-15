import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageContainer, PageGrid } from "../page-container";

describe("PageContainer", () => {
  it("renders children inside the shared max-width wrapper", () => {
    render(
      <PageContainer>
        <p>Page body</p>
      </PageContainer>
    );
    expect(screen.getByText("Page body")).toBeInTheDocument();
  });

  it("carries the centralized max-width so pages stop capping themselves narrower", () => {
    render(
      <PageContainer data-testid="container">
        <p>Page body</p>
      </PageContainer>
    );
    const el = screen.getByTestId("container");
    expect(el.className).toContain("max-w-[1600px]");
    expect(el.className).toContain("mx-auto");
    expect(el.className).not.toContain("max-w-2xl");
    expect(el.className).not.toContain("max-w-4xl");
  });

  it("merges an extra className without dropping the base width classes", () => {
    render(
      <PageContainer data-testid="container" className="gap-8">
        <p>Page body</p>
      </PageContainer>
    );
    const el = screen.getByTestId("container");
    expect(el.className).toContain("gap-8");
    expect(el.className).toContain("max-w-[1600px]");
  });
});

describe("PageGrid", () => {
  it("renders a 12-column grid", () => {
    render(
      <PageGrid data-testid="grid">
        <div>cell</div>
      </PageGrid>
    );
    const el = screen.getByTestId("grid");
    expect(el.className).toContain("grid-cols-12");
    expect(screen.getByText("cell")).toBeInTheDocument();
  });
});
