"use server";

import { revalidatePath } from "next/cache";
import { isValid } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { z } from "zod";
import { getActionUser } from "@/lib/supabase/action-user";
import { moneyInputSchema } from "@/lib/money";

export type IncomeActionState = { error?: string; success?: string };

const uuid = z.string().uuid();
const optionalMoneyInputSchema = z.string()
  .trim()
  .transform((value) => value === "" ? "0" : value)
  .pipe(z.string().regex(
    /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/,
    "Enter an amount with up to two decimal places, or leave it blank.",
  ))
  .transform((value) => minorUnits(value));
const incomeSchema = z.object({
  jobId: z.string().optional(),
  source: z.string().trim().min(1).max(120),
  frequency: z.enum(["weekly", "biweekly", "monthly", "irregular", "custom"]),
  hours: z.string().trim().regex(/^(?:0|[1-9]\d{0,3})(?:\.\d{1,2})?$/),
  hourlyRate: moneyInputSchema,
  overtime: optionalMoneyInputSchema,
  additional: optionalMoneyInputSchema,
  deductions: optionalMoneyInputSchema,
  expectedDate: z.string().date().or(z.literal("")),
  notes: z.string().max(4000),
});

function minorUnits(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export async function createIncomeRecord(
  _previousState: IncomeActionState,
  formData: FormData,
): Promise<IncomeActionState> {
  const parsed = incomeSchema.safeParse({
    jobId: String(formData.get("jobId") ?? ""),
    source: formData.get("source"),
    frequency: formData.get("frequency"),
    hours: formData.get("hours"),
    hourlyRate: formData.get("hourlyRate"),
    overtime: formData.get("overtime"),
    additional: formData.get("additional"),
    deductions: formData.get("deductions"),
    expectedDate: formData.get("expectedDate") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the income details." };
  if (parsed.data.jobId && !uuid.safeParse(parsed.data.jobId).success) {
    return { error: "Choose a valid job." };
  }

  const [hoursWhole, hoursFraction = ""] = parsed.data.hours.split(".");
  const hoursWorkedMinutes = Number(hoursWhole) * 60 + Math.round(Number(`0.${hoursFraction || "0"}`) * 60);
  const regularEarnings = Math.round(hoursWorkedMinutes * parsed.data.hourlyRate / 60);
  const overtimeEarnings = parsed.data.overtime;
  const additional = parsed.data.additional;
  const deductions = parsed.data.deductions;
  const gross = regularEarnings + overtimeEarnings + additional;
  if (![hoursWorkedMinutes, regularEarnings, overtimeEarnings, additional, deductions, gross].every(Number.isSafeInteger)) {
    return { error: "These amounts are too large to calculate safely." };
  }
  if (deductions > gross) return { error: "Deductions cannot be greater than gross earnings." };

  const auth = await getActionUser();
  if ("error" in auth) return { error: auth.error };
  let linkedJobCurrency = auth.currencyCode;
  if (parsed.data.jobId) {
    const { data: linkedJob, error: jobError } = await auth.client
      .from("jobs")
      .select("id,currency_code")
      .eq("id", parsed.data.jobId)
      .eq("user_id", auth.userId)
      .maybeSingle();
    if (jobError) {
      console.error("Expected income Job Profile lookup failed:", jobError.message);
      return { error: "The selected Job Profile could not be verified." };
    }
    if (!linkedJob) return { error: "The selected Job Profile is unavailable." };
    linkedJobCurrency = linkedJob.currency_code;
  }
  const { error } = await auth.client.from("income_records").insert({
    user_id: auth.userId,
    job_id: parsed.data.jobId || null,
    source: parsed.data.source,
    frequency: parsed.data.frequency,
    expected_date: parsed.data.expectedDate || null,
    status: "expected",
    currency_code: linkedJobCurrency,
    hours_worked_minutes: hoursWorkedMinutes,
    hourly_rate_minor: parsed.data.hourlyRate,
    regular_earnings_minor: regularEarnings,
    overtime_earnings_minor: overtimeEarnings,
    additional_payments_minor: additional,
    deductions_minor: deductions,
    gross_minor: gross,
    net_expected_minor: gross - deductions,
    notes: parsed.data.notes,
  });
  if (error) {
    console.error("Income record creation failed:", error.message);
    return { error: "The income record could not be saved." };
  }
  revalidatePath("/income");
  revalidatePath("/");
  return { success: "Expected income recorded. It has not been added to your balance." };
}

export async function addIncomePayment(
  _previousState: IncomeActionState,
  formData: FormData,
): Promise<IncomeActionState> {
  const recordId = uuid.safeParse(formData.get("incomeRecordId"));
  const accountId = uuid.safeParse(formData.get("accountId"));
  const amount = moneyInputSchema.safeParse(formData.get("amount"));
  const date = z.string().date().safeParse(formData.get("paidOn"));
  const paymentMethod = z.enum(["cash", "debit_card", "credit_card", "bank_transfer", "direct_debit", "other"])
    .safeParse(formData.get("paymentMethod"));
  const notes = z.string().max(2000).safeParse(formData.get("notes") ?? "");
  if (!recordId.success || !accountId.success || !amount.success || !date.success
    || !paymentMethod.success || !notes.success) {
    return { error: "Enter a valid payment amount, date, and account." };
  }

  const auth = await getActionUser();
  if ("error" in auth) return { error: auth.error };
  let paidAt: Date;
  try {
    paidAt = fromZonedTime(`${date.data}T12:00:00`, auth.timezone);
  } catch (error) {
    if (error instanceof RangeError) return { error: "Your timezone setting is invalid. Update it in Settings." };
    throw error;
  }
  if (!isValid(paidAt)) return { error: "Choose a valid payment date." };
  const { error } = await auth.client.from("income_payments").insert({
    user_id: auth.userId,
    income_record_id: recordId.data,
    account_id: accountId.data,
    amount_minor: amount.data,
    paid_at: paidAt.toISOString(),
    payment_method: paymentMethod.data,
    notes: notes.data,
  });
  if (error) {
    console.error("Income payment reconciliation failed:", error.message);
    return { error: "The payment could not be reconciled. Check the record and account currency." };
  }
  revalidatePath("/income");
  revalidatePath("/finance");
  revalidatePath("/");
  return { success: "Payment reconciled and posted to your account balance." };
}

const jobSchema = z.object({
  employer: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(120),
  rate: moneyInputSchema,
  overtimeRate: z.string().trim().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/).or(z.literal("")),
  overtimeThresholdHours: z.string().trim().regex(/^(?:0|[1-9]\d{0,3})(?:\.\d{1,2})?$/).or(z.literal("")),
  overtimeMultiplier: z.string().trim().regex(/^(?:[1-9]|10)(?:\.\d{1,3})?$/),
  effectiveFrom: z.string().date(),
});

export async function createJobWithRate(
  _previousState: IncomeActionState,
  formData: FormData,
): Promise<IncomeActionState> {
  const parsed = jobSchema.safeParse({
    employer: formData.get("employer"),
    title: formData.get("title"),
    rate: formData.get("rate"),
    overtimeRate: formData.get("overtimeRate") || "",
    overtimeThresholdHours: formData.get("overtimeThresholdHours") || "",
    overtimeMultiplier: formData.get("overtimeMultiplier"),
    effectiveFrom: formData.get("effectiveFrom"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the job details." };
  const overtimeRate = parsed.data.overtimeRate ? minorUnits(parsed.data.overtimeRate) : null;
  const threshold = parsed.data.overtimeThresholdHours
    ? Math.round(Number(parsed.data.overtimeThresholdHours) * 60)
    : null;
  const multiplier = Number(parsed.data.overtimeMultiplier);
  if ((overtimeRate !== null && !Number.isSafeInteger(overtimeRate))
    || (threshold !== null && (!Number.isSafeInteger(threshold) || threshold < 0))
    || !Number.isFinite(multiplier) || multiplier < 1 || multiplier > 10) {
    return { error: "The overtime settings are invalid." };
  }
  const auth = await getActionUser();
  if ("error" in auth) return { error: auth.error };
  const { error } = await auth.client.rpc("create_job_with_rate", {
    p_employer: parsed.data.employer,
    p_title: parsed.data.title,
    p_currency_code: auth.currencyCode,
    p_hourly_rate_minor: parsed.data.rate,
    p_overtime_rate_minor: overtimeRate,
    p_overtime_threshold_minutes: threshold,
    p_overtime_multiplier: multiplier,
    p_effective_from: parsed.data.effectiveFrom,
  });
  if (error) {
    console.error("Job setup failed:", error.message);
    return { error: "The job and initial rate could not be saved together." };
  }
  revalidatePath("/income");
  revalidatePath("/work");
  return { success: "Job and initial hourly rate saved." };
}

export async function addHourlyRate(
  _previousState: IncomeActionState,
  formData: FormData,
): Promise<IncomeActionState> {
  const jobId = uuid.safeParse(formData.get("jobId"));
  const rate = moneyInputSchema.safeParse(formData.get("rate"));
  const overtimeRateText = String(formData.get("overtimeRate") ?? "");
  const overtimeRate = overtimeRateText ? moneyInputSchema.safeParse(overtimeRateText) : null;
  const effectiveFrom = z.string().date().safeParse(formData.get("effectiveFrom"));
  if (!jobId.success || !rate.success || !effectiveFrom.success
    || (overtimeRate && !overtimeRate.success)) {
    return { error: "Enter a valid rate and effective date." };
  }
  const auth = await getActionUser();
  if ("error" in auth) return { error: auth.error };
  const { error } = await auth.client.rpc("add_hourly_rate", {
    p_job_id: jobId.data,
    p_hourly_rate_minor: rate.data,
    p_overtime_rate_minor: overtimeRate?.data ?? null,
    p_effective_from: effectiveFrom.data,
  });
  if (error) {
    console.error("Hourly rate update failed:", error.message);
    return { error: "The rate overlaps an existing effective date or the job is unavailable." };
  }
  revalidatePath("/income");
  revalidatePath("/work");
  return { success: "Hourly rate updated. Previously recorded shifts retain their rate snapshot." };
}
