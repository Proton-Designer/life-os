import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listCapabilitiesTool, resolveListCapabilitiesOperation } from "../list-capabilities";

function textPayload(outcome: Awaited<ReturnType<typeof listCapabilitiesTool>>) {
  const block = outcome.result.content[0];
  if (block.type !== "text") throw new Error("expected a text block");
  return JSON.parse(block.text);
}

/** A domains-mode (faith only) account, for the no-argument call — which is now the account map (P4-03). */
function accountContext() {
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "order"]) chain[m] = vi.fn(() => chain);
    const rows = table === "user_domains" ? [{ id: "d1", key: "faith", position: 0, weight: "essential" }] : [];
    chain.maybeSingle = vi.fn(async () => ({ data: table === "profiles" ? { timezone: "America/Chicago", onboarding_completed: true, deen_mode: true } : null, error: null }));
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
    return chain;
  });
  return { userClient: { from } as unknown as SupabaseClient, userId: "user-1", now: new Date("2026-09-15T03:30:00.000Z") };
}

describe("listCapabilitiesTool — P4-03 account map and write detail", () => {
  it("with no domain, returns the ACCOUNT MAP: local today, mode, active areas, per-domain read/write names", async () => {
    const payload = textPayload(await listCapabilitiesTool(undefined, accountContext()));
    expect(payload.today).toEqual({ local_date: "2026-09-14", timezone: "America/Chicago", local_time: "22:30" });
    expect(payload.mode).toBe("domains");
    expect(payload.active_areas).toEqual(["faith"]);
    expect(payload.domain_fields).toEqual(["one_line", "active_for_account", "read", "write", "views"]);
    const [oneLine, deenActive, deenRead, deenWrite, deenViews] = payload.domains.deen;
    expect(oneLine).toEqual(expect.any(String));
    expect(deenActive).toBe(true);
    expect(deenRead).toContain("prayer");
    expect(deenWrite).toContain("prayer");
    expect(deenViews).toEqual([]);
    expect(payload.domains.fitness[1]).toBe(false);
  });

  it("with no domain and no account context, refuses rather than returning an account-agnostic list", async () => {
    await expect(listCapabilitiesTool()).rejects.toThrow(/account context/i);
  });

  it("per-domain detail carries each write action's description, patch shape, requires_id and schedulable", async () => {
    const payload = textPayload(await listCapabilitiesTool("work"));
    const target = payload.entities.find((e: { entity: string }) => e.entity === "target");
    const complete = target.write_actions.find((a: { action: string }) => a.action === "complete");
    expect(complete).toEqual({ action: "complete", description: expect.any(String), patch: "{}", requires_id: true, schedulable: expect.any(Boolean) });
    const deen = textPayload(await listCapabilitiesTool("deen"));
    const log = deen.entities.find((e: { entity: string }) => e.entity === "prayer").write_actions.find((a: { action: string }) => a.action === "log");
    expect(log).toMatchObject({ requires_id: false, patch: expect.stringContaining("date") });
    // P4-06: deen.habit gained 5 write actions — create has no top-level id
    // (a new row), the other 4 target an existing habit by id.
    const habitActions = deen.entities.find((e: { entity: string }) => e.entity === "habit").write_actions;
    expect(habitActions.map((a: { action: string }) => a.action).sort()).toEqual(["archive", "create", "set_committed_date", "set_frequency", "set_stage_override", "update"]);
    expect(habitActions.find((a: { action: string }) => a.action === "create")).toMatchObject({ requires_id: false });
    expect(habitActions.find((a: { action: string }) => a.action === "update")).toMatchObject({ requires_id: true, patch: expect.any(String) });
  });

  it("widgets detail names the 5 kinds and a display schema per kind", async () => {
    const payload = textPayload(await listCapabilitiesTool("widgets"));
    expect(payload.widget_kinds).toEqual(["metric_card", "list", "progress_against_goal", "sparkline", "streak"]);
    expect(Object.keys(payload.display_schema).sort()).toEqual(["list", "metric_card", "progress_against_goal", "sparkline", "streak"]);
    expect(payload.data_source_schema).toEqual(expect.any(String));
  });

  it("settings exposes the account's areas and subdomains as read entities", async () => {
    const payload = textPayload(await listCapabilitiesTool("settings"));
    const names = payload.entities.map((e: { entity: string }) => e.entity);
    expect(names).toEqual(expect.arrayContaining(["area", "subdomain"]));
  });
});

