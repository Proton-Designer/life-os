import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CloseReflectStage } from "../close-reflect-stage";

const NO_PLAN = { todaysThree: [], hoursTodayMinutes: 90, weekdayBaselines: null, weekdayIndex: 1 };

describe("CloseReflectStage — Delta/Efficiency close-out stats (#38)", () => {
  it("omits Delta/Efficiency entirely when Start Day was never tapped today", () => {
    render(<CloseReflectStage {...NO_PLAN} deltaMinutes={null} />);
    expect(screen.queryByText(/Awake/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Efficiency/)).not.toBeInTheDocument();
  });

  it("renders Delta and Efficiency together once a wake mark exists today", () => {
    // 90 focused minutes over a 180-minute delta = 50%.
    render(<CloseReflectStage {...NO_PLAN} deltaMinutes={180} />);
    expect(screen.getByText("3h")).toBeInTheDocument(); // Delta, formatDurationMagnitude(180)
    expect(screen.getByText("50%")).toBeInTheDocument(); // Efficiency
  });

  it("still renders Hours and the Day Won verdict alongside Delta/Efficiency", () => {
    render(
      <CloseReflectStage
        todaysThree={[]}
        hoursTodayMinutes={240}
        weekdayBaselines={[0, 4, 4, 4, 4, 4, 2]}
        weekdayIndex={1}
        deltaMinutes={300}
      />
    );
    expect(screen.getByText("4:00")).toBeInTheDocument(); // formatHoursMinutes(240)
    expect(screen.getByText(/Day won/)).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument(); // 240/300
  });
});
