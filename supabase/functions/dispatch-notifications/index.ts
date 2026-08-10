// Scheduled every 15 minutes via pg_cron. For each user with an active push
// subscription: sends a "prayer in ~15 min" push if a prayer time is
// imminent and not yet notified today, and sends the check-in prompt push
// if a fixed check-in slot is starting now, per spec.
//
// Secrets required (set via `supabase secrets set`, NOT read from the
// Next.js app's .env.local — Edge Functions have their own secret store):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected by the platform.

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

// ---------------------------------------------------------------------------
// Duplicated pure check-in slot generation — see
// lib/checkins/compute-checkin-slots.ts. Simplified for this poll-based
// context: we only need "is a slot starting within this poll window", not
// the full due/missed grace-period evaluation (that's the client
// scheduler's job, Task 10.3) — this just needs to know whether to push.
// ---------------------------------------------------------------------------

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function resolveLocalTime(dateStr: string, timeStr: string, timezone: string): Date {
  const [h, m] = timeStr.split(":").map(Number);
  const naiveUtc = new Date(`${dateStr}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  const offsetMinutes = getTimezoneOffsetMinutes(naiveUtc, timezone);
  return new Date(naiveUtc.getTime() - offsetMinutes * 60_000);
}

function getCheckinSlotsForToday(
  windowStart: string,
  windowEnd: string,
  intervalMinutes: number,
  now: Date,
  timezone: string
): Date[] {
  const dateStr = localDateString(now, timezone);
  const startMin = toMinutes(windowStart);
  const endMin = toMinutes(windowEnd);
  const slots: Date[] = [];
  for (let t = startMin; t <= endMin; t += intervalMinutes) {
    const hh = String(Math.floor(t / 60)).padStart(2, "0");
    const mm = String(t % 60).padStart(2, "0");
    slots.push(resolveLocalTime(dateStr, `${hh}:${mm}`, timezone));
  }
  return slots;
}

// ---------------------------------------------------------------------------

const PRAYER_NAMES = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;
const PRAYER_WINDOW_MS = 15 * 60 * 1000;
const POLL_TOLERANCE_MS = 7.5 * 60 * 1000; // half the 15-min poll interval

Deno.serve(async (_req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");

  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return new Response(
      JSON.stringify({ error: "VAPID secrets not configured on this Edge Function" }),
      { status: 500 }
    );
  }
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
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
    .select(
      "user_id, timezone, location_lat, location_lng, prayer_calc_method, asr_madhab, checkin_window_start, checkin_window_end, checkin_interval_minutes, paused_date"
    )
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

    async function alreadyNotified(notifType: "prayer" | "checkin", notifKey: string): Promise<boolean> {
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

    async function markNotified(notifType: "prayer" | "checkin", notifKey: string) {
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

    // Check-in slot notifications — skip entirely if paused for today.
    if (profile.paused_date !== todayStr) {
      const slots = getCheckinSlotsForToday(
        profile.checkin_window_start?.slice(0, 5) ?? "08:00",
        profile.checkin_window_end?.slice(0, 5) ?? "22:00",
        profile.checkin_interval_minutes ?? 120,
        now,
        timezone
      );
      for (const slot of slots) {
        if (Math.abs(slot.getTime() - now.getTime()) <= POLL_TOLERANCE_MS) {
          const slotKey = `checkin-${slot.toISOString()}`;
          if (!(await alreadyNotified("checkin", slotKey))) {
            await sendToUser(
              "Pulse check-in",
              "What'd you spend the last stretch on?",
              "/"
            );
            await markNotified("checkin", slotKey);
          }
        }
      }
    }
  }

  return new Response(JSON.stringify({ dispatched }), {
    headers: { "Content-Type": "application/json" },
  });
});
