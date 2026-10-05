"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * A link between the Fitness screens that stays inside whichever shell the person is in. The same Fitness
 * page renders at /fitness (legacy accounts) AND at /personal/fitness (domains accounts, under the Personal
 * tab bar: Faith / Self-Mastery / Fitness). A plain href="/fitness/workouts" dropped a Personal user out of
 * that shell, and "Back" then landed on a Fitness page with no tab bar. Under /personal/* the target is
 * prefixed with /personal; anywhere else it is used as written.
 */
export function personalAwareHref(pathname: string | null, href: string): string {
  return pathname?.startsWith("/personal/") && href.startsWith("/fitness") ? `/personal${href}` : href;
}

export function FitnessLink({ href, ...rest }: Omit<React.ComponentProps<typeof Link>, "href"> & { href: string }) {
  return <Link href={personalAwareHref(usePathname(), href)} {...rest} />;
}
