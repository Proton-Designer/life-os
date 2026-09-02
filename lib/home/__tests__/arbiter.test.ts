import { describe, expect, it } from "vitest";
import { rankCandidates, pickPrimaryAndAlternates, type Candidate } from "../arbiter";

function candidate(overrides: Partial<Candidate> & Pick<Candidate, "id" | "area">): Candidate {
  return {
    title: overrides.id,
    dueAt: null,
    weightTier: null,
    position: null,
    decay: null,
    cost: null,
    riskScore: null,
    riskConfidence: null,
    ...overrides,
  };
}

describe("rankCandidates — the corrected order (R18/R19): urgency -> dueAt -> weight tier -> position -> decay -> cost", () => {
  // The Boss's own spec, verbatim: "overdue cards outrank a Business item
  // with no due time, and a School deadline in 20 minutes outranks both."
  // Three candidates, one assertion, exercising the whole corrected order
  // at once -- urgency separates School (right_now, real dueAt) from
  // Business (absent, no dueAt at all -- must never default into a tie
  // with anything, per R18(4)); dueAt separates School from the overdue
  // Self-Mastery session, both of which land in "right_now" (urgencyBucket
  // collapses any negative time-to-due into right_now the same as a
  // due-soon-future instant -- overdue has never been representable in
  // this system before Self-Mastery's session, so this is the first real
  // exercise of that boundary).
  //
  // Built as hand-constructed Candidate objects, not wired through real
  // getDueSummary/getPriorityItems data -- deliberately, so a failure here
  // can only mean the ranking logic is wrong, never "the Self-Mastery
  // candidate wasn't constructed" (a different red that would mislead).
  it("School (due in 20min) > Self-Mastery (overdue) > Business (no due time)", () => {
    const now = new Date("2026-09-02T12:00:00Z");
    const school = candidate({
      id: "school-essay",
      area: "school",
      dueAt: new Date(now.getTime() + 20 * 60 * 1000),
    });
    const selfMastery = candidate({
      id: "self-mastery-session",
      area: "self_mastery",
      dueAt: new Date(now.getTime() - 24 * 60 * 60 * 1000), // overdue by a day
    });
    const business = candidate({
      id: "kill-list-item",
      area: "business",
      dueAt: null, // timeless by construction -- absent, not defaulted
    });

    const ranked = rankCandidates([selfMastery, business, school], now);

    expect(ranked.map((c) => c.id)).toEqual(["school-essay", "self-mastery-session", "kill-list-item"]);
  });

  it("absent urgency (no dueAt) never ties with later_today -- it ranks strictly below every real dueAt, even a same-day one hours away", () => {
    const now = new Date("2026-09-02T12:00:00Z");
    const laterToday = candidate({ id: "later", area: "school", dueAt: new Date(now.getTime() + 6 * 60 * 60 * 1000) });
    const timeless = candidate({ id: "timeless", area: "business", dueAt: null });

    const ranked = rankCandidates([timeless, laterToday], now);

    expect(ranked.map((c) => c.id)).toEqual(["later", "timeless"]);
  });

  it("within the same urgency tier, a future due date always outranks an overdue one, regardless of magnitude", () => {
    const now = new Date("2026-09-02T12:00:00Z");
    // Both right_now: due in 90 minutes vs overdue by 10 minutes.
    const soonFuture = candidate({ id: "soon", area: "school", dueAt: new Date(now.getTime() + 90 * 60 * 1000) });
    const slightlyOverdue = candidate({ id: "overdue", area: "self_mastery", dueAt: new Date(now.getTime() - 10 * 60 * 1000) });

    const ranked = rankCandidates([slightlyOverdue, soonFuture], now);

    expect(ranked.map((c) => c.id)).toEqual(["soon", "overdue"]);
  });

  it("two future due dates within the same tier sort soonest-first", () => {
    const now = new Date("2026-09-02T12:00:00Z");
    const sooner = candidate({ id: "sooner", area: "school", dueAt: new Date(now.getTime() + 10 * 60 * 1000) });
    const later = candidate({ id: "later", area: "co_op", dueAt: new Date(now.getTime() + 90 * 60 * 1000) });

    const ranked = rankCandidates([later, sooner], now);

    expect(ranked.map((c) => c.id)).toEqual(["sooner", "later"]);
  });

  it("weight tier breaks a tie only once urgency and dueAt are both tied (both absent here)", () => {
    const now = new Date("2026-09-02T12:00:00Z");
    const essential = candidate({ id: "essential-item", area: "deen", weightTier: "essential" });
    const background = candidate({ id: "background-item", area: "business", weightTier: "background" });

    const ranked = rankCandidates([background, essential], now);

    expect(ranked.map((c) => c.id)).toEqual(["essential-item", "background-item"]);
  });

  it("a null weightTier is treated as the 'important' floor -- same safe default the DB backfill itself uses", () => {
    const now = new Date("2026-09-02T12:00:00Z");
    const unresolved = candidate({ id: "unresolved", area: "deen", weightTier: null });
    const background = candidate({ id: "background-item", area: "business", weightTier: "background" });
    const essential = candidate({ id: "essential-item", area: "school", weightTier: "essential" });

    const ranked = rankCandidates([background, unresolved, essential], now);

    expect(ranked.map((c) => c.id)).toEqual(["essential-item", "unresolved", "background-item"]);
  });

  it("position breaks a tie within the same weight tier", () => {
    const now = new Date("2026-09-02T12:00:00Z");
    const second = candidate({ id: "second", area: "deen", weightTier: "important", position: 2 });
    const first = candidate({ id: "first", area: "business", weightTier: "important", position: 1 });

    const ranked = rankCandidates([second, first], now);

    expect(ranked.map((c) => c.id)).toEqual(["first", "second"]);
  });

  it("a real decay value beats a candidate with no decay source at all, never invented for the one missing it (R18(2))", () => {
    const now = new Date("2026-09-02T12:00:00Z");
    // Both fully tied through weight/position; only decay differs, and only
    // one candidate has a decay source at all. A real signal outranking no
    // signal (rather than the two being an unresolvable tie) is what keeps
    // this comparator a valid total order once a THIRD candidate is mixed
    // in -- see the cost test below for the concrete contradiction "tied
    // with a missing value" produces.
    const noDecaySource = candidate({ id: "kill-list", area: "business", weightTier: "important", position: 1 });
    const withDecay = candidate({ id: "cards-due", area: "self_mastery", weightTier: "important", position: 1, decay: 0.4 });

    const ranked = rankCandidates([noDecaySource, withDecay], now);

    expect(ranked.map((c) => c.id)).toEqual(["cards-due", "kill-list"]);
  });

  it("lower decay (less retained) ranks above higher decay when both are real", () => {
    const now = new Date("2026-09-02T12:00:00Z");
    const wellRetained = candidate({ id: "well-retained", area: "self_mastery", decay: 0.9 });
    const fading = candidate({ id: "fading", area: "self_mastery", decay: 0.2 });

    const ranked = rankCandidates([wellRetained, fading], now);

    expect(ranked.map((c) => c.id)).toEqual(["fading", "well-retained"]);
  });

  it("cost is the final tie-break, cheaper wins, and never invents a value for a candidate with no source (R18(5))", () => {
    const now = new Date("2026-09-02T12:00:00Z");
    const noCostSource = candidate({ id: "school-task", area: "school" });
    const cheapFitness = candidate({ id: "quick-workout", area: "fitness", cost: 10 });
    const expensiveFitness = candidate({ id: "long-workout", area: "fitness", cost: 45 });

    const ranked = rankCandidates([expensiveFitness, noCostSource, cheapFitness], now);

    // Both real costs sort cheaper-first between themselves, and a real
    // cost beats a missing one -- a comparator that instead treated a
    // missing cost as "tied with everything" would be non-transitive the
    // moment three candidates mix reals and nulls like this (verified by
    // writing this exact test first: two null-vs-real pairs each read as
    // tied while the two real values are not, a genuine contradiction).
    expect(ranked.map((c) => c.id)).toEqual(["quick-workout", "long-workout", "school-task"]);
  });

  // Boss ruling, R37 addendum: riskScore is the tail of the order, never a
  // gate on admission -- a candidate is already in this list because its
  // caller decided it has real evidence (R37: School is admitted on dueAt
  // alone). This section only covers ordering AMONG already-admitted
  // candidates.
  describe("riskScore (R37 addendum: participates only at riskConfidence >= low, tied on everything else)", () => {
    it("higher riskScore ranks first when both candidates have real, sufficiently-confident scores", () => {
      const now = new Date("2026-09-02T12:00:00Z");
      const higherRisk = candidate({ id: "high-risk", area: "school", riskScore: 0.8, riskConfidence: "moderate" });
      const lowerRisk = candidate({ id: "low-risk", area: "school", riskScore: 0.2, riskConfidence: "high" });

      const ranked = rankCandidates([lowerRisk, higherRisk], now);

      expect(ranked.map((c) => c.id)).toEqual(["high-risk", "low-risk"]);
    });

    it("riskConfidence 'insufficient' makes riskScore absent for ordering purposes, even though a real number exists", () => {
      const now = new Date("2026-09-02T12:00:00Z");
      // A high risk NUMBER but insufficient confidence in it -- must not
      // outrank a real, if lower, confidently-known score. Confidence <
      // low means "we don't trust this number," not "ignore the fact that
      // it's the only information here" -- see the next test for that.
      const unreliableHighNumber = candidate({ id: "unreliable", area: "school", riskScore: 0.99, riskConfidence: "insufficient" });
      const reliableLowNumber = candidate({ id: "reliable", area: "school", riskScore: 0.1, riskConfidence: "low" });

      const ranked = rankCandidates([unreliableHighNumber, reliableLowNumber], now);

      expect(ranked.map((c) => c.id)).toEqual(["reliable", "unreliable"]);
    });

    it("a real, sufficiently-confident risk score beats a candidate with no risk source at all", () => {
      const now = new Date("2026-09-02T12:00:00Z");
      const noRiskSource = candidate({ id: "no-risk-source", area: "business" });
      const hasRisk = candidate({ id: "has-risk", area: "school", riskScore: 0.5, riskConfidence: "low" });

      const ranked = rankCandidates([noRiskSource, hasRisk], now);

      expect(ranked.map((c) => c.id)).toEqual(["has-risk", "no-risk-source"]);
    });

    it("two candidates both lacking a usable risk score (null, or real number but insufficient confidence) stay tied at this tier -- never fabricated", () => {
      const now = new Date("2026-09-02T12:00:00Z");
      const noSource = candidate({ id: "no-source", area: "business" });
      const insufficientConfidence = candidate({ id: "insufficient-confidence", area: "school", riskScore: 0.9, riskConfidence: "insufficient" });

      const ranked = rankCandidates([insufficientConfidence, noSource], now);

      // Falls through to input order (stable sort) since neither is a
      // usable risk value -- not decided by the 0.9 number that exists
      // but isn't trusted.
      expect(ranked.map((c) => c.id)).toEqual(["insufficient-confidence", "no-source"]);
    });
  });
});

