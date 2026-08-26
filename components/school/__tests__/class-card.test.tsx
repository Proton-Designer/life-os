import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { ClassCard } from "../class-card";
import type { ClassCardData } from "@/lib/school/get-class-cards";

vi.mock("@/app/(app)/school/class-actions", () => ({
  updateClass: vi.fn(async () => {}),
  listClassAssessments: vi.fn(async () => []),
  listClassTasks: vi.fn(async () => []),
  addClassAssessment: vi.fn(async () => {}),
  deleteClassAssessment: vi.fn(async () => {}),
  uploadClassSyllabus: vi.fn(async () => {}),
  removeClassSyllabus: vi.fn(async () => {}),
  getClassSyllabusUrl: vi.fn(async () => null),
}));
vi.mock("@/app/(app)/school/actions", () => ({
  addTask: vi.fn(async () => {}),
  toggleTask: vi.fn(async () => {}),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function classData(overrides: Partial<ClassCardData> = {}): ClassCardData {
  return {
    id: "c1",
    shortName: "DSA",
    code: "CS-3345-HON",
    room: "FO 2.404",
    instructor: "Andrew Schmidt Nemec",
    hasSyllabus: false,
    tasksDueThisWeek: 3,
    upcomingAssessment: { name: "Quiz 2", date: "2026-09-10" },
    assessments: [],
    tasks: [],
    ...overrides,
  };
}

describe("ClassCard", () => {
  it("renders the abbreviated name, code, room, and instructor", () => {
    render(<ClassCard data={classData()} timezone="America/Chicago" />);
    expect(screen.getByText("DSA")).toBeInTheDocument();
    expect(screen.getByText(/CS-3345-HON/)).toBeInTheDocument();
    expect(screen.getByText(/FO 2\.404/)).toBeInTheDocument();
    expect(screen.getByText(/Andrew Schmidt Nemec/)).toBeInTheDocument();
  });

  it("shows the task count and upcoming assessment", () => {
    render(<ClassCard data={classData()} timezone="America/Chicago" />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("tasks due this week")).toBeInTheDocument();
    expect(screen.getByText("Quiz 2")).toBeInTheDocument();
    expect(screen.getByText("2026-09-10")).toBeInTheDocument();
  });

  // The real null-path case (Opus Lead review): Lin Alg (MATH 2418) has no
  // short_name yet, null room/instructor, zero tasks, no upcoming
  // assessment, and no syllabus. Must render as valid, readable content —
  // never "undefined", never a blank gap, never a crash.
  it("renders the Lin Alg / MATH 2418 null-path shape correctly — no short_name, no room/instructor, zero tasks, no assessment", () => {
    render(
      <ClassCard
        data={classData({
          shortName: null,
          code: "MATH 2418",
          room: null,
          instructor: null,
          tasksDueThisWeek: 0,
          upcomingAssessment: null,
        })}
        timezone="America/Chicago"
      />
    );
    // Falls back to the course code as the display name.
    expect(screen.getByRole("heading", { name: "MATH 2418" })).toBeInTheDocument();
    expect(screen.queryByText("undefined")).not.toBeInTheDocument();
    expect(screen.queryByText("null")).not.toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("tasks due this week")).toBeInTheDocument(); // plural at zero, matches "0 tasks", not "0 task"
    expect(screen.getByText("No upcoming test")).toBeInTheDocument();
  });

  it("opens the expanded class view when View is clicked", async () => {
    const user = userEvent.setup();
    render(<ClassCard data={classData()} timezone="America/Chicago" />);
    await user.click(screen.getByRole("button", { name: "View DSA" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  // Opus Lead review: six class cards all labeled bare "View" is a real
  // screen-reader defect (indistinguishable buttons), not just a locator
  // inconvenience — the accessible name must be per-class.
  it("gives each card's View button a per-class accessible name, not a bare 'View'", () => {
    render(<ClassCard data={classData({ shortName: "DSA" })} timezone="America/Chicago" />);
    expect(screen.getByRole("button", { name: "View DSA" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View" })).not.toBeInTheDocument();
  });

  it("falls back to code for the View button's accessible name when short_name is null — a class added later can't quietly recreate the collision", () => {
    render(<ClassCard data={classData({ shortName: null, code: "MATH 2418" })} timezone="America/Chicago" />);
    expect(screen.getByRole("button", { name: "View MATH 2418" })).toBeInTheDocument();
  });
});
