import { revalidatePath } from "next/cache";

/**
 * WORK-W1 review F1/F2: with Work tabs the Business screen is served at /work/<key> (and the Work
 * screen at /work/<key> too), not only at /business and /work. A write that revalidated just the
 * old path left the tab stale for the whole staleTimes.dynamic window. Every Business / Work
 * writer calls ONE of these instead of revalidating the path itself, so the tab route can't be
 * forgotten again. Plain (non-"use server") module: imported by Server Actions.
 */
const WORK_TAB_PAGE = "/work/[subdomain]";

export function revalidateBusinessScreens(): void {
  revalidatePath("/business");
  revalidatePath(WORK_TAB_PAGE, "page");
}

export function revalidateWorkScreens(): void {
  revalidatePath("/work");
  revalidatePath(WORK_TAB_PAGE, "page");
}
