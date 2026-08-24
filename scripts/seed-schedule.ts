/**
 * Seeds one person's real class/work timetable into schedule_events. A
 * SCRIPT, not a migration — this is Ayman's own schedule, not application
 * schema, and it must never run against an account by default; it always
 * takes an explicit email. docs/superpowers/specs/2026-08-23-schedule-calendar.md §2.
 *
 * Idempotent on (user_id, title, day_of_week) — schedule_events has no DB
 * unique constraint on that combination (each recurring day is its own row,
 * same convention app/(app)/school/actions.ts's addScheduleEvent already
 * uses), so idempotency is enforced here at the application level: find the
 * existing row for this exact triple and update it, or insert a new one.
 * Running this twice must not duplicate rows.
 *
 * Usage: npx tsx scripts/seed-schedule.ts <email>
 * Run for BOTH the SEED account and ayman.0704m@gmail.com — his rows are
 * explicitly preserved by the overnight data wipe (item 6 of the
 * requirements doc; schedule_events is configuration, not activity).
 */
import { config } from "dotenv";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types";

config({ path: path.resolve(__dirname, "../.env.local") });

type ClassSeed = {
  title: string;
  location: string;
  instructor: string;
  days: number[]; // 0=Sun .. 6=Sat
  start: string; // HH:MM
  end: string; // HH:MM
};

// Ayman's class schedule, transcribed from his screenshot — see the
// REQUIREMENTS doc for the source table.
const CLASSES: ClassSeed[] = [
  { title: "CS-3341-HON", location: "ECSN 2.120", instructor: "Nicholas Robert Ruozzi", days: [1, 3], start: "08:30", end: "09:45" },
  { title: "CS-3345-HON", location: "FO 2.404", instructor: "Andrew Schmidt Nemec", days: [2, 4], start: "10:00", end: "11:15" },
  { title: "PHYS-2326-002", location: "SCI 1.220", instructor: "Mengke Liu", days: [2, 4], start: "13:00", end: "14:15" },
  { title: "PHYS-2126-105", location: "SCI 1.169", instructor: "Lamya Saleh, Paul J. Macalevey", days: [3], start: "13:00", end: "15:45" },
  { title: "AMS-2341-HN1", location: "AD 2.238", instructor: "Erin Smith", days: [2, 4], start: "16:00", end: "17:15" },
];

// title "Work", domain co_op — day_of_week: 1=Mon, 3=Wed, 5=Fri.
const WORK: { day: number; start: string; end: string }[] = [
  { day: 1, start: "10:30", end: "17:30" },
  { day: 3, start: "16:30", end: "18:00" },
  { day: 5, start: "07:30", end: "17:30" },
];

/** Real conflict check across both lists — a class and a work shift on the same day whose time ranges overlap is a data-entry bug, not a real possibility per the spec. */
function assertNoConflicts() {
  const byDay = new Map<number, { title: string; start: string; end: string }[]>();
  for (const c of CLASSES) {
    for (const day of c.days) {
      const list = byDay.get(day) ?? [];
      list.push({ title: c.title, start: c.start, end: c.end });
      byDay.set(day, list);
    }
  }
  for (const w of WORK) {
    const list = byDay.get(w.day) ?? [];
    list.push({ title: "Work", start: w.start, end: w.end });
    byDay.set(w.day, list);
  }
  for (const [day, events] of byDay) {
    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        const a = events[i];
        const b = events[j];
        const overlaps = a.start < b.end && b.start < a.end;
        if (overlaps) {
          throw new Error(
            `Conflict on day ${day}: "${a.title}" (${a.start}-${a.end}) overlaps "${b.title}" (${b.start}-${b.end})`
          );
        }
      }
    }
  }
}

type Row = {
  id: string;
  title: string;
  domain: string;
  day_of_week: number | null;
};

async function upsertRow(
  supabase: ReturnType<typeof createClient<Database>>,
  userId: string,
  existing: Row[],
  row: {
    title: string;
    domain: "school" | "co_op";
    day_of_week: number;
    event_time: string;
    end_time: string;
    location: string | null;
    instructor: string | null;
  }
): Promise<"inserted" | "updated"> {
  const match = existing.find((e) => e.title === row.title && e.day_of_week === row.day_of_week);
  if (match) {
    const { error } = await supabase
      .from("schedule_events")
      .update({
        domain: row.domain,
        is_recurring: true,
        event_time: row.event_time,
        end_time: row.end_time,
        location: row.location,
        instructor: row.instructor,
        cancelled_on: null,
      })
      .eq("id", match.id)
      .eq("user_id", userId);
    if (error) throw error;
    return "updated";
  }
  const { error } = await supabase.from("schedule_events").insert({
    user_id: userId,
    title: row.title,
    domain: row.domain,
    is_recurring: true,
    day_of_week: row.day_of_week,
    event_time: row.event_time,
    end_time: row.end_time,
    location: row.location,
    instructor: row.instructor,
  });
  if (error) throw error;
  return "inserted";
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: npx tsx scripts/seed-schedule.ts <email>");
    process.exit(1);
  }

  assertNoConflicts();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.local)");
    process.exit(1);
  }
  const supabase = createClient<Database>(url, serviceRoleKey);

  // listUsers, not a public.profiles lookup by email — auth.users is the
  // only place email lives; profiles is keyed by user_id with no email
  // column of its own.
  const { data: usersPage, error: usersError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) throw usersError;
  const user = usersPage.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    console.error(`No user found for ${email}`);
    process.exit(1);
  }
  const userId = user.id;

  const { data: existingRows, error: existingError } = await supabase
    .from("schedule_events")
    .select("id, title, domain, day_of_week")
    .eq("user_id", userId)
    .in("domain", ["school", "co_op"])
    .eq("is_recurring", true);
  if (existingError) throw existingError;
  const existing = (existingRows ?? []) as Row[];

  let inserted = 0;
  let updated = 0;

  for (const c of CLASSES) {
    for (const day of c.days) {
      const result = await upsertRow(supabase, userId, existing, {
        title: c.title,
        domain: "school",
        day_of_week: day,
        event_time: c.start,
        end_time: c.end,
        location: c.location,
        instructor: c.instructor,
      });
      if (result === "inserted") inserted++;
      else updated++;
    }
  }

  for (const w of WORK) {
    const result = await upsertRow(supabase, userId, existing, {
      title: "Work",
      domain: "co_op",
      day_of_week: w.day,
      event_time: w.start,
      end_time: w.end,
      location: null,
      instructor: null,
    });
    if (result === "inserted") inserted++;
    else updated++;
  }

  console.log(`${email}: ${inserted} inserted, ${updated} updated.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
