import { fromZonedTime } from "date-fns-tz";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ConnectedDashboard } from "@/components/connected-dashboard";
import { DatabaseError, DatabaseSetup } from "@/components/database-state";
import { getProfileForUser } from "@/lib/supabase/profile";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { isSupabaseSchemaMissing } from "@/lib/supabase/schema-status";

export const instant = false;

function localDate(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function startOfWeek(date: string, weekStartsOn: number) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - ((parsed.getUTCDay() - weekStartsOn + 7) % 7));
  return parsed.toISOString().slice(0, 10);
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export default async function Home() {
  await connection();
  const { supabase, user } = await getAuthenticatedUser();
  if (!supabase) return <DatabaseSetup />;
  if (!user) redirect("/login");

  const profile = await getProfileForUser(supabase, user, "timezone,week_starts_on,currency_code");
  if (!profile) {
    return <DatabaseError message="Your overview could not load your profile settings." schemaMissing={false} />;
  }

  const timezone = profile.timezone ?? "Europe/London";
  const asOf = new Date();
  const today = localDate(asOf, timezone);
  const monthStart = `${today.slice(0, 7)}-01`;
  const firstMonth = new Date(`${monthStart}T12:00:00Z`);
  firstMonth.setUTCMonth(firstMonth.getUTCMonth() - 11);
  const trendFrom = `${firstMonth.toISOString().slice(0, 7)}-01`;
  const weekStart = startOfWeek(today, profile.week_starts_on ?? 1);
  const workFrom = shiftDate(startOfWeek(today, profile.week_starts_on ?? 1), -7 * 11);

  const [accountsResult, transactionsResult, financialResult, workResult] = await Promise.all([
    supabase.from("account_balances").select("account_id,name,account_type,currency_code,balance_minor").order("name"),
    supabase.from("transactions").select("id,kind,description,amount_minor,currency_code,occurred_at,account_id,from_account_id,to_account_id").order("occurred_at", { ascending: false }).limit(8),
    supabase.rpc("get_financial_analytics", {
      p_from: trendFrom,
      p_to: today,
      p_granularity: "month",
    }),
    supabase.from("daily_work_hours").select("work_date,hours_worked").gte("work_date", workFrom).lte("work_date", today).order("work_date"),
  ]);
  const failure = accountsResult.error ?? transactionsResult.error ?? financialResult.error ?? workResult.error;
  if (failure) {
    console.error("Overview data load failed:", failure.message);
    return <DatabaseError message="Your overview data could not be loaded." schemaMissing={isSupabaseSchemaMissing(failure)} />;
  }

  const trendTransactions: {
    kind: "income" | "expense" | "transfer";
    amount_minor: number;
    currency_code: string;
    occurred_at: string;
    account_id: string | null;
    from_account_id: string | null;
    to_account_id: string | null;
  }[] = [];
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    const result = await supabase
      .from("transactions")
      .select("kind,amount_minor,currency_code,occurred_at,account_id,from_account_id,to_account_id")
      .gte("occurred_at", fromZonedTime(`${trendFrom}T00:00:00`, timezone).toISOString())
      .order("occurred_at", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (result.error) {
      console.error("Overview balance history load failed:", result.error.message);
      return <DatabaseError message="Your balance history could not be loaded." schemaMissing={isSupabaseSchemaMissing(result.error)} />;
    }
    const rows = result.data ?? [];
    trendTransactions.push(...rows.map((row) => ({
      ...row,
      amount_minor: Number(row.amount_minor),
    })));
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  const work = (workResult.data ?? []).map((entry) => ({
    work_date: entry.work_date,
    hours_worked: Number(entry.hours_worked),
  }));
  const totalHoursSince = (date: string) => work
    .filter((entry) => entry.work_date >= date)
    .reduce((sum, entry) => sum + entry.hours_worked, 0);
  return (
    <ConnectedDashboard
      accounts={(accountsResult.data ?? []).map((account) => ({
        id: account.account_id,
        name: account.name,
        account_type: account.account_type,
        currency_code: account.currency_code,
        balance_minor: Number(account.balance_minor),
      }))}
      currencyCode={profile.currency_code ?? "GBP"}
      asOf={asOf.toISOString()}
      financial={(financialResult.data ?? []).map((item: {
        period_start: string;
        kind: "income" | "expense";
        currency_code: string;
        amount_minor: number | string;
      }) => ({
        ...item,
        amount_minor: Number(item.amount_minor),
      }))}
      from={trendFrom}
      monthHours={totalHoursSince(monthStart)}
      monthStart={monthStart}
      recentTransactions={(transactionsResult.data ?? []).map((transaction) => ({
        ...transaction,
        amount_minor: Number(transaction.amount_minor),
      }))}
      timezone={timezone}
      to={today}
      trendTransactions={trendTransactions}
      weekHours={totalHoursSince(weekStart)}
      work={work}
      workFrom={workFrom}
      weekStartsOn={profile.week_starts_on ?? 1}
    />
  );
}
