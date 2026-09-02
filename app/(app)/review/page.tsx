import { redirect } from "next/navigation";

/**
 * The distraction review is now the evening close's ACCOUNT STAGE (R61).
 *
 * THIS REDIRECT IS ONLY SAFE BECAUSE THE REWRITE MOVED WITH IT. The account
 * stage mounts `ReviewItemCard` inline, so a three-strike plan is rewritten
 * without leaving `/close`. Shipping this redirect on its own — which the
 * ruling originally called for, on the belief that the absorption had already
 * happened — would have produced:
 *
 *     blocker card -> /review -> /close -> the same blocker card
 *
 * and, worse than the loop, no rewrite surface anywhere. The forced rewrite
 * would have become unresolvable and the close permanently uncompletable for
 * anyone with a failing plan. Every screen would still have rendered
 * correctly; the link would simply have returned you where you were.
 *
 * If you ever remove the inline rewrite from the account stage, remove this
 * redirect in the same commit.
 */
export default function ReviewRedirectPage() {
  redirect("/close");
}
