// Scheduled every 15 minutes via pg_cron. For each user with an active push
// subscription: sends a "prayer in ~15 min" push if a prayer time is
// imminent and not yet notified today.
//
// Opus Lead review (2026-08-16, Phase H): this function used to also send a
// check-in-slot "Pulse check-in" push. The app-wide check-in scheduler that
// prompt pointed at was removed from the UI on 2026-08-15 (app-shell.tsx
// dropped CheckinSchedulerLoader, replaced by Business-scoped Lock-In
// sessions) — but the backend half of that removal was never done, so this
// function kept dispatching prompts for a feature that no longer existed.
// Confirmed latent, not user-facing: push_subscriptions had zero active
// rows and notification_log had zero rows of any type at the time this was
// found, so nothing was ever actually delivered. Removed the check-in
// branch and its now-unused slot-generation helpers below; prayer
// notifications are unchanged. Lock-In-session push (useful since a
// session keeps running with the tab closed) is a real, separate feature
// idea, not built here — new features don't land at 3am on a deploy night.
//
// Secrets: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected by the
// platform. VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT are NOT —
// there is no MCP-exposed equivalent of `supabase secrets set` for this
// project, so they're stored in Supabase Vault instead (vapid_public_key,
// vapid_private_key, vapid_subject) and fetched at request time via the
// service-role client below. PostgREST doesn't expose the `vault` schema
// directly, so this goes through public.get_vault_secrets(), a
// SECURITY DEFINER RPC restricted to service_role (see migration
// 009_vault_secret_rpc).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// ---------------------------------------------------------------------------
// Duplicated pure prayer-time calculation — see lib/prayer-times/calculate.ts
// in the Next.js app. Edge Functions run on Deno and can't import across that
// runtime boundary from a separate deploy, so this is a deliberate straight
// port, not a rewrite (the algorithm is already debugged/sanity-checked
// there — the Asr-altitude-sign and local/UTC-conversion bugs were fixed in
// the original). Keep any future fixes in sync with that file.
// ---------------------------------------------------------------------------

type CalcMethod = "MWL" | "ISNA" | "Karachi" | "Egyptian";
type AsrMadhab = "standard" | "hanafi";
type PrayerTimes = { fajr: Date; dhuhr: Date; asr: Date; maghrib: Date; isha: Date };

const METHOD_ANGLES: Record<CalcMethod, { fajr: number; isha: number }> = {
  MWL: { fajr: 18, isha: 17 },
  ISNA: { fajr: 15, isha: 15 },
  Karachi: { fajr: 18, isha: 18 },
  Egyptian: { fajr: 19.5, isha: 17.5 },
};
const MAGHRIB_ANGLE = 0.833;

function degToRad(deg: number) {
  return (deg * Math.PI) / 180;
}
function radToDeg(rad: number) {
  return (rad * 180) / Math.PI;
}

function julianDate(year: number, month: number, day: number): number {
  if (month <= 2) {
    year -= 1;
    month += 12;
  }
  const a = Math.floor(year / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + b - 1524.5;
}

function sunPosition(jd: number): { declination: number; equationOfTime: number } {
  const d = jd - 2451545.0;
  const g = degToRad((357.529 + 0.98560028 * d) % 360);
  const q = (280.459 + 0.98564736 * d) % 360;
  const l = degToRad((q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g) + 360) % 360);
  const e = degToRad(23.439 - 0.00000036 * d);
  const declination = Math.asin(Math.sin(e) * Math.sin(l));
  const ra = radToDeg(Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l))) / 15;
  const raNormalized = ((ra % 24) + 24) % 24;
  const qHours = q / 15;
  let equationOfTime = qHours - raNormalized;
  if (equationOfTime > 12) equationOfTime -= 24;
  if (equationOfTime < -12) equationOfTime += 24;
  equationOfTime *= 60;
  return { declination: radToDeg(declination), equationOfTime };
}

function hourAngle(angle: number, lat: number, declination: number): number {
  const latRad = degToRad(lat);
  const declRad = degToRad(declination);
  const cosH =
    (-Math.sin(degToRad(angle)) - Math.sin(latRad) * Math.sin(declRad)) /
    (Math.cos(latRad) * Math.cos(declRad));
  const clamped = Math.max(-1, Math.min(1, cosH));
  return radToDeg(Math.acos(clamped)) / 15;
}

function asrHourAngle(shadowFactor: number, lat: number, declination: number): number {
  const latRad = degToRad(lat);
  const declRad = degToRad(declination);
  const altitude = Math.atan(1 / (shadowFactor + Math.tan(Math.abs(latRad - declRad))));
  return hourAngle(-radToDeg(altitude), lat, declination);
}

function getTimezoneOffsetMinutes(date: Date, timezone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return (asUtc - date.getTime()) / 60_000;
}

