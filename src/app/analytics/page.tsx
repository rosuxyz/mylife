import { redirect } from "next/navigation";
import { connection } from "next/server";
import { DatabaseError, DatabaseSetup } from "@/components/database-state";
import { AnalyticsClient } from "@/components/analytics-client";
import { getProfileForUser } from "@/lib/supabase/profile";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { isSupabaseSchemaMissing } from "@/lib/supabase/schema-status";

export const instant = false;

type Props = { searchParams: Promise<{ range?: string; from?: string; to?: string }> };
const ranges = ["weekly", "monthly", "quarterly", "yearly", "custom"] as const;
type Range = (typeof ranges)[number];
type Granularity = "week" | "month" | "quarter" | "year";

function localDate(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function startOfWeek(value: string, weekStartsOn: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() - weekStartsOn + 7) % 7));
  return date.toISOString().slice(0, 10);
}

function dateRange(range: Range, from: string | undefined, to: string | undefined, today: string, weekStartsOn: number) {
  let granularity: Granularity;
  if (range === "weekly") {
    granularity = "week";
    return { from: shiftDate(startOfWeek(today, weekStartsOn), -77), to: today, granularity };
  }
  if (range === "quarterly") {
    granularity = "quarter";
    const end = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
    end.setUTCMonth(Math.floor(end.getUTCMonth() / 3) * 3);
    end.setUTCMonth(end.getUTCMonth() - 21);
    return { from: `${end.toISOString().slice(0, 7)}-01`, to: today, granularity };
  }
  if (range === "yearly") {
    granularity = "year";
    return { from: `${Number(today.slice(0, 4)) - 4}-01-01`, to: today, granularity };
  }
  granularity = "month";
  if (range === "custom" && from && to
    && /^\d{4}-\d{2}-\d{2}$/.test(from)
    && /^\d{4}-\d{2}-\d{2}$/.test(to)
    && from <= to
    && new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime() <= 3660 * 86_400_000) {
    return { from, to, granularity };
  }
  const start = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() - 11);
  return { from: `${start.toISOString().slice(0, 7)}-01`, to: today, granularity };
}

export default async function AnalyticsPage({ searchParams }: Props) {
  await connection();
  const { supabase, user } = await getAuthenticatedUser();
  if (!supabase) return <DatabaseSetup />;
  if (!user) redirect("/login");

  const params = await searchParams;
  const range = ranges.includes(params.range as Range) ? params.range as Range : "monthly";
  const profile = await getProfileForUser(supabase, user, "currency_code,timezone,week_starts_on");
  if (!profile) return <DatabaseError message="Your profile is missing." />;
  const currencyCode = profile.currency_code ?? "GBP";
  const timezone = profile.timezone ?? "Europe/London";
  const weekStartsOn = profile.week_starts_on ?? 1;
  const { from, to, granularity } = dateRange(range, params.from, params.to, localDate(timezone), weekStartsOn);

  const loadWork = async () => {
    const entries: { work_date: string; hours_worked: number }[] = [];
    const pageSize = 1000;
    let offset = 0;
    while (true) {
      const result = await supabase
        .from("daily_work_hours")
        .select("work_date,hours_worked")
        .eq("user_id", user.id)
        .gte("work_date", from)
        .lte("work_date", to)
        .order("work_date")
        .range(offset, offset + pageSize - 1);
      if (result.error) return { data: null, error: result.error };
      const page = result.data ?? [];
      entries.push(...page.map((item) => ({
        work_date: item.work_date,
        hours_worked: Number(item.hours_worked),
      })));
      if (page.length < pageSize) return { data: entries, error: null };
      offset += pageSize;
    }
  };

  const [financeResult, workResult, categoriesResult] = await Promise.all([
    supabase.rpc("get_financial_analytics", {
      p_from: from,
      p_to: to,
      p_granularity: granularity,
    }),
    loadWork(),
    supabase.from("categories").select("id,name,color"),
  ]);
  const failure = financeResult.error ?? workResult.error ?? categoriesResult.error;
  if (failure) {
    console.error("Analytics query failed:", failure.message);
    return <DatabaseError message="Analytics could not be calculated." schemaMissing={isSupabaseSchemaMissing(failure)} />;
  }

  const categories = (categoriesResult.data ?? []) as { id: string; name: string; color: string }[];
  const categoryNames = Object.fromEntries(categories.map((item) => [item.id, item.name]));
  const categoryColors = Object.fromEntries(categories.map((item) => [item.id, item.color]));
  return (
    <AnalyticsClient
      categoryColors={categoryColors}
      categoryNames={categoryNames}
      currencyCode={currencyCode}
      financial={(financeResult.data ?? []).map((item: {
        period_start: string;
        kind: "income" | "expense";
        category_id: string | null;
        currency_code: string;
        amount_minor: number | string;
      }) => ({
        ...item,
        amount_minor: Number(item.amount_minor),
      }))}
      from={from}
      range={range}
      to={to}
      weekStartsOn={weekStartsOn}
      work={workResult.data ?? []}
    />
  );
}
