"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActionUser } from "@/lib/supabase/action-user";
import { formatMinorUnits, moneyInputSchema } from "@/lib/money";

export type WorkActionState = { error?: string; success?: string };

const dailyWorkRecordSchema = z.object({
  entryId: z.string().uuid().or(z.literal("")),
  jobId: z.string().uuid().or(z.literal("")),
  workDate: z.string().date(),
  employerSnapshot: z.string().trim().max(120),
  startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  breakMinutes: z.string().regex(/^(?:0|[1-9]\d{0,3})$/),
  rateOverride: z.string().trim().max(14),
});

function refreshWorkViews() {
  revalidatePath("/work");
  revalidatePath("/finance");
  revalidatePath("/income");
  revalidatePath("/");
  revalidatePath("/analytics");
}

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

export async function saveDailyWorkRecord(
  _previousState: WorkActionState,
  formData: FormData,
): Promise<WorkActionState> {
  const parsed = dailyWorkRecordSchema.safeParse({
    entryId: String(formData.get("entryId") ?? ""),
    jobId: String(formData.get("jobId") ?? ""),
    workDate: formData.get("workDate"),
    employerSnapshot: formData.get("employerSnapshot") ?? "",
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    breakMinutes: formData.get("breakMinutes"),
    rateOverride: formData.get("rateOverride") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the work times and break." };
  }

  const auth = await getActionUser();
  if ("error" in auth) return { error: auth.error };

  const today = localDateInTimezone(auth.timezone);
  const workDate = parsed.data.entryId ? parsed.data.workDate : today;
  if (workDate > today) return { error: "A work record cannot be dated in the future." };

  let existingRecord: {
    id: string;
    job_id: string | null;
    employer_snapshot: string;
    hourly_rate_snapshot_minor: number | null;
    currency_code: string;
    post_earnings_to_finance: boolean;
  } | null = null;
  if (parsed.data.entryId) {
    const { data, error } = await auth.client
      .from("daily_work_hours")
      .select("id,job_id,employer_snapshot,hourly_rate_snapshot_minor,currency_code,post_earnings_to_finance")
      .eq("id", parsed.data.entryId)
      .eq("user_id", auth.userId)
      .maybeSingle();
    if (error) {
      console.error("Daily work record lookup failed:", error.message);
      return { error: "The work record could not be loaded for editing." };
    }
    if (!data) return { error: "This work record no longer exists." };
    existingRecord = {
      id: data.id,
      job_id: data.job_id,
      employer_snapshot: data.employer_snapshot,
      hourly_rate_snapshot_minor: data.hourly_rate_snapshot_minor === null
        ? null
        : Number(data.hourly_rate_snapshot_minor),
      currency_code: data.currency_code,
      post_earnings_to_finance: data.post_earnings_to_finance,
    };
  }

  const startMinute = Number(parsed.data.startTime.slice(0, 2)) * 60 + Number(parsed.data.startTime.slice(3, 5));
  const endMinute = Number(parsed.data.endTime.slice(0, 2)) * 60 + Number(parsed.data.endTime.slice(3, 5));
  let elapsedMinutes = endMinute - startMinute;
  if (elapsedMinutes < 0) elapsedMinutes += 1440;
  if (elapsedMinutes === 0) return { error: "Start and finish times must be different." };

  const breakMinutes = Number(parsed.data.breakMinutes);
  if (!Number.isSafeInteger(breakMinutes) || breakMinutes > elapsedMinutes) {
    return { error: "Break duration cannot exceed the total elapsed time." };
  }
  const netWorkingMinutes = elapsedMinutes - breakMinutes;

  let rateOverrideMinor: number | null = null;
  if (parsed.data.rateOverride) {
    const rate = moneyInputSchema.safeParse(parsed.data.rateOverride);
    if (!rate.success) return { error: "Enter a valid hourly rate override, or leave it blank." };
    if (rate.data > 100000000) return { error: "The hourly rate cannot exceed £1,000,000.00." };
    rateOverrideMinor = rate.data;
  }

  const { data: profile, error: profileError } = await auth.client
    .from("profiles")
    .select("default_hourly_rate_minor")
    .eq("id", auth.userId)
    .maybeSingle();
  if (profileError || !profile) {
    console.error("Default work rate load failed:", profileError?.message ?? "Profile not found");
    return { error: "Your saved hourly rate could not be loaded." };
  }

  let selectedJob: { id: string; employer: string; archived_at: string | null; currency_code: string } | null = null;
  if (parsed.data.jobId) {
    const { data, error } = await auth.client
      .from("jobs")
      .select("id,employer,archived_at,currency_code")
      .eq("id", parsed.data.jobId)
      .eq("user_id", auth.userId)
      .maybeSingle();
    if (error) {
      console.error("Selected job profile lookup failed:", error.message);
      return { error: "The selected Job Profile could not be loaded." };
    }
    if (!data) return { error: "The selected Job Profile no longer exists." };
    if (data.archived_at && data.id !== existingRecord?.job_id) {
      return { error: "Choose an active Job Profile for a new work record." };
    }
    selectedJob = data;
  }

  let profileRateMinor: number | null = null;
  if (selectedJob) {
    const { data, error } = await auth.client
      .from("hourly_rates")
      .select("hourly_rate_minor")
      .eq("job_id", selectedJob.id)
      .eq("user_id", auth.userId)
      .lte("effective_from", workDate)
      .or(`effective_to.is.null,effective_to.gte.${workDate}`)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("Selected Job Profile rate lookup failed:", error.message);
      return { error: "The selected Job Profile rate could not be loaded." };
    }
    profileRateMinor = data ? Number(data.hourly_rate_minor) : null;
  }

  const unchangedHistoricalProfile = Boolean(existingRecord
    && (!parsed.data.jobId || existingRecord.job_id === parsed.data.jobId));
  const hourlyRateMinor = rateOverrideMinor
    ?? (unchangedHistoricalProfile ? existingRecord?.hourly_rate_snapshot_minor : null)
    ?? profileRateMinor
    ?? (!selectedJob ? Number(profile.default_hourly_rate_minor) : null);
  if (typeof hourlyRateMinor !== "number" || !Number.isSafeInteger(hourlyRateMinor) || hourlyRateMinor <= 0) {
    return {
      error: selectedJob
        ? "This Job Profile has no rate for the selected date. Enter a rate override or update the profile."
        : "Set a default hourly rate in Settings or enter a rate override.",
    };
  }
  const calculatedEarningsMinor = Math.round(netWorkingMinutes * hourlyRateMinor / 60);
  if (!Number.isSafeInteger(calculatedEarningsMinor)) {
    return { error: "These work details are too large to calculate safely." };
  }

  const record = {
    work_date: workDate,
    job_id: selectedJob?.id ?? null,
    currency_code: selectedJob?.currency_code ?? existingRecord?.currency_code ?? auth.currencyCode,
    employer_snapshot: parsed.data.employerSnapshot || selectedJob?.employer || "",
    start_time: `${parsed.data.startTime}:00`,
    end_time: `${parsed.data.endTime}:00`,
    break_minutes: breakMinutes,
    net_working_minutes: netWorkingMinutes,
    hourly_rate_snapshot_minor: hourlyRateMinor,
    calculated_earnings_minor: calculatedEarningsMinor,
    hours_worked: Number((netWorkingMinutes / 60).toFixed(2)),
  };

  let result;
  if (existingRecord) {
    result = await auth.client
      .from("daily_work_hours")
      .update(record)
      .eq("id", existingRecord.id)
      .eq("user_id", auth.userId)
      .select("id")
      .maybeSingle();
  } else {
    result = await auth.client
      .from("daily_work_hours")
      .insert({ ...record, user_id: auth.userId, post_earnings_to_finance: true })
      .select("id")
      .maybeSingle();
  }

  if (result.error) {
    console.error("Daily work record save failed:", result.error.message);
    if (result.error.code === "23505") {
      return { error: "A record already exists for this date. Edit that entry to update it." };
    }
    if (result.error.message.includes("Add an active default Finance account")) {
      return { error: `Add an active default Finance account in ${record.currency_code} before saving work.` };
    }
    return { error: "Your work record could not be saved. Please try again." };
  }

  refreshWorkViews();
  return {
    success: existingRecord && !existingRecord.post_earnings_to_finance
      ? "Work record saved. Earlier work history was not posted to Finance."
      : calculatedEarningsMinor === 0
        ? `Work record saved. No Finance income was added because earnings are ${formatMinorUnits(0, record.currency_code)}.`
        : "Work record saved and earnings added to Finance.",
  };
}