function localDateString(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function localClockHoursToDate(date: Date, localClockHours: number, tzHours: number): Date {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const utcHours = localClockHours - tzHours;
  result.setUTCMinutes(result.getUTCMinutes() + Math.round(utcHours * 60));
  return result;
}

function calculatePrayerTimes(opts: {
  date: Date;
  lat: number;
  lng: number;
  timezoneOffsetMinutes: number;
  calcMethod: CalcMethod;
  asrMadhab: AsrMadhab;
}): PrayerTimes {
  const { date, lat, lng, timezoneOffsetMinutes, calcMethod, asrMadhab } = opts;
  const tzHours = timezoneOffsetMinutes / 60;
  const jd = julianDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  const { declination, equationOfTime } = sunPosition(jd - lng / (15 * 24));
  const dhuhrClock = 12 + tzHours - lng / 15 - equationOfTime / 60;
  const angles = METHOD_ANGLES[calcMethod];
  const fajrHA = hourAngle(angles.fajr, lat, declination);
  const ishaHA = hourAngle(angles.isha, lat, declination);
  const maghribHA = hourAngle(MAGHRIB_ANGLE, lat, declination);
  const asrHA = asrHourAngle(asrMadhab === "hanafi" ? 2 : 1, lat, declination);

  return {
    fajr: localClockHoursToDate(date, dhuhrClock - fajrHA, tzHours),
    dhuhr: localClockHoursToDate(date, dhuhrClock, tzHours),
    asr: localClockHoursToDate(date, dhuhrClock + asrHA, tzHours),
    maghrib: localClockHoursToDate(date, dhuhrClock + maghribHA, tzHours),
    isha: localClockHoursToDate(date, dhuhrClock + ishaHA, tzHours),
  };
}

const PRAYER_NAMES = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;
const PRAYER_WINDOW_MS = 15 * 60 * 1000;

Deno.serve(async (_req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: vaultRows, error: vaultError } = await supabase.rpc("get_vault_secrets", {
    secret_names: ["vapid_public_key", "vapid_private_key", "vapid_subject"],
  });

  if (vaultError || !vaultRows) {
    return new Response(
      JSON.stringify({ error: `Failed to read VAPID secrets from Vault: ${vaultError?.message}` }),
      { status: 500 }
    );
  }
  const secrets = new Map(vaultRows.map((r) => [r.name, r.decrypted_secret as string]));
  const vapidPublicKey = secrets.get("vapid_public_key");
  const vapidPrivateKey = secrets.get("vapid_private_key");
  const vapidSubject = secrets.get("vapid_subject");

  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return new Response(
      JSON.stringify({ error: "VAPID secrets missing from Vault" }),
      { status: 500 }
    );
  }
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const now = new Date();

  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("user_id, endpoint, p256dh, auth_key");
  if (!subs || subs.length === 0) {
    return new Response(JSON.stringify({ dispatched: 0, reason: "no subscriptions" }));
  }

  const userIds = [...new Set(subs.map((s) => s.user_id))];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, timezone, location_lat, location_lng, prayer_calc_method, asr_madhab")
    .in("user_id", userIds);

  let dispatched = 0;

  for (const profile of profiles ?? []) {
    const userSubs = subs.filter((s) => s.user_id === profile.user_id);
    const timezone = profile.timezone ?? "UTC";
    const todayStr = localDateString(now, timezone);

    async function sendToUser(title: string, body: string, url: string) {
      for (const sub of userSubs) {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth_key },
            },
            JSON.stringify({ title, body, url })
          );
          dispatched++;
        } catch (err) {
          // A dead/expired subscription (410/404) shouldn't crash the whole
          // run for other users — log and move on. Not proactively deleting
          // stale subscriptions here; out of scope for this task.
          console.log(`push send failed for ${sub.endpoint}: ${err}`);
        }
      }
    }

    async function alreadyNotified(notifType: "prayer", notifKey: string): Promise<boolean> {
      const { data } = await supabase
        .from("notification_log")
        .select("id")
        .eq("user_id", profile.user_id)
        .eq("notif_type", notifType)
        .eq("notif_key", notifKey)
        .eq("sent_date", todayStr)
        .maybeSingle();
      return !!data;
    }

    async function markNotified(notifType: "prayer", notifKey: string) {
      await supabase
        .from("notification_log")
        .insert({ user_id: profile.user_id, notif_type: notifType, notif_key: notifKey, sent_date: todayStr });
    }

    // Prayer time notifications
    if (profile.location_lat != null && profile.location_lng != null) {
      const times = calculatePrayerTimes({
        date: now,
        lat: profile.location_lat,
        lng: profile.location_lng,
        timezoneOffsetMinutes: getTimezoneOffsetMinutes(now, timezone),
        calcMethod: (profile.prayer_calc_method as CalcMethod) || "MWL",
        asrMadhab: (profile.asr_madhab as AsrMadhab) || "standard",
      });

      for (const prayerName of PRAYER_NAMES) {
        const diffMs = times[prayerName].getTime() - now.getTime();
        if (diffMs >= 0 && diffMs <= PRAYER_WINDOW_MS) {
          if (!(await alreadyNotified("prayer", prayerName))) {
            const label = prayerName.charAt(0).toUpperCase() + prayerName.slice(1);
            await sendToUser(`${label} in ~15 min`, "Time to prepare for prayer.", "/deen");
            await markNotified("prayer", prayerName);
          }
        }
      }
    }
  }

  return new Response(JSON.stringify({ dispatched }), {
    headers: { "Content-Type": "application/json" },
  });
});
