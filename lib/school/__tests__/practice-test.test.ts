import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PRACTICE_TEST_INTERVALS,
  daysBetweenDateStrings,
  assemblePracticeTestQuestions,
  assertPracticeTestClassMatchesAssessment,
  PracticeTestClassMismatchError,
  dispatchPracticeTestAssembly,
} from "../practice-test";

describe("daysBetweenDateStrings()", () => {
  it("computes a plain calendar-day difference, ignoring any notion of time-of-day", () => {
    expect(daysBetweenDateStrings("2026-10-01", "2026-10-15")).toBe(14);
    expect(daysBetweenDateStrings("2026-10-15", "2026-10-01")).toBe(-14);
    expect(daysBetweenDateStrings("2026-10-01", "2026-10-01")).toBe(0);
  });

  it("crosses a month boundary correctly", () => {
    expect(daysBetweenDateStrings("2026-09-25", "2026-10-05")).toBe(10);
  });

  it("crosses a year boundary correctly", () => {
    expect(daysBetweenDateStrings("2026-12-28", "2027-01-04")).toBe(7);
  });
});

describe("assemblePracticeTestQuestions()", () => {
  const bank = Array.from({ length: 20 }, (_, i) => `q${i}`);

  it("caps at the given count", () => {
    expect(assemblePracticeTestQuestions(bank, "seed-a", 5)).toHaveLength(5);
  });

  it("returns fewer than count when the bank itself is smaller", () => {
    expect(assemblePracticeTestQuestions(["q1", "q2"], "seed-a", 10)).toHaveLength(2);
  });

  it("is deterministic for the same seed -- reproducible, not random", () => {
    const a = assemblePracticeTestQuestions(bank, "exam-1:T-14");
    const b = assemblePracticeTestQuestions(bank, "exam-1:T-14");
    expect(a).toEqual(b);
  });

  it("different seeds (different intervals for the same exam) draw different subsets -- not the same first N every time", () => {
    const t14 = assemblePracticeTestQuestions(bank, "exam-1:T-14");
    const t7 = assemblePracticeTestQuestions(bank, "exam-1:T-7");
    expect(t14).not.toEqual(t7);
  });

  it("never returns an id not present in the input bank", () => {
    const result = assemblePracticeTestQuestions(bank, "seed-x", 5);
    for (const id of result) expect(bank).toContain(id);
  });

  it("never duplicates an id within one assembled test", () => {
    const result = assemblePracticeTestQuestions(bank, "seed-x", 8);
    expect(new Set(result).size).toBe(result.length);
  });
});

describe("assertPracticeTestClassMatchesAssessment() (Opus Lead finding, 2026-09-15)", () => {
  it("passes silently when the class ids agree", () => {
    expect(() => assertPracticeTestClassMatchesAssessment("assessment-1", "class-1", "class-1")).not.toThrow();
  });

  it("THE REGRESSION GUARD: throws PracticeTestClassMismatchError when the class ids disagree -- the DB itself has no FK/CHECK catching this", () => {
    expect(() => assertPracticeTestClassMatchesAssessment("assessment-1", "class-1", "class-2")).toThrow(PracticeTestClassMismatchError);
  });

  it("the error message names the assessment and both class ids, for a debuggable failure", () => {
    try {
      assertPracticeTestClassMatchesAssessment("assessment-1", "class-1", "class-2");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PracticeTestClassMismatchError);
      expect((e as Error).message).toContain("assessment-1");
      expect((e as Error).message).toContain("class-1");
      expect((e as Error).message).toContain("class-2");
    }
  });
});

