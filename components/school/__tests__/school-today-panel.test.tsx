import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SchoolTodayPanel } from "../school-today-panel";
import type { SchoolTodayItem } from "@/lib/school/school-today";

describe("SchoolTodayPanel", () => {
  it("shows an honest empty state with nothing due today", () => {
    render(<SchoolTodayPanel items={[]} />);
    expect(screen.getByText(/nothing due today/i)).toBeInTheDocument();
  });

  it("renders each item's pre-formatted title verbatim, plus its risk band", () => {
    const items: SchoolTodayItem[] = [
      { id: "a1", title: "MATH 2418 · Quiz 2 · due Tue", dueDate: "2026-09-15", risk: { score: 60, band: "high" } },
    ];
    render(<SchoolTodayPanel items={items} />);
    expect(screen.getByTestId("school-today-row-a1")).toHaveTextContent("MATH 2418 · Quiz 2 · due Tue");
    expect(screen.getByTestId("school-today-row-a1")).toHaveTextContent("high");
  });
});
