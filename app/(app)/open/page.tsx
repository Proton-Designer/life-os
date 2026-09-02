import Link from "next/link";
import { redirect } from "next/navigation";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString } from "@/lib/date-utils";

/**
 * The morning open — B1's other half.
 *
 * BOSS-VISION §6: "≤ 3 taps, optional: Start Day, confirm last night's crowned
 * three, see today's shape."
 *
 * READ-ONLY, DELIBERATELY. The vision also says the morning open is
 * "confirm-and-start, never a second writer". So this page shows what last
 * night decided and gets out of the way; it does not let you re-crown at 7am.
 * If the plan is wrong, the honest remedy is to re-run the close, not to give
 * the morning a quiet second write path that would make "the night before is
 * the authoritative writer" false without anything saying so.
 *
 * THE TAP BUDGET IS THE FEATURE. Landing here IS the first tap; "Start day" is
 * the second and it leads to today's shape. A correct screen that costs five
 * taps has failed the thing it was specified for, so the count is asserted
 * rather than assumed — two controls, and neither is a menu.
 *
 * A plan is read for the USER'S today via localDateString(now, timezone).
 * Deriving it from the server clock would silently read tomorrow's plan for
 * anyone west of Greenwich after 18:00 local, which is exactly when nobody is
 * looking at a morning screen and so exactly when it would go unnoticed.
 */
export default async function MorningOpenPage() {
  const user = await getAuthedUser();
  if (!user) redirect("/login");

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const today = localDateString(new Date(), timezone);

  const supabase = await createClient();
  const { data } = await supabase
    .from("tasks")
    .select("id, title, mit_rank, completed")
    .eq("user_id", user.id)
    .eq("planned_date", today)
    .not("mit_rank", "is", null)
    .order("mit_rank", { ascending: true });

  const plan = data ?? [];

  return (
    <PageContainer>
      <PageHeader title="Good morning" />

      {plan.length === 0 ? (
        <section className="space-y-3">
          {/* No plan is a real answer, not an error and not a prompt to make one
              now — the close is an evening ceremony and dragging it into the
              morning is how a 3-minute ritual becomes a 15-minute one. */}
          <div className="rounded-lg border p-4">
            <p className="text-sm">No plan was made last night.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Today is open. The close runs this evening.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Start day
          </Link>
        </section>
      ) : (
        <section className="space-y-4">
          <p className="text-sm text-muted-foreground">Last night you chose these.</p>
          <ol className="space-y-2">
            {plan.map((t) => {
              const crowned = t.mit_rank === 1;
              return (
                <li
                  key={t.id}
                  className={
                    crowned
                      ? "rounded-lg border-2 border-primary/60 p-4"
                      : "rounded-lg border p-3"
                  }
                >
                  <div className="flex items-start gap-2">
                    <span aria-hidden className="shrink-0 text-sm text-muted-foreground">
                      {crowned ? "★" : t.mit_rank}
                    </span>
                    <span className={crowned ? "text-base font-medium" : "text-sm"}>{t.title}</span>
                  </div>
                  {crowned ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      The one thing. If only this happens, today counted.
                    </p>
                  ) : null}
                  <span className="sr-only">
                    {crowned ? "crowned" : `rank ${t.mit_rank}`}
                    {t.completed ? ", already done" : ""}
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="flex items-center gap-3">
            {/* Confirm-and-start: one tap. */}
            <Link
              href="/"
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              Start day
            </Link>
            {/* R60's one escape: it ROUTES to the close's plan stage — re-running
                the writer — rather than re-crowning here. A re-crown in place
                would make "the night before is the only writer of rank" false
                without anything saying so, and the morning is exactly when a
                plan feels wrong for reasons the evening was right to ignore. */}
            <Link href="/close" className="text-sm text-muted-foreground underline underline-offset-4">
              Re-plan
            </Link>
          </div>
        </section>
      )}
    </PageContainer>
  );
}
