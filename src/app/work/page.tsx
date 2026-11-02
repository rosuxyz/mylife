import { redirect } from "next/navigation";
import { connection } from "next/server";
import { DatabaseError, DatabaseSetup } from "@/components/database-state";
import { WorkClient } from "@/components/work-client";
import { getProfileForUser } from "@/lib/supabase/profile";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { isSupabaseSchemaMissing } from "@/lib/supabase/schema-status";

export const instant = false;

function localDateInTimezone(timezone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function startOfWeek(date: string, weekStartsOn: number) {
  const current = new Date(`${date}T00:00:00Z`);
  const offset = (current.getUTCDay() - weekStartsOn + 7) % 7;
  current.setUTCDate(current.getUTCDate() - offset);
  return current.toISOString().slice(0, 10);
}

export default async function WorkPage() {
  await connection();
  const { supabase, user } = await getAuthenticatedUser();
  if (!supabase) return <DatabaseSetup />;
  if (!user) redirect("/login");

  const profile = await getProfileForUser(
    supabase,
    user,
    "timezone,week_starts_on,default_break_minutes,default_hourly_rate_minor,currency_code",
  );
  if (!profile) {
    return <DatabaseError message="Your daily work tracker could not load your profile settings." schemaMissing={false} />;
  }

  const timezone = profile.timezone ?? "Europe/London";
  const today = localDateInTimezone(timezone);
  const weekStartsOn = profile.week_starts_on ?? 1;
  const weekStart = startOfWeek(today, weekStartsOn);
  const monthStart = `${today.slice(0, 7)}-01`;
  const yearStart = `${today.slice(0, 4)}-01-01`;

  const [jobsResult, ratesResult] = await Promise.all([
    supabase
      .from("jobs")
      .select("id,employer,title,archived_at,currency_code")
      .order("employer"),
    supabase
      .from("hourly_rates")
      .select("job_id,hourly_rate_minor,effective_from,effective_to")
      .order("effective_from", { ascending: false }),
  ]);
  const profileFailure = jobsResult.error ?? ratesResult.error;
  if (profileFailure) {
    console.error("Work Job Profiles load failed:", profileFailure.message);
    return <DatabaseError message="Your Job Profiles could not be loaded." schemaMissing={isSupabaseSchemaMissing(profileFailure)} />;
  }
  const jobs = (jobsResult.data ?? []).map((job) => {
    const currentRate = (ratesResult.data ?? []).find((rate) => (
      rate.job_id === job.id
      && rate.effective_from <= today
      && (!rate.effective_to || rate.effective_to >= today)
    ));
    return {
      id: job.id,
      employer: job.employer,
      title: job.title,
      currency_code: job.currency_code,
      is_active: job.archived_at === null,
      hourly_rate_minor: currentRate ? Number(currentRate.hourly_rate_minor) : null,
    };
  });

  const entries: {
    id: string;
    work_date: string;
    hours_worked: number;
    currency_code: string;
    job_id: string | null;
    employer_snapshot: string;
    start_time: string | null;
    end_time: string | null;
    break_minutes: number | null;
    net_working_minutes: number | null;
    hourly_rate_snapshot_minor: number | null;
    calculated_earnings_minor: number | null;
    created_at: string;
    updated_at: string;
  }[] = [];
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    const result = await supabase
      .from("daily_work_hours")
      .select("id, work_date, hours_worked, currency_code, job_id, employer_snapshot, start_time, end_time, break_minutes, net_working_minutes, hourly_rate_snapshot_minor, calculated_earnings_minor, created_at, updated_at")
      .eq("user_id", user.id)
      .order("work_date", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (result.error) {
      console.error("Daily work hours data load failed:", result.error.message);
      return <DatabaseError message="Your work history could not be loaded." schemaMissing={isSupabaseSchemaMissing(result.error)} />;
    }
    const page = result.data ?? [];
    entries.push(...page.map((entry) => ({
      ...entry,
      hours_worked: Number(entry.hours_worked),
      break_minutes: entry.break_minutes === null ? null : Number(entry.break_minutes),
      net_working_minutes: entry.net_working_minutes === null ? null : Number(entry.net_working_minutes),
      hourly_rate_snapshot_minor: entry.hourly_rate_snapshot_minor === null ? null : Number(entry.hourly_rate_snapshot_minor),
      calculated_earnings_minor: entry.calculated_earnings_minor === null ? null : Number(entry.calculated_earnings_minor),
    })));
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  const list = entries.map((entry) => ({
    id: entry.id,
    work_date: entry.work_date,
    hours_worked: entry.hours_worked,
    currency_code: entry.currency_code,
    job_id: entry.job_id,
    employer_snapshot: entry.employer_snapshot,
    start_time: entry.start_time,
    end_time: entry.end_time,
    break_minutes: entry.break_minutes,
    net_working_minutes: entry.net_working_minutes,
    hourly_rate_snapshot_minor: entry.hourly_rate_snapshot_minor,
    calculated_earnings_minor: entry.calculated_earnings_minor,
    created_at: entry.created_at,
    updated_at: entry.updated_at,
  }));

  const entryHours = (entry: (typeof list)[number]) => (
    entry.net_working_minutes === null
      ? entry.hours_worked
      : entry.net_working_minutes / 60
  );
  const totalHours = (value: string) => list
    .filter((entry) => entry.work_date >= value)
    .reduce((sum, entry) => sum + entryHours(entry), 0);

  return (
    <WorkClient
      entries={list}
      jobs={jobs}
      totals={{
        week: totalHours(weekStart),
        month: totalHours(monthStart),
        year: totalHours(yearStart),
      }}
      today={today}
      weekStartsOn={weekStartsOn}
      defaultBreakMinutes={profile.default_break_minutes ?? 0}
      defaultHourlyRateMinor={Number(profile.default_hourly_rate_minor ?? 0)}
      currencyCode={profile.currency_code ?? "GBP"}
      timezone={timezone}
    />
  );
}
