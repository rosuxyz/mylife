import { redirect } from "next/navigation";
import { connection } from "next/server";
import { DatabaseError, DatabaseSetup } from "@/components/database-state";
import { SettingsClient } from "@/components/settings-client";
import { getProfileForUser } from "@/lib/supabase/profile";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { isSupabaseSchemaMissing } from "@/lib/supabase/schema-status";

export const instant = false;

export default async function SettingsPage() {
  await connection();
  const { supabase, user } = await getAuthenticatedUser();
  if (!supabase) return <DatabaseSetup />;
  if (!user) redirect("/login");

  const [profileResult, jobsResult] = await Promise.all([
    getProfileForUser(supabase, user, "display_name,currency_code,timezone,week_starts_on,default_payday_weekday,default_break_minutes,default_hourly_rate_minor,default_job_id,theme"),
    supabase.from("jobs").select("id,employer,title").is("archived_at", null).order("employer"),
  ]);
  const failure = jobsResult.error;
  if (failure) {
    console.error("Settings data load failed:", failure.message);
    return <DatabaseError message="Your settings could not be loaded." schemaMissing={isSupabaseSchemaMissing(failure)} />;
  }
  if (!profileResult) return <DatabaseError message="Your profile is missing." />;
  return <SettingsClient email={user.email ?? ""} jobs={jobsResult.data ?? []} profile={profileResult} />;
}
