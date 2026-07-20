// Weekly auto-spawner for multiplier events.
// Idempotent: skips if an active event already exists in the upcoming 7 days.
// Picks a random weekday (Mon-Fri) + random 12:00-17:00 Bangkok hour,
// 1-hour duration, 2× multiplier. 50% chance to add a 30-min 1.5× midweek boost.
//
// Schedule via Supabase scheduled functions dashboard OR pg_cron + pg_net:
//   SELECT cron.schedule(
//     'spawn-multiplier-weekly',
//     '0 6 * * 1',   -- Monday 06:00 UTC = 13:00 Bangkok
//     $$SELECT net.http_post(
//       url := 'https://<project>.functions.supabase.co/spawn-weekly-multiplier',
//       headers := jsonb_build_object('Content-Type','application/json'),
//       body := '{}'::jsonb
//     )$$
//   );
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl ?? "", serviceRoleKey ?? "", {
  auth: { persistSession: false },
});

/** Shift a Date to Bangkok wall-clock (UTC+7) for "what day/hour is it locally". */
function bangkokDate(d: Date): Date {
  return new Date(d.getTime() + 7 * 60 * 60 * 1000);
}

/** Pick a random weekday in the next 7 days (Mon-Fri), random 12-17 Bangkok hour. */
function pickWeeklySlot(now: Date): { startsAt: Date; endsAt: Date } {
  const bkNow = bangkokDate(now);
  for (let attempt = 0; attempt < 20; attempt++) {
    const offset = 1 + Math.floor(Math.random() * 7);
    const candidate = new Date(bkNow);
    candidate.setDate(candidate.getDate() + offset);
    const bkDay = candidate.getUTCDay(); // 0=Sun, 6=Sat (we're in bk wall-clock)
    if (bkDay === 0 || bkDay === 6) continue;
    const hour = 12 + Math.floor(Math.random() * 5); // 12..16
    candidate.setUTCHours(hour, 0, 0, 0);
    const endsAt = new Date(candidate.getTime() + 60 * 60 * 1000); // +1h
    return { startsAt: candidate, endsAt };
  }
  // Fallback: 3 days from now at 13:00 BK
  const fallback = new Date(bkNow);
  fallback.setDate(fallback.getDate() + 3);
  fallback.setUTCHours(13, 0, 0, 0);
  return { startsAt: fallback, endsAt: new Date(fallback.getTime() + 60 * 60 * 1000) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const now = new Date();
    const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Skip if any active event is already scheduled in the next 7 days
    const { data: existing } = await supabase
      .from("multiplier_events")
      .select("id")
      .eq("is_active", true)
      .gte("starts_at", now.toISOString())
      .lte("starts_at", weekAhead.toISOString());

    if (existing && existing.length > 0) {
      return new Response(
        JSON.stringify({ skipped: "event already scheduled", count: existing.length }),
        { headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const { startsAt, endsAt } = pickWeeklySlot(now);
    const inserts: Array<{
      label: string;
      multiplier: string;
      starts_at: string;
      ends_at: string;
      scope: string;
      is_active: boolean;
    }> = [
      {
        label: "ชั่วโมงพิเศษ!",
        multiplier: "2.00",
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        scope: "global",
        is_active: true,
      },
    ];

    // 50% chance: add a 30-min 1.5× midweek boost
    if (Math.random() < 0.5) {
      const midStart = new Date(startsAt.getTime() + 3 * 24 * 60 * 60 * 1000);
      const midEnd = new Date(midStart.getTime() + 30 * 60 * 1000);
      inserts.push({
        label: "ฮอต 30 นาที!",
        multiplier: "1.50",
        starts_at: midStart.toISOString(),
        ends_at: midEnd.toISOString(),
        scope: "global",
        is_active: true,
      });
    }

    const { error } = await supabase.from("multiplier_events").insert(inserts);
    if (error) throw error;

    return new Response(
      JSON.stringify({
        spawned: true,
        events: inserts.map((i) => ({
          label: i.label,
          starts_at: i.starts_at,
          multiplier: i.multiplier,
        })),
      }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
