import "server-only";
import { requireUser } from "@/lib/supabase/auth";
import { untypedFrom } from "@/lib/self-mastery/untyped-from";
import type { ActivePromotion, PromotableArea, PromotableAreasState, Verdict } from "./types";

/**
 * Reads for the loop seam. Everything here is a plain SELECT scoped to the
 * caller; RLS on `lesson_promotions`/`lesson_verdicts` (124) is the real
 * boundary and the explicit `.eq("user_id", userId)` is belt and braces, in
 * this repo's existing style.
 *
 * `lesson_promotions` and `lesson_verdicts` are not in the generated Database
 * type, so they go through `untypedFrom` like every other post-060 ULM table.
 */

/**
 * There is no canonical DomainKey -> display-name map in this repo. Two
 * partial ones exist (`app/(app)/personal/[subdomain]/layout.tsx` covers three
 * subdomains, `lib/domain-icons.ts` covers five glyph domains) and neither
 * spans the whole `DomainKey` union. This is a local map for one picker
 * rather than a seventh half-map presented as canonical: if a key is ever
 * added and not listed here it falls back to the raw key, which is ugly and
 * visible, instead of blank.
 */
const AREA_LABEL: Record<string, string> = {
  personal_growth: "Personal Growth",
  faith: "Faith",
  body: "Body",
  learning: "Learning",
  business: "Business",
  work: "Work",
  school: "School",
};

function labelForKey(key: string): string {
  return AREA_LABEL[key] ?? key;
}

interface AreaRow {
  id: string;
  key: string;
  position: number;
}

/**
 * The areas a lesson can be promoted into.
 *
 * Returns `{ status: "no-areas" }`, never an empty array, when the account has
 * none — see the note on PromotableAreasState. Archived areas are excluded:
 * `115` archives the `personal_growth` group row, and offering a user an area
 * their own app no longer shows them would be offering a dead end.
 */
export async function getPromotableAreas(): Promise<PromotableAreasState> {
  const { supabase, userId } = await requireUser();
  const { data, error } = await untypedFrom(supabase, "user_domains")
    .select("id, key, position")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("position", { ascending: true })
    .returns<AreaRow[]>();
  if (error) throw error;

  const areas: PromotableArea[] = (data ?? []).map((row) => ({
    id: row.id,
    key: row.key,
    label: labelForKey(row.key),
  }));
  if (areas.length === 0) return { status: "no-areas" };
  return { status: "ready", areas };
}

interface PromotionRow {
  id: string;
  lesson_id: string;
  area_id: string;
  accepted_text: string;
  started_at: string;
  verdict_due_at: string;
}

/**
 * The active promotion for one lesson, if any. The lesson surface needs this
 * to know whether to offer "Try this" or show that it is already running:
 * `lesson_promotions_active_per_lesson` makes a second one impossible, so
 * offering the button anyway would be offering a guaranteed error.
 */
export async function getActivePromotionForLesson(lessonId: string): Promise<{ id: string; acceptedText: string; verdictDueAt: string } | null> {
  const { supabase, userId } = await requireUser();
  const { data, error } = await untypedFrom(supabase, "lesson_promotions")
    .select("id, accepted_text, verdict_due_at")
    .eq("user_id", userId)
    .eq("lesson_id", lessonId)
    .is("retired_at", null)
    .maybeSingle()
    .returns<{ id: string; accepted_text: string; verdict_due_at: string } | null>();
  if (error) throw error;
  if (!data) return null;
  return { id: data.id, acceptedText: data.accepted_text, verdictDueAt: data.verdict_due_at };
}

/**
 * Promotions whose verdict is due — the evening close's reflect stage.
 *
 * `verdict_due_at <= now()` and not retired. A promotion the user marked
 * `still_testing` STAYS due: `still_testing` is deliberately not terminal, so
 * it comes back rather than disappearing for another thirty days. That is the
 * point of the three-way verdict — "not yet" is an answer, not a dismissal.
 *
 * Returns [] when nothing is due. An empty array here is honest: it means the
 * query ran and found nothing, and the caller renders nothing at all rather
 * than a placeholder that looks like data.
 */
export async function getDuePromotions(now: Date = new Date()): Promise<ActivePromotion[]> {
  const { supabase, userId } = await requireUser();

  const { data: promotions, error } = await untypedFrom(supabase, "lesson_promotions")
    .select("id, lesson_id, area_id, accepted_text, started_at, verdict_due_at")
    .eq("user_id", userId)
    .is("retired_at", null)
    .lte("verdict_due_at", now.toISOString())
    .order("verdict_due_at", { ascending: true })
    .returns<PromotionRow[]>();
  if (error) throw error;
  if (!promotions || promotions.length === 0) return [];

  const lessonIds = [...new Set(promotions.map((p) => p.lesson_id))];
  const areaIds = [...new Set(promotions.map((p) => p.area_id))];
  const promotionIds = promotions.map((p) => p.id);

  const [{ data: lessons }, { data: areas }, { data: verdicts }] = await Promise.all([
    untypedFrom(supabase, "lessons").select("id, title").in("id", lessonIds).eq("user_id", userId).returns<{ id: string; title: string }[]>(),
    untypedFrom(supabase, "user_domains").select("id, key").in("id", areaIds).eq("user_id", userId).returns<{ id: string; key: string }[]>(),
    untypedFrom(supabase, "lesson_verdicts")
      .select("promotion_id, verdict, verdict_at, reason")
      .in("promotion_id", promotionIds)
      .eq("user_id", userId)
      .order("verdict_at", { ascending: false })
      .returns<{ promotion_id: string; verdict: Verdict; verdict_at: string; reason: string | null }[]>(),
  ]);

  const lessonTitle = new Map((lessons ?? []).map((l) => [l.id, l.title]));
  const areaKey = new Map((areas ?? []).map((a) => [a.id, a.key]));

  return promotions.map((p) => ({
    id: p.id,
    lessonId: p.lesson_id,
    // A missing title would mean the lesson was deleted under a live
    // promotion, which the ON DELETE CASCADE makes impossible — but the map
    // lookup is still an Option, and inventing "Untitled" would hide a real
    // inconsistency. The empty string renders as nothing and reads as wrong.
    lessonTitle: lessonTitle.get(p.lesson_id) ?? "",
    acceptedText: p.accepted_text,
    areaId: p.area_id,
    areaLabel: labelForKey(areaKey.get(p.area_id) ?? ""),
    startedAt: p.started_at,
    verdictDueAt: p.verdict_due_at,
    priorVerdicts: (verdicts ?? [])
      .filter((v) => v.promotion_id === p.id)
      .map((v) => ({ verdict: v.verdict, verdictAt: v.verdict_at, reason: v.reason })),
  }));
}