describe("pickPrimaryAndAlternates — the fairness rule (R19)", () => {
  it("alternates exclude the primary's own area, even when that area's candidates would otherwise rank next", () => {
    const now = new Date("2026-09-02T12:00:00Z");
    const primaryCandidate = candidate({ id: "school-1", area: "school", dueAt: new Date(now.getTime() + 10 * 60 * 1000) });
    const sameAreaRunnerUp = candidate({ id: "school-2", area: "school", dueAt: new Date(now.getTime() + 20 * 60 * 1000) });
    const deen = candidate({ id: "deen-1", area: "deen", dueAt: new Date(now.getTime() + 30 * 60 * 1000) });
    const fitness = candidate({ id: "fitness-1", area: "fitness", dueAt: new Date(now.getTime() + 40 * 60 * 1000) });

    const { primary, alternates } = pickPrimaryAndAlternates([sameAreaRunnerUp, deen, fitness, primaryCandidate], now);

    expect(primary?.id).toBe("school-1");
    expect(alternates.map((c) => c.id)).toEqual(["deen-1", "fitness-1"]);
    expect(alternates.some((c) => c.area === "school")).toBe(false);
  });

  it("a Self-Mastery primary can still show Deen and Fitness as alternates -- they are independent areas, not excluded by a shared onboarding grouping", () => {
    const now = new Date("2026-09-02T12:00:00Z");
    // Deen/Fitness are outside the 2h right_now window (later_today) so
    // the overdue session (right_now -- any negative diff qualifies) wins
    // the primary slot on urgency tier alone, not by accident of the
    // future-beats-overdue dueAt rule this file's own tests pin above.
    const overdueSession = candidate({ id: "session", area: "self_mastery", dueAt: new Date(now.getTime() - 60 * 60 * 1000) });
    const deen = candidate({ id: "deen-1", area: "deen", dueAt: new Date(now.getTime() + 3 * 60 * 60 * 1000) });
    const fitness = candidate({ id: "fitness-1", area: "fitness", dueAt: new Date(now.getTime() + 4 * 60 * 60 * 1000) });

    const { primary, alternates } = pickPrimaryAndAlternates([overdueSession, deen, fitness], now);

    expect(primary?.id).toBe("session");
    expect(alternates.map((c) => c.id)).toEqual(["deen-1", "fitness-1"]);
  });

  it("degrades to fewer alternates rather than throwing when there aren't 2 other areas", () => {
    const now = new Date("2026-09-02T12:00:00Z");
    const only = candidate({ id: "only", area: "school", dueAt: new Date(now.getTime() + 10 * 60 * 1000) });

    const { primary, alternates } = pickPrimaryAndAlternates([only], now);

    expect(primary?.id).toBe("only");
    expect(alternates).toEqual([]);
  });

  it("empty input returns a null primary and no alternates, never throws", () => {
    const now = new Date("2026-09-02T12:00:00Z");
    expect(pickPrimaryAndAlternates([], now)).toEqual({ primary: null, alternates: [] });
  });
});
