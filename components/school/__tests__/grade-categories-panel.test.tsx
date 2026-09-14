import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { GradeCategoriesPanel, type GradeCategory } from "../grade-categories-panel";

const createGradeCategoryMock = vi.fn(async (..._args: unknown[]) => ({ id: "new-cat" }));
const updateGradeCategoryMock = vi.fn(async (..._args: unknown[]) => {});
const deleteGradeCategoryMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/app/(app)/school/class-actions", () => ({
  createGradeCategory: (...args: unknown[]) => createGradeCategoryMock(...args),
  updateGradeCategory: (...args: unknown[]) => updateGradeCategoryMock(...args),
  deleteGradeCategory: (...args: unknown[]) => deleteGradeCategoryMock(...args),
}));

function category(overrides: Partial<GradeCategory> = {}): GradeCategory {
  return { id: "c1", name: "Homework", weightPct: 20, dropLowestN: 0, expectedItemCount: 5, ...overrides };
}

describe("GradeCategoriesPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the honest empty state when there are zero categories, and Add is still reachable", () => {
    render(<GradeCategoriesPanel classId="class1" categories={[]} />);
    expect(screen.getByText(/no categories yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add category" })).toBeInTheDocument();
  });

  it("renders an existing category with its weight and drop-lowest summary", () => {
    render(<GradeCategoriesPanel classId="class1" categories={[category({ dropLowestN: 1 })]} />);
    expect(screen.getByTestId("grade-category-row-c1")).toHaveTextContent("Homework");
    expect(screen.getByTestId("grade-category-row-c1")).toHaveTextContent("20%");
    expect(screen.getByTestId("grade-category-row-c1")).toHaveTextContent("drops lowest 1");
  });

  it("adding a category calls createGradeCategory with the class id and parsed numeric fields", async () => {
    const user = userEvent.setup();
    render(<GradeCategoriesPanel classId="class1" categories={[]} />);

    await user.click(screen.getByRole("button", { name: "Add category" }));
    await user.type(screen.getByPlaceholderText("Name (e.g. Homework)"), "Quizzes");
    await user.type(screen.getByPlaceholderText("Wt %"), "30");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(createGradeCategoryMock).toHaveBeenCalledWith("class1", {
      name: "Quizzes",
      weightPct: 30,
      dropLowestN: 0,
      expectedItemCount: 1,
    });
  });

  it("rejects an add with no name typed, without calling the server", async () => {
    const user = userEvent.setup();
    render(<GradeCategoriesPanel classId="class1" categories={[]} />);

    await user.click(screen.getByRole("button", { name: "Add category" }));
    await user.type(screen.getByPlaceholderText("Wt %"), "30");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(createGradeCategoryMock).not.toHaveBeenCalled();
    expect(screen.getByText(/name and a weight between 0 and 100/i)).toBeInTheDocument();
  });

  it("clicking an existing category opens an inline edit form, and Save calls updateGradeCategory", async () => {
    const user = userEvent.setup();
    render(<GradeCategoriesPanel classId="class1" categories={[category()]} />);

    await user.click(screen.getByText("Homework", { exact: false }));
    const nameField = screen.getByRole("textbox", { name: "Category name" });
    await user.clear(nameField);
    await user.type(nameField, "Homework & Labs");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(updateGradeCategoryMock).toHaveBeenCalledWith("c1", {
      name: "Homework & Labs",
      weightPct: 20,
      dropLowestN: 0,
      expectedItemCount: 5,
    });
  });

  it("Remove calls deleteGradeCategory with the category id", async () => {
    const user = userEvent.setup();
    render(<GradeCategoriesPanel classId="class1" categories={[category()]} />);

    await user.click(screen.getByRole("button", { name: "Remove Homework category" }));

    expect(deleteGradeCategoryMock).toHaveBeenCalledWith("c1");
  });
});