const jobProfileSchema = z.object({
  jobId: z.string().uuid().or(z.literal("")),
  employer: z.string().trim().min(1).max(120),
  title: z.string().trim().max(120),
  rate: moneyInputSchema,
  active: z.enum(["true", "false"]),
});

export async function saveWorkJobProfile(
  _previousState: WorkActionState,
  formData: FormData,
): Promise<WorkActionState> {
  const parsed = jobProfileSchema.safeParse({
    jobId: String(formData.get("jobId") ?? ""),
    employer: formData.get("employer"),
    title: formData.get("title") ?? "",
    rate: formData.get("rate"),
    active: formData.get("active") ?? "true",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the Job Profile details." };
  if (parsed.data.rate > 100000000) return { error: "The hourly rate cannot exceed £1,000,000.00." };

  const auth = await getActionUser();
  if ("error" in auth) return { error: auth.error };

  const result = parsed.data.jobId
    ? await auth.client.rpc("update_work_job_profile", {
      p_job_id: parsed.data.jobId,
      p_employer: parsed.data.employer,
      p_title: parsed.data.title,
      p_hourly_rate_minor: parsed.data.rate,
      p_is_active: parsed.data.active === "true",
    })
    : await auth.client.rpc("create_work_job_profile", {
      p_employer: parsed.data.employer,
      p_title: parsed.data.title,
      p_currency_code: auth.currencyCode,
      p_hourly_rate_minor: parsed.data.rate,
    });

  if (result.error) {
    console.error("Job Profile save failed:", result.error.message);
    return { error: "The Job Profile could not be saved. Check its details and try again." };
  }
  revalidatePath("/work");
  revalidatePath("/income");
  return { success: parsed.data.jobId ? "Job Profile updated." : "Job Profile created." };
}

export async function deleteWorkJobProfile(
  _previousState: WorkActionState,
  formData: FormData,
): Promise<WorkActionState> {
  const jobId = z.string().uuid().safeParse(formData.get("jobId"));
  if (!jobId.success) return { error: "Invalid Job Profile." };

  const auth = await getActionUser();
  if ("error" in auth) return { error: auth.error };
  const { error } = await auth.client.rpc("delete_work_job_profile", { p_job_id: jobId.data });
  if (error) {
    console.error("Job Profile deletion failed:", error.message);
    if (error.message.includes("linked to existing income or work history")) {
      return { error: "This profile is linked to older income or work history. Deactivate it to preserve those records." };
    }
    return { error: "The Job Profile could not be deleted." };
  }
  revalidatePath("/work");
  revalidatePath("/income");
  return { success: "Job Profile deleted." };
}

export async function deleteDailyWorkHours(
  _previousState: WorkActionState,
  formData: FormData,
): Promise<WorkActionState> {
  const entryId = z.string().uuid().safeParse(formData.get("entryId"));
  if (!entryId.success) return { error: "Invalid entry." };

  const auth = await getActionUser();
  if ("error" in auth) return { error: auth.error };

  const { data: entry, error: lookupError } = await auth.client
    .from("daily_work_hours")
    .select("id,post_earnings_to_finance,calculated_earnings_minor")
    .eq("id", entryId.data)
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (lookupError) {
    console.error("Daily work hours lookup before delete failed:", lookupError.message);
    return { error: "This entry could not be loaded for deletion." };
  }
  if (!entry) return { error: "This entry no longer exists." };

  const { data: deleted, error } = await auth.client
    .from("daily_work_hours")
    .delete()
    .eq("id", entryId.data)
    .eq("user_id", auth.userId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Daily work hours delete failed:", error.message);
    return { error: "This entry could not be deleted." };
  }
  if (!deleted) return { error: "This entry no longer exists." };

  refreshWorkViews();
  return {
    success: entry.post_earnings_to_finance && Number(entry.calculated_earnings_minor) > 0
      ? "Entry and its Finance income were deleted."
      : "Entry deleted.",
  };
}
