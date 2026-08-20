import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VolumeHero } from "../volume-hero";
import { MUSCLE_GROUPS, type MuscleGroup } from "@/lib/fitness/volume";

function emptyVolume(): Record<MuscleGroup, number> {
  const v = {} as Record<MuscleGroup, number>;
  for (const m of MUSCLE_GROUPS) v[m] = 0;
  return v;
}

describe("VolumeHero", () => {
  it("shows the adherence fraction when provided", () => {
    render(<VolumeHero volume={emptyVolume()} adherence={{ confirmed: 4, scheduled: 5 }} />);
    expect(screen.getByTestId("adherence-fraction")).toHaveTextContent("4/5");
    expect(screen.queryByText(/day streak/i)).not.toBeInTheDocument();
  });

  it("shows no fraction — not a manufactured 0/0 — when nothing is scheduled (week-one)", () => {
    render(<VolumeHero volume={emptyVolume()} adherence={null} />);
    expect(screen.queryByTestId("adherence-fraction")).not.toBeInTheDocument();
  });

  it("only lists muscle groups with tracked volume, hiding zeros", () => {
    const volume = emptyVolume();
    volume.chest = 15;
    render(<VolumeHero volume={volume} adherence={null} />);
    expect(screen.getByTestId("volume-row-chest")).toHaveTextContent("15 sets");
    expect(screen.getByTestId("volume-row-chest")).toHaveTextContent("in range");
    expect(screen.queryByTestId("volume-row-back_lats")).not.toBeInTheDocument();
  });

  it("labels under-range and over-range volume correctly against the 12-20 band", () => {
    const volume = emptyVolume();
    volume.chest = 8;
    volume.back_lats = 25;
    render(<VolumeHero volume={volume} adherence={null} />);
    expect(screen.getByTestId("volume-row-chest")).toHaveTextContent("under");
    expect(screen.getByTestId("volume-row-back_lats")).toHaveTextContent("over");
  });

  it("shows a plain message when no volume is tracked at all", () => {
    render(<VolumeHero volume={emptyVolume()} adherence={null} />);
    expect(screen.getByText("No confirmed sets yet this week.")).toBeInTheDocument();
  });
});
