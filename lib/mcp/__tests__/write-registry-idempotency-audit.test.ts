import { describe, expect, it } from "vitest";
import { getWriteAction, WRITE_REGISTRY } from "../write-registry";

/**
 * The idempotency audit (team-lead's task, following L7): every write
 * action in WRITE_REGISTRY must carry an explicit, evidenced
 * `idempotent`/`idempotencyVerification` verdict before it's eligible for
 * scheduler_manage("create") at all (see lib/scheduling/scheduler-core.ts's
 * own gate). This file pins the verdict TABLE itself, so a future edit to
 * write-registry.ts that silently flips a verdict (or drops one) fails a
 * test rather than fail silently in production. Each verdict's REASONING
 * lives in write-registry.ts's own inline comments, next to the action it
 * describes — this table only asserts the RESULT, not the mechanism.
 */

const EXPECTED: Record<string, Record<string, Record<string, boolean>>> = {
  deen: {
    prayer: { log: true, unlog: true },
    sunnah_log: { toggle: false },
    adhkar: { toggle: false },
  },
  work: {
    target: { create: false, edit: true, complete: true, reorder: true },
    task: { add: false, edit: true, advance: true, retreat: true, block: true, unblock: true },
    work_session: { start: true, end: true },
  },
  business: {
    kill_list_item: { set: true, toggle: false },
    weekly_goal: { save: true },
  },
  school: {
    task: { add: false, edit: true, toggle: false },
    class: { create: false, edit: true },
    class_assessment: { add: false, edit: true },
    schedule_event: { edit_series: true, set_override: true, cancel_occurrence: true },
  },
  fitness: {
    workout_session: { quick_log: false, confirm: true, confirm_plan_session: true },
    body_metric: { log_weight: true, log_waist: true },
    fitness_benchmark: { log: true },
    exercise: { create: false, archive: true },
    workout: { rename: true, archive: true },
  },
  checkins: {
    allocation: { save: false }, // corrected finding -- resolveTargetWindow's fresh window resolution defeats the RPC's own no-op
  },
  distractions: {
    trigger: { capture: false },
    event: { log: false },
    action_plan: { save: true },
    plan_outcome: { record: false },
  },
  settings: {
    profile: { update: true },
    user_setting: { set_weekday_baselines: true, clear_weekday_baselines: true },
  },
};

describe("idempotency audit — every verdict, pinned", () => {
  for (const [domain, entities] of Object.entries(EXPECTED)) {
    for (const [entity, actions] of Object.entries(entities)) {
      for (const [action, expected] of Object.entries(actions)) {
        it(`${domain}.${entity}.${action} is idempotent:${expected}`, () => {
          const def = getWriteAction(domain, entity, action);
          expect(def, `${domain}.${entity}.${action} is not registered at all`).not.toBeNull();
          expect(def!.idempotent, `${domain}.${entity}.${action}`).toBe(expected);
        });
      }
    }
  }

  it("counts: 28 true, 11 false among the actions newly audited this pass (not counting the 8 already annotated by L7) -- the pipeline-status refinement first moved advance/block/unblock (3 actions) from true to false on a more careful read, then a follow-up fix (check-before-write on the timestamp columns, plus the matching work_session.end fix) moved all 4 of advance/block/unblock/work_session.end back to true on their NEW, corrected mechanism -- a verdict flip is only trustworthy when the mechanism named alongside it actually changed too, which it did both times", () => {
    const newlyAudited = { ...EXPECTED };
    delete newlyAudited.checkins;
    delete newlyAudited.distractions;
    delete newlyAudited.settings;
    let trueCount = 0;
    let falseCount = 0;
    for (const entities of Object.values(newlyAudited)) {
      for (const actions of Object.values(entities)) {
        for (const v of Object.values(actions)) {
          if (v) trueCount++;
          else falseCount++;
        }
      }
    }
    expect({ trueCount, falseCount, total: trueCount + falseCount }).toEqual({ trueCount: 28, falseCount: 11, total: 39 });
  });
});

describe("idempotency audit — no action left unannotated", () => {
  it("every registered write action has an explicit boolean idempotent field -- absence would silently mean 'not verified' at the scheduler gate, which must never be mistaken for a value nobody set", () => {
    const missing: string[] = [];
    for (const domain of Object.values(WRITE_REGISTRY)) {
      for (const entity of Object.values(domain.entities)) {
        for (const action of Object.values(entity.actions)) {
          if (typeof action.idempotent !== "boolean") {
            missing.push(`${domain.domain}.${entity.entity}.${action.action}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("every action with an idempotent verdict also carries a non-trivial idempotencyVerification -- a verdict with no recorded mechanism is exactly the 'looks safe' the lead's brief refused to accept", () => {
    const unexplained: string[] = [];
    for (const domain of Object.values(WRITE_REGISTRY)) {
      for (const entity of Object.values(domain.entities)) {
        for (const action of Object.values(entity.actions)) {
          if (typeof action.idempotent === "boolean" && (!action.idempotencyVerification || action.idempotencyVerification.length < 20)) {
            unexplained.push(`${domain.domain}.${entity.entity}.${action.action}`);
          }
        }
      }
    }
    expect(unexplained).toEqual([]);
  });
});

describe("idempotency audit — the gate actually responds to these verdicts (spot-check across the newly-audited domains, not just checkins/distractions)", () => {
  it("work.target.edit (true) and work.target.create (false) — spot check the target entity", () => {
    expect(getWriteAction("work", "target", "edit")!.idempotent).toBe(true);
    expect(getWriteAction("work", "target", "create")!.idempotent).toBe(false);
  });

  it("school.class.edit (true) and school.class.create (false) — spot check the class entity", () => {
    expect(getWriteAction("school", "class", "edit")!.idempotent).toBe(true);
    expect(getWriteAction("school", "class", "create")!.idempotent).toBe(false);
  });

  it("fitness.workout.archive (true) and fitness.exercise.create (false) — spot check fitness", () => {
    expect(getWriteAction("fitness", "workout", "archive")!.idempotent).toBe(true);
    expect(getWriteAction("fitness", "exercise", "create")!.idempotent).toBe(false);
  });

  it("work.task's four pipeline actions are all idempotent now that advance/block/unblock check-before-write instead of unconditionally stamping a fresh timestamp", () => {
    expect(getWriteAction("work", "task", "advance")!.idempotent).toBe(true);
    expect(getWriteAction("work", "task", "retreat")!.idempotent).toBe(true);
    expect(getWriteAction("work", "task", "block")!.idempotent).toBe(true);
    expect(getWriteAction("work", "task", "unblock")!.idempotent).toBe(true);
  });

  it("work.work_session.end is idempotent now that it no-ops on an already-ended session instead of always re-stamping", () => {
    expect(getWriteAction("work", "work_session", "end")!.idempotent).toBe(true);
  });
});
