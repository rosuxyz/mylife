"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getActionUser } from "@/lib/supabase/action-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SettingsActionState = { error?: string; success?: string; theme?: "dark" | "light" | "system" };
const themeSchema = z.enum(["dark", "light", "system"]);

export async function updateThemePreference(theme: "dark" | "light" | "system") {
  const parsed = themeSchema.safeParse(theme);
  if (!parsed.success) return { error: "Choose a valid theme." };
  const auth = await getActionUser();
  if ("error" in auth) return { error: auth.error };
  const { error } = await auth.client.from("profiles").update({ theme: parsed.data }).eq("id", auth.userId);
  if (error) {
    console.error("Theme preference update failed:", error.message);
    return { error: "Your theme could not be saved to your profile." };
  }
  revalidatePath("/", "layout");
  return {};
}

const settingsSchema = z.object({
  displayName: z.string().trim().max(100),
  currencyCode: z.enum(["GBP", "USD", "EUR", "CAD", "AUD", "NZD", "INR"]),
  timezone: z.string().trim().min(1).max(100),
  weekStartsOn: z.coerce.number().int().min(0).max(6),
  paydayWeekday: z.coerce.number().int().min(0).max(6),
  defaultBreakMinutes: z.coerce.number().int().min(0).max(1440),
  defaultHourlyRate: z.string().trim().regex(/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/),
  defaultJobId: z.string().uuid().or(z.literal("")),
  theme: z.enum(["dark", "light", "system"]),
});

export async function updateSettings(
  _previousState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const parsed = settingsSchema.safeParse({
    displayName: formData.get("displayName"),
    currencyCode: formData.get("currencyCode"),
    timezone: formData.get("timezone"),
    weekStartsOn: formData.get("weekStartsOn"),
    paydayWeekday: formData.get("paydayWeekday"),
    defaultBreakMinutes: formData.get("defaultBreakMinutes"),
    defaultHourlyRate: formData.get("defaultHourlyRate"),
    defaultJobId: formData.get("defaultJobId") ?? "",
    theme: formData.get("theme"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check your settings." };

  const [rateWhole, rateFraction = ""] = parsed.data.defaultHourlyRate.split(".");
  const defaultHourlyRateMinor = Number(rateWhole) * 100 + Number(rateFraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(defaultHourlyRateMinor) || defaultHourlyRateMinor > 100000000) {
    return { error: "Enter a default hourly rate up to £1,000,000.00." };
  }

  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: parsed.data.timezone }).format(new Date(0));
  } catch (error) {
    if (error instanceof RangeError) return { error: "Enter a valid IANA timezone, such as Europe/London." };
    throw error;
  }

  const auth = await getActionUser();
  if ("error" in auth) return { error: auth.error };
  const { error } = await auth.client.from("profiles").update({
    display_name: parsed.data.displayName,
    currency_code: parsed.data.currencyCode,
    timezone: parsed.data.timezone,
    week_starts_on: parsed.data.weekStartsOn,
    default_payday_weekday: parsed.data.paydayWeekday,
    default_break_minutes: parsed.data.defaultBreakMinutes,
    default_hourly_rate_minor: defaultHourlyRateMinor,
    default_job_id: parsed.data.defaultJobId || null,
    theme: parsed.data.theme,
  }).eq("id", auth.userId);
  if (error) {
    console.error("Profile settings update failed:", error.message);
    return { error: "Settings could not be saved. Check that the latest migrations are applied." };
  }
  revalidatePath("/", "layout");
  return { success: "Settings saved.", theme: parsed.data.theme };
}

export async function deleteAccount(
  _previousState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  if (formData.get("confirmation") !== "DELETE") {
    return { error: 'Type "DELETE" to confirm permanent account deletion.' };
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "Connect Supabase before deleting an account." };
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { error: "Sign in again before deleting your account." };
  const { error } = await supabase.rpc("delete_my_account");
  if (error) {
    console.error("Account deletion failed:", error.message);
    return { error: "The account could not be deleted. Export your backup and try again." };
  }
  const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
  if (signOutError) {
    console.error("Session cleanup after account deletion failed:", signOutError.message);
  }
  redirect("/login?deleted=1");
}
