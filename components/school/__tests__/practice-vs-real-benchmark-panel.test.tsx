import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PracticeVsRealBenchmarkPanel } from "../practice-vs-real-benchmark-panel";
import type { PracticeVsRealBenchmark } from "@/lib/school/practice-vs-real-benchmark";

const TODAY = "2026-10-15";

function benchmark(rows: PracticeVsRealBenchmark["rows"]): PracticeVsRealBenchmark {
  return { rows, hasData: rows.length > 0 };
}

function row(overrides: Partial<PracticeVsRealBenchmark["rows"][number]> = {}): PracticeVsRealBenchmark["rows"][number] {
  return {
    assessmentId: "a1",
    assessmentName: "Midterm",
    className: "Calc II",
    date: "2026-10-01",
    realPct: 85,
    practicePct: 70,
    practiceIntervalLabel: "T-7",
    deltaPct: 15,
    ...overrides,
  };
}

describe("PracticeVsRealBenchmarkPanel (P3-12)", () => {
  it("shows an honest empty-state message when there's no data yet -- never a fabricated comparison", () => {
    render(<PracticeVsRealBenchmarkPanel benchmark={benchmark([])} todayStr={TODAY} />);
    expect(screen.getByText(/Complete a practice test before a graded exam/)).toBeInTheDocument();
  });

  // UX-03: app/(app)/school/page.tsx already wraps this in
  // <Panel title="Practice vs. real grade">, which renders the title
  // unconditionally (components/ui/panel.tsx) -- this component's own
  // empty-state heading printed it a second time, verbatim, directly
  // underneath.
  it("does not print its own title in the empty state -- the parent Panel already shows it", () => {
    render(<PracticeVsRealBenchmarkPanel benchmark={benchmark([])} todayStr={TODAY} />);
    expect(screen.queryByText("Practice vs. real grade")).not.toBeInTheDocument();
  });

  it("renders the assessment name, class, both percentages, and the interval the practice score came from", () => {
    render(<PracticeVsRealBenchmarkPanel benchmark={benchmark([row()])} todayStr={TODAY} />);
    expect(screen.getByText(/Midterm/)).toBeInTheDocument();
    expect(screen.getByText(/Calc II/)).toBeInTheDocument();
    expect(screen.getByText(/T-7 practice:/)).toBeInTheDocument();
    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(screen.getByText("85%")).toBeInTheDocument();
  });

  it("shows a positive delta with a '+' prefix", () => {
    render(<PracticeVsRealBenchmarkPanel benchmark={benchmark([row({ realPct: 85, practicePct: 70, deltaPct: 15 })])} todayStr={TODAY} />);
    expect(screen.getByText("+15 pts")).toBeInTheDocument();
  });

  it("shows a negative delta without a '+' prefix, honestly reporting an underperformance", () => {
    render(<PracticeVsRealBenchmarkPanel benchmark={benchmark([row({ realPct: 55, practicePct: 90, deltaPct: -35 })])} todayStr={TODAY} />);
    expect(screen.getByText("-35 pts")).toBeInTheDocument();
  });

  it("shows 'Matched' for a zero delta rather than '+0 pts'", () => {
    render(<PracticeVsRealBenchmarkPanel benchmark={benchmark([row({ realPct: 80, practicePct: 80, deltaPct: 0 })])} todayStr={TODAY} />);
    expect(screen.getByText("Matched")).toBeInTheDocument();
  });
});
