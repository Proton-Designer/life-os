import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PublicQuestionBankDrill } from "../public-question-bank-drill";

function q(prompt: string, answer: string, topic: string | null = null) {
  return { prompt, answer, topic };
}

describe("PublicQuestionBankDrill", () => {
  it("shows the prompt and a counter, with the answer hidden until revealed", () => {
    render(<PublicQuestionBankDrill questions={[q("What is 2+2?", "4")]} />);
    expect(screen.getByText("What is 2+2?")).toBeInTheDocument();
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    expect(screen.queryByText("4")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reveal answer" })).toBeInTheDocument();
  });

  it("reveals the answer on tap", async () => {
    const user = userEvent.setup();
    render(<PublicQuestionBankDrill questions={[q("What is 2+2?", "4")]} />);
    await user.click(screen.getByRole("button", { name: "Reveal answer" }));
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("Next advances to the next question and re-hides the answer", async () => {
    const user = userEvent.setup();
    render(<PublicQuestionBankDrill questions={[q("Q1", "A1"), q("Q2", "A2")]} />);
    await user.click(screen.getByRole("button", { name: "Reveal answer" }));
    expect(screen.getByText("A1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Q2")).toBeInTheDocument();
    expect(screen.queryByText("A2")).not.toBeInTheDocument();
  });

  it("Next wraps around from the last question back to the first", async () => {
    const user = userEvent.setup();
    render(<PublicQuestionBankDrill questions={[q("Q1", "A1"), q("Q2", "A2")]} />);
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Q2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Q1")).toBeInTheDocument();
  });

  it("shows the topic badge only when a question has one", () => {
    const { rerender } = render(<PublicQuestionBankDrill questions={[q("Q1", "A1", "Chapter 3")]} />);
    expect(screen.getByText("Chapter 3")).toBeInTheDocument();
    rerender(<PublicQuestionBankDrill questions={[q("Q2", "A2", null)]} />);
    expect(screen.queryByText("Chapter 3")).not.toBeInTheDocument();
  });

  it("an empty bank shows an honest message, never a crash", () => {
    render(<PublicQuestionBankDrill questions={[]} />);
    expect(screen.getByText("This bank has no active questions right now.")).toBeInTheDocument();
  });

  it("never renders anything resembling a database id -- only prompt/answer/topic ever reach the DOM", () => {
    render(<PublicQuestionBankDrill questions={[q("Q1", "A1", "T1")]} />);
    // The component's own prop type has no id field at all; this is a
    // belt-and-suspenders check that nothing UUID-shaped leaks into text.
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    expect(document.body.textContent).not.toMatch(uuidPattern);
  });
});
