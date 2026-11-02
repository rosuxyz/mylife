import { redirect } from "next/navigation";
import { connection } from "next/server";
import { DatabaseError, DatabaseSetup } from "@/components/database-state";
import { IncomeClient } from "@/components/income-client";
import { getProfileForUser } from "@/lib/supabase/profile";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { isSupabaseSchemaMissing } from "@/lib/supabase/schema-status";

export const instant = false;

function localDateInTimezone(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export default async function IncomePage() {
  await connection();
  const { supabase, user } = await getAuthenticatedUser();
  if (!supabase) return <DatabaseSetup />;
  if (!user) redirect("/login");

  const [jobsResult, ratesResult, recordsResult, paymentsResult, accountsResult, profileResult] =
    await Promise.all([
      supabase.from("jobs").select("id,employer,title,currency_code").is("archived_at", null).order("employer"),
      supabase.from("hourly_rates").select("id,job_id,hourly_rate_minor,overtime_rate_minor,effective_from,effective_to").order("effective_from", { ascending: false }),
      supabase.from("income_records").select("id,job_id,source,frequency,expected_date,actual_date,status,currency_code,hours_worked_minutes,regular_earnings_minor,overtime_earnings_minor,additional_payments_minor,deductions_minor,gross_minor,net_expected_minor,actual_received_minor,notes").order("expected_date", { ascending: false, nullsFirst: false }).limit(200),
      supabase.from("income_payments").select("id,income_record_id,amount_minor,paid_at,notes").order("paid_at", { ascending: false }).limit(500),
      supabase.from("accounts").select("id,name,currency_code").is("archived_at", null).order("name"),
      getProfileForUser(supabase, user, "currency_code,timezone,default_payday_weekday"),
    ]);

  const failure = jobsResult.error ?? ratesResult.error ?? recordsResult.error
    ?? paymentsResult.error ?? accountsResult.error;
  if (failure) {
    console.error("Income page data load failed:", failure.message);
    return <DatabaseError message="Your income records could not be loaded." schemaMissing={isSupabaseSchemaMissing(failure)} />;
  }
  if (!profileResult) return <DatabaseError message="Your personal profile is missing." />;

  const jobs = jobsResult.data ?? [];
  const records = (recordsResult.data ?? []).map((record) => ({
    ...record,
    job: jobs.find((job) => job.id === record.job_id) ?? null,
  }));
  return (
    <IncomeClient
      accounts={accountsResult.data ?? []}
      jobs={jobs}
      payments={paymentsResult.data ?? []}
      rates={ratesResult.data ?? []}
      records={records}
      currencyCode={profileResult.currency_code ?? "GBP"}
      today={localDateInTimezone(profileResult.timezone ?? "Europe/London")}
      paydayWeekday={profileResult.default_payday_weekday ?? 5}
    />
  );
}