describe("listCapabilitiesTool", () => {
  it("with no domain, lists only domains actually wired — honest, not the memo's full eventual matrix", async () => {
    const outcome = await listCapabilitiesTool(undefined, accountContext());
    const payload = textPayload(outcome);
    expect(Object.keys(payload.domains).sort()).toEqual([
      "business",
      "calendar",
      "checkins",
      // P4-07: day/goals/habits are WRITE_REGISTRY-only domains (no
      // REGISTRY/read entry at all yet) -- buildAccountMap's own
      // write-only-domain fix lists them here too, with read:[], so an
      // agent reading the account map isn't blind to a write surface that
      // genuinely exists. See account-map.test.ts for the dedicated coverage.
      "day",
      "deen",
      "distractions",
      "fitness",
      "goals",
      "habits",
      "home",
      "review",
      "school",
      "self_mastery",
      "settings",
      "widgets",
      "work",
    ]);
  });

  it("source_chunks is listed (existence is not secret) but advertises ZERO readable fields at any tier (content is)", async () => {
    const outcome = await listCapabilitiesTool("self_mastery");
    const payload = textPayload(outcome);
    // Self_mastery's expansion (books/lessons/cards/etc., L11 follow-up)
    // added 11 sibling entities around source_chunks -- found by entity
    // name, not by array position, so this test doesn't silently break the
    // moment the domain grows again.
    const sourceChunks = payload.entities.find((e: { entity: string }) => e.entity === "source_chunks");
    expect(sourceChunks).toBeTruthy();
    expect(sourceChunks.fields.summary).toEqual([]);
    expect(sourceChunks.fields.full).toEqual([]);
  });

  it("with a known domain, lists its entities with fields/detail/filterable info", async () => {
    const outcome = await listCapabilitiesTool("deen");
    const payload = textPayload(outcome);
    expect(payload.domain).toBe("deen");
    expect(payload.entities).toHaveLength(9);
    const prayer = payload.entities.find((e: { entity: string }) => e.entity === "prayer");
    expect(prayer).toMatchObject({
      entity: "prayer",
      detail_levels: ["ids", "summary", "full"],
      // R9: "write:unlog" is now real -- a non-destructive 'unlogged'
      // status, never a DELETE (see docs/ai-connector/
      // WRITE-DELETE-DECISION.md for why status:'pending' would have been
      // wrong, and write-registry.ts's header for what changed).
      actions: ["read", "write:log", "write:unlog"],
    });
    expect(prayer.fields.summary).toEqual(["date", "prayer_name", "status"]);
    expect(prayer.fields.full).toContain("logged_at");
  });

  it("THROWS a clear error for an unknown domain, naming the valid set — never a silent empty result", async () => {
    await expect(listCapabilitiesTool("nonexistent_domain")).rejects.toThrow(/unknown domain.*nonexistent_domain/i);
    await expect(listCapabilitiesTool("nonexistent_domain")).rejects.toThrow(/deen/);
  });

  it("reports write actions for every deen entity that has BOTH read and write coverage (P4-06 added 5 of these)", async () => {
    const outcome = await listCapabilitiesTool("deen");
    const payload = textPayload(outcome);
    const byEntity = Object.fromEntries(payload.entities.map((e: { entity: string; actions: string[] }) => [e.entity, e.actions]));
    expect(byEntity.prayer).toEqual(["read", "write:log", "write:unlog"]); // R9
    expect(byEntity.sunnah_log).toEqual(["read", "write:toggle"]);
    expect(byEntity.adhkar).toEqual(["read", "write:toggle"]);
    expect(byEntity.quran_session).toEqual(["read", "write:log"]); // P4-06
    expect(byEntity.reflection_entry).toEqual(["read", "write:log"]); // P4-06
    expect(byEntity.habit?.sort()).toEqual(
      ["read", "write:archive", "write:create", "write:set_committed_date", "write:set_frequency", "write:set_stage_override", "write:update"].sort(),
    ); // P4-06
    expect(byEntity.habit_log?.sort()).toEqual(["read", "write:set_status", "write:toggle"].sort()); // P4-06
    expect(byEntity.weekly_focus).toEqual(["read", "write:set"]); // P4-06
  });

  // Was a KNOWN GAP test (P4-06): weekly_goal and profile have deen write
  // actions but no deen READ entity, so the entity list alone never showed
  // them. Fixed generically by write_only_entities (P4-03 review, option A).
  it("EVERY write action in WRITE_REGISTRY is discoverable from list_capabilities(domain) -- including write-only entities", async () => {
    const { WRITE_REGISTRY } = await import("@/lib/mcp/write-registry");
    const undiscoverable: string[] = [];
    for (const domainDef of Object.values(WRITE_REGISTRY)) {
      const payload = textPayload(await listCapabilitiesTool(domainDef.domain));
      type Listed = { entity: string; write_actions: { action: string }[] };
      const listed: Listed[] = [...payload.entities, ...(payload.write_only_entities ?? [])];
      for (const entityDef of Object.values(domainDef.entities)) {
        for (const action of Object.keys(entityDef.actions)) {
          const hit = listed.some((e) => e.entity === entityDef.entity && e.write_actions.some((a) => a.action === action));
          if (!hit) undiscoverable.push(`${domainDef.domain}.${entityDef.entity}.${action}`);
        }
      }
    }
    expect(undiscoverable).toEqual([]);
  });

  it("write-only entities carry the same per-action detail, and never duplicate a readable entity", async () => {
    const payload = textPayload(await listCapabilitiesTool("deen"));
    const writeOnly = Object.fromEntries((payload.write_only_entities ?? []).map((e: { entity: string }) => [e.entity, e]));
    expect(Object.keys(writeOnly).sort()).toEqual(["profile", "weekly_goal"]);
    for (const e of Object.values(writeOnly) as { write_actions: Record<string, unknown>[]; note: string }[]) {
      expect(e.note).toEqual(expect.any(String));
      for (const a of e.write_actions) expect(Object.keys(a).sort()).toEqual(["action", "description", "patch", "requires_id", "schedulable"]);
    }
    const readable = new Set(payload.entities.map((e: { entity: string }) => e.entity));
    for (const name of Object.keys(writeOnly)) expect(readable.has(name)).toBe(false);
    // Domains with no write-only entity don't carry an empty key.
    expect(textPayload(await listCapabilitiesTool("work")).write_only_entities).toBeUndefined();
  });

  it("P4-07: a domain that exists ONLY in WRITE_REGISTRY (no read entity at all) resolves instead of throwing 'unknown domain', with every entity under write_only_entities", async () => {
    for (const domain of ["day", "goals", "habits"]) {
      const payload = textPayload(await listCapabilitiesTool(domain));
      expect(payload.domain).toBe(domain);
      expect(payload.entities).toEqual([]); // no read coverage yet -- P4-05's future territory
      expect(payload.write_only_entities.length).toBeGreaterThan(0);
      for (const e of payload.write_only_entities) {
        expect(e.note).toMatch(/no read coverage at all/i);
        expect(e.write_actions.length).toBeGreaterThan(0);
      }
    }
    const goalsEntities = textPayload(await listCapabilitiesTool("goals")).write_only_entities.map((e: { entity: string }) => e.entity).sort();
    expect(goalsEntities).toEqual(["goal", "milestone"]);
  });

  it("P4-07: a MIXED domain (some entities readable, some write-only) reports both correctly -- future-proofs the write-only-domain fix against P4-05 adding read entities for day/goals/habits later (review is the existing example of this exact shape: night_plan_task is readable, worry/sleep_intent are not)", async () => {
    const payload = textPayload(await listCapabilitiesTool("review"));
    const readableNames = new Set(payload.entities.map((e: { entity: string }) => e.entity));
    expect(readableNames.has("night_plan_task")).toBe(true);
    const nightPlanTask = payload.entities.find((e: { entity: string }) => e.entity === "night_plan_task");
    expect(nightPlanTask.actions.sort()).toEqual(["read", "write:claim_seeds", "write:dump", "write:save_ranks"].sort());
    const writeOnlyNames = payload.write_only_entities.map((e: { entity: string }) => e.entity).sort();
    expect(writeOnlyNames).toEqual(["sleep_intent", "worry"]);
    for (const e of payload.write_only_entities) expect(e.note).toMatch(/no read entity under this domain name/i);
    // Not double-counted: a write-only entity never also appears in `entities`.
    expect(readableNames.has("worry")).toBe(false);
    expect(readableNames.has("sleep_intent")).toBe(false);
  });

  it("P4-07: 'unknown domain' error's known-domains list includes write-only domains too", async () => {
    await expect(listCapabilitiesTool("not_a_real_domain")).rejects.toThrow(/\bday\b.*\bgoals\b.*\bhabits\b|\bhabits\b.*\bgoals\b.*\bday\b/);
  });

  it("self_mastery: source_chunks/book/book_section/card/card_state stay read-only -- P4-08 added lesson (promote-only), question_review, and session; nothing else gained a write action", async () => {
    const outcome = await listCapabilitiesTool("self_mastery");
    const payload = textPayload(outcome);
    const byEntity = Object.fromEntries(payload.entities.map((e: { entity: string; actions: string[] }) => [e.entity, e.actions]));
    for (const stillReadOnly of ["source_chunks", "book", "book_section", "card", "card_state", "source", "question"]) {
      expect(byEntity[stillReadOnly]).toEqual(["read"]);
    }
    // The three the owner actually asked for -- grading a review,
    // adopting/abandoning a promotion, logging a reflection -- and nothing
    // wider (lessons/cards/source_chunks content stays out of reach above).
    expect(byEntity.review).toEqual(["read", "write:grade"]);
    expect(byEntity.lesson_promotion).toEqual(["read", "write:record_verdict"]);
    expect(byEntity.self_explanation).toEqual(["read", "write:log"]);
    // lesson_verdict itself is still read-only -- the write action targets
    // lesson_promotion (record a verdict AGAINST a promotion), it doesn't
    // register as a lesson_verdict-entity write.
    expect(byEntity.lesson_verdict).toEqual(["read"]);
    // P4-08: lesson gained ONE write action (promote a lesson into a live
    // experiment) -- still never general lesson-content mutation.
    expect(byEntity.lesson).toEqual(["read", "write:promote"]);
  });

  it("work/business entities report their real write actions from write-registry.ts, live", async () => {
    const work = await listCapabilitiesTool("work");
    const workByEntity = Object.fromEntries((await textPayload(work)).entities.map((e: { entity: string; actions: string[] }) => [e.entity, e.actions]));
    expect(workByEntity.target.sort()).toEqual(["read", "write:complete", "write:create", "write:edit", "write:reorder"]);
    expect(workByEntity.task).not.toContain("write:remove");
    expect(workByEntity.task).not.toContain("write:bulk_remove");

    const business = await listCapabilitiesTool("business");
    const businessByEntity = Object.fromEntries((await textPayload(business)).entities.map((e: { entity: string; actions: string[] }) => [e.entity, e.actions]));
    expect(businessByEntity.kill_list_item.sort()).toEqual(["read", "write:set", "write:toggle"]);
    expect(businessByEntity.weekly_goal.sort()).toEqual(["read", "write:save"]);
  });

  it("school's entities report their real write actions, and never an excluded hard-delete/recurrence action", async () => {
    const outcome = await listCapabilitiesTool("school");
    const payload = textPayload(outcome);
    expect(payload.entities).toHaveLength(6);
    const byEntity = Object.fromEntries(payload.entities.map((e: { entity: string; actions: string[] }) => [e.entity, e.actions]));

    // Neither is wired for write at all (see SCHOOL-WRITE-SCOPE-DECISIONS.md
    // — both writes stay expressed as schedule_event.set_override/cancel_occurrence).
    expect(byEntity.schedule_event_override).toEqual(["read"]);
    expect(byEntity.schedule_event_cancellation).toEqual(["read"]);

    expect(byEntity.task.sort()).toEqual(["read", "write:add", "write:edit", "write:toggle"]);
    expect(byEntity.task).not.toContain("write:remove");

    expect(byEntity.class.sort()).toEqual(["read", "write:create", "write:edit"]);

    expect(byEntity.class_assessment.sort()).toEqual(["read", "write:add", "write:edit"]);
    expect(byEntity.class_assessment).not.toContain("write:remove");

    expect(byEntity.schedule_event.sort()).toEqual(["read", "write:cancel_occurrence", "write:edit_series", "write:set_override"]);
    expect(byEntity.schedule_event).not.toContain("write:create");
    expect(byEntity.schedule_event).not.toContain("write:remove");
    expect(byEntity.schedule_event).not.toContain("write:remove_override");
    expect(byEntity.schedule_event).not.toContain("write:uncancel");
  });

  it("fitness's 15 entities are all listed; only the 5 logging/library ones carry write actions", async () => {
    const outcome = await listCapabilitiesTool("fitness");
    const payload = textPayload(outcome);
    expect(payload.entities).toHaveLength(15);
    const byEntity = Object.fromEntries(payload.entities.map((e: { entity: string; actions: string[] }) => [e.entity, e.actions]));

    expect(byEntity.workout_session.sort()).toEqual(["read", "write:confirm", "write:confirm_plan_session", "write:quick_log"]);
    expect(byEntity.body_metric.sort()).toEqual(["read", "write:log_waist", "write:log_weight"]);
    expect(byEntity.fitness_benchmark.sort()).toEqual(["read", "write:log"]);
    expect(byEntity.exercise.sort()).toEqual(["read", "write:archive", "write:create"]);
    expect(byEntity.workout.sort()).toEqual(["read", "write:archive", "write:rename"]);

    for (const readOnly of ["session_set", "workout_plan", "plan_session", "plan_session_exercise", "plan_micro_exercise", "workout_exercise", "workout_schedule", "active_workout_plan", "fitness_cycle_anchor", "rep_goal"]) {
      expect(byEntity[readOnly]).toEqual(["read"]);
    }
  });
});

describe("resolveListCapabilitiesOperation", () => {
  it("is domain-scoped when a domain is given", () => {
    expect(resolveListCapabilitiesOperation("deen")).toBe("discovery.deen.list_capabilities");
  });

  it("is generic when no domain is given", () => {
    expect(resolveListCapabilitiesOperation()).toBe("discovery.list_capabilities");
  });
});
