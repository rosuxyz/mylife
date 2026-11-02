import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseSchemaMissing } from "@/lib/supabase/schema-status";

export type UserProfile = {
  id: string;
  display_name: string;
  currency_code: string;
  timezone: string;
  week_starts_on: number;
  default_payday_weekday: number;
  default_break_minutes: number;
  default_hourly_rate_minor: number;
  default_job_id: string | null;
  theme: "dark" | "light" | "system";
};

type ProfileUser = {
  id: string;
  user_metadata?: { display_name?: string | null } | null;
  email?: string | null;
};

export async function getProfileForUser(
  supabase: SupabaseClient,
  user: ProfileUser,
  select = "id,display_name,currency_code,timezone,week_starts_on,theme",
): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(select)
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    if (!isSupabaseSchemaMissing(error)) {
      console.error("Profile lookup failed:", error.message);
    }
    return null;
  }

  if (data) return data as unknown as UserProfile;

  const fallbackDisplayName =
    typeof user.user_metadata?.display_name === "string" && user.user_metadata.display_name.trim().length > 0
      ? user.user_metadata.display_name.trim()
      : (typeof user.email === "string" && user.email.includes("@") ? user.email.split("@")[0] : "");

  const { data: created, error: insertError } = await supabase
    .from("profiles")
    .upsert({
      id: user.id,
      display_name: fallbackDisplayName,
      currency_code: "GBP",
      timezone: "Europe/London",
      week_starts_on: 1,
      default_payday_weekday: 5,
      default_break_minutes: 15,
      default_hourly_rate_minor: 0,
      default_job_id: null,
      theme: "dark",
    }, { onConflict: "id" })
    .select(select)
    .maybeSingle();

  if (insertError) {
    console.error("Profile bootstrap failed:", insertError.message);
    return null;
  }

  return created as unknown as UserProfile | null;
}