describe("dispatchPracticeTestAssembly()", () => {
  function makeClient(opts: {
    exams?: { id: string; user_id: string; class_id: string; date: string }[];
    profiles?: { user_id: string; timezone: string | null }[];
    questionsByClass?: Record<string, { id: string }[]>;
    alreadyAssembled?: Set<string>; // "assessmentId:interval"
    /** Overrides the class_id returned by the FRESH per-assessment single-row read the enforcement point makes, keyed by exam id -- lets a test simulate the assessment's own row disagreeing with the batch-fetched exam.class_id. */
    assessmentClassIdOverride?: Record<string, string>;
  }) {
    const insertCalls: Record<string, unknown>[] = [];
    const claimed = new Set(opts.alreadyAssembled ?? []);

    const from = vi.fn((table: string) => {
      const eqFilters: [string, unknown][] = [];
      let wantsSingle = false;
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn((col: string, val: unknown) => {
        eqFilters.push([col, val]);
        return chain;
      });
      chain.in = vi.fn(() => chain);
      chain.maybeSingle = vi.fn(() => {
        wantsSingle = true;
        return chain;
      });
      chain.then = (resolve: (v: { data: unknown; error: null }) => void) => {
        if (table === "class_assessments") {
          if (wantsSingle) {
            const idFilter = eqFilters.find(([c]) => c === "id");
            const examId = idFilter?.[1] as string | undefined;
            const exam = (opts.exams ?? []).find((e) => e.id === examId);
            if (!exam) return resolve({ data: null, error: null });
            const classId = opts.assessmentClassIdOverride?.[examId!] ?? exam.class_id;
            return resolve({ data: { class_id: classId }, error: null });
          }
          return resolve({ data: opts.exams ?? [], error: null });
        }
        if (table === "profiles") return resolve({ data: opts.profiles ?? [], error: null });
        if (table === "questions") {
          const classFilter = eqFilters.find(([c]) => c === "class_id");
          const classId = classFilter?.[1] as string | undefined;
          return resolve({ data: (classId && opts.questionsByClass?.[classId]) ?? [], error: null });
        }
        resolve({ data: [], error: null });
      };
      chain.insert = vi.fn((row: Record<string, unknown>) => {
        const key = `${row.assessment_id}:${row.interval_label}`;
        if (claimed.has(key)) return Promise.resolve({ error: { code: "23505" } });
        claimed.add(key);
        insertCalls.push(row);
        return Promise.resolve({ error: null });
      });
      return chain;
    });

    return { client: { from } as unknown as SupabaseClient, insertCalls };
  }

  it("assembles nothing when there are no upcoming exams", async () => {
    const { client } = makeClient({ exams: [] });
    const result = await dispatchPracticeTestAssembly(client, new Date("2026-09-15T12:00:00Z"));
    expect(result).toEqual({ examsChecked: 0, assembled: 0 });
  });

  it("THE REGRESSION GUARD: assembles at exactly T-14 (14 days before the exam, in the owner's own timezone)", async () => {
    const { client, insertCalls } = makeClient({
      exams: [{ id: "exam-1", user_id: "user-1", class_id: "class-1", date: "2026-09-29" }], // 14 days after 09-15
      profiles: [{ user_id: "user-1", timezone: "UTC" }],
      questionsByClass: { "class-1": [{ id: "q1" }, { id: "q2" }] },
    });
    const result = await dispatchPracticeTestAssembly(client, new Date("2026-09-15T12:00:00Z"));
    expect(result).toEqual({ examsChecked: 1, assembled: 1 });
    expect(insertCalls[0]).toMatchObject({ assessment_id: "exam-1", class_id: "class-1", interval_label: "T-14" });
  });

  it("does not assemble on a day that isn't one of the 4 fixed intervals (e.g. 10 days out)", async () => {
    const { client, insertCalls } = makeClient({
      exams: [{ id: "exam-1", user_id: "user-1", class_id: "class-1", date: "2026-09-25" }], // 10 days out
      profiles: [{ user_id: "user-1", timezone: "UTC" }],
      questionsByClass: { "class-1": [{ id: "q1" }] },
    });
    const result = await dispatchPracticeTestAssembly(client, new Date("2026-09-15T12:00:00Z"));
    expect(result.assembled).toBe(0);
    expect(insertCalls).toHaveLength(0);
  });

  it("a class with an empty active question bank assembles nothing for that interval, without erroring", async () => {
    const { client, insertCalls } = makeClient({
      exams: [{ id: "exam-1", user_id: "user-1", class_id: "class-1", date: "2026-09-29" }],
      profiles: [{ user_id: "user-1", timezone: "UTC" }],
      questionsByClass: { "class-1": [] },
    });
    const result = await dispatchPracticeTestAssembly(client, new Date("2026-09-15T12:00:00Z"));
    expect(result.assembled).toBe(0);
    expect(insertCalls).toHaveLength(0);
  });

  it("skips an interval already assembled (unique-constraint conflict), never throws", async () => {
    const { client, insertCalls } = makeClient({
      exams: [{ id: "exam-1", user_id: "user-1", class_id: "class-1", date: "2026-09-29" }],
      profiles: [{ user_id: "user-1", timezone: "UTC" }],
      questionsByClass: { "class-1": [{ id: "q1" }] },
      alreadyAssembled: new Set(["exam-1:T-14"]),
    });
    const result = await dispatchPracticeTestAssembly(client, new Date("2026-09-15T12:00:00Z"));
    expect(result.assembled).toBe(0);
    expect(insertCalls).toHaveLength(0);
  });

  it("a user in a different timezone at the SAME UTC instant gets a different answer -- 'today' is the exam owner's own local day", async () => {
    // Sep 15 2026 23:00 UTC is Sep 15 in America/Chicago (UTC-5) but Sep 16 in Asia/Tokyo (UTC+9).
    const { client, insertCalls } = makeClient({
      exams: [
        { id: "exam-chicago", user_id: "chicago-user", class_id: "class-1", date: "2026-09-29" }, // T-14 from Sep 15
        { id: "exam-tokyo", user_id: "tokyo-user", class_id: "class-2", date: "2026-09-29" }, // T-13 from Sep 16, not a fixed interval
      ],
      profiles: [
        { user_id: "chicago-user", timezone: "America/Chicago" },
        { user_id: "tokyo-user", timezone: "Asia/Tokyo" },
      ],
      questionsByClass: { "class-1": [{ id: "q1" }], "class-2": [{ id: "q2" }] },
    });
    const result = await dispatchPracticeTestAssembly(client, new Date("2026-09-15T23:00:00.000Z"));
    expect(result.assembled).toBe(1);
    expect(insertCalls[0]).toMatchObject({ assessment_id: "exam-chicago" });
  });

  it("a profile with no timezone defaults to UTC rather than throwing", async () => {
    const { client } = makeClient({
      exams: [{ id: "exam-1", user_id: "user-1", class_id: "class-1", date: "2026-09-29" }],
      profiles: [{ user_id: "user-1", timezone: null }],
      questionsByClass: { "class-1": [{ id: "q1" }] },
    });
    await expect(dispatchPracticeTestAssembly(client, new Date("2026-09-15T12:00:00Z"))).resolves.toEqual({ examsChecked: 1, assembled: 1 });
  });

  it("THE REGRESSION GUARD (fixed 2026-09-15, second pass): throws when the assessment's own class_id, read fresh from the DB, disagrees with the class_id about to be written -- the original enforcement call passed the same value for both arguments and could never fail", async () => {
    const { client, insertCalls } = makeClient({
      exams: [{ id: "exam-1", user_id: "user-1", class_id: "class-1", date: "2026-09-29" }],
      profiles: [{ user_id: "user-1", timezone: "UTC" }],
      questionsByClass: { "class-1": [{ id: "q1" }] },
      assessmentClassIdOverride: { "exam-1": "class-DIFFERENT" },
    });
    await expect(dispatchPracticeTestAssembly(client, new Date("2026-09-15T12:00:00Z"))).rejects.toThrow(PracticeTestClassMismatchError);
    expect(insertCalls).toHaveLength(0);
  });

  it("processes multiple exams independently in one tick", async () => {
    const { client, insertCalls } = makeClient({
      exams: [
        { id: "exam-1", user_id: "user-1", class_id: "class-1", date: "2026-09-29" }, // T-14
        { id: "exam-2", user_id: "user-1", class_id: "class-2", date: "2026-09-22" }, // T-7
        { id: "exam-3", user_id: "user-1", class_id: "class-3", date: "2026-09-25" }, // T-10, not fixed
      ],
      profiles: [{ user_id: "user-1", timezone: "UTC" }],
      questionsByClass: { "class-1": [{ id: "q1" }], "class-2": [{ id: "q2" }], "class-3": [{ id: "q3" }] },
    });
    const result = await dispatchPracticeTestAssembly(client, new Date("2026-09-15T12:00:00Z"));
    expect(result).toEqual({ examsChecked: 3, assembled: 2 });
  });
});

describe("PRACTICE_TEST_INTERVALS", () => {
  it("is exactly the 4 fixed intervals the acceptance criteria names, furthest-to-nearest", () => {
    expect(PRACTICE_TEST_INTERVALS.map((i) => i.label)).toEqual(["T-14", "T-7", "T-3", "T-1"]);
    expect(PRACTICE_TEST_INTERVALS.map((i) => i.daysBefore)).toEqual([14, 7, 3, 1]);
  });
});
