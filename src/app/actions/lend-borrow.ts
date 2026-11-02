"use server";

import { revalidatePath } from "next/cache";
import { isValid } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { z } from "zod";
import { moneyInputSchema } from "@/lib/money";
import { getActionUser } from "@/lib/supabase/action-user";

export type DebtActionState = { error?: string; success?: string };

const debtRecordSchema = z.object({
  id: z.string().uuid().optional(),
  personName: z.string().trim().min(1).max(120),
  direction: z.enum(["lent", "borrowed"]),
  amount: moneyInputSchema,
  occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  note: z.string().max(2000).default(""),
});

const debtPaymentSchema = z.object({
  debtId: z.string().uuid(),
  amount: moneyInputSchema,
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  note: z.string().max(500).default(""),
});

type ActionSupabaseClient = Extract<
  Awaited<ReturnType<typeof getActionUser>>,
  { client: unknown }
>["client"];

async function updateDebtStatus(client: ActionSupabaseClient, userId: string, debtId: string, amountMinor: number) {
  const { data: payments, error } = await client
    .from("debt_payments")
    .select("amount_minor")
    .eq("debt_id", debtId)
    .eq("user_id", userId);

  if (error) {
    console.error("Debt payment lookup failed:", error.message);
    return false;
  }

  const paymentRows: Array<{ amount_minor?: number | null }> = payments ?? [];
  const paidMinor = paymentRows.reduce((sum: number, payment) => sum + Number(payment.amount_minor ?? 0), 0);
  const remainingMinor = Math.max(0, amountMinor - paidMinor);
  const nextStatus = remainingMinor === 0 ? "repaid" : paidMinor > 0 ? "partially_repaid" : "outstanding";

  const { error: updateError } = await client
    .from("debt_records")
    .update({ status: nextStatus })
    .eq("id", debtId)
    .eq("user_id", userId);

  if (updateError) {
    console.error("Debt status update failed:", updateError.message);
    return false;
  }

  return true;
}

export async function saveDebtRecord(_previousState: DebtActionState, formData: FormData): Promise<DebtActionState> {
  const parsed = debtRecordSchema.safeParse({
    id: formData.get("id") ? String(formData.get("id")) : undefined,
    personName: formData.get("personName"),
    direction: formData.get("direction"),
    amount: formData.get("amount"),
    occurredAt: formData.get("occurredAt"),
    note: formData.get("note") ?? "",
  });

  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the debt record details." };

  const record = parsed.data;
  const auth = await getActionUser();
  if ("error" in auth) return { error: auth.error };

  let occurredAt: Date;
  try {
    occurredAt = fromZonedTime(record.occurredAt, auth.timezone);
  } catch (error) {
    if (error instanceof RangeError) return { error: "Your timezone setting is invalid. Update it in Settings." };
    throw error;
  }

  if (!isValid(occurredAt)) return { error: "Choose a valid date and time." };

  if (record.id) {
    const { data: existing, error: existingError } = await auth.client
      .from("debt_records")
      .select("id,amount_minor")
      .eq("id", record.id)
      .eq("user_id", auth.userId)
      .maybeSingle();

    if (existingError) {
      console.error("Debt lookup failed:", existingError.message);
      return { error: "The debt record could not be verified." };
    }

    if (!existing) return { error: "This debt record no longer exists." };

    const { error } = await auth.client
      .from("debt_records")
      .update({
        person_name: record.personName,
        direction: record.direction,
        amount_minor: record.amount,
        occurred_at: occurredAt.toISOString(),
        note: record.note,
      })
      .eq("id", record.id)
      .eq("user_id", auth.userId);

    if (error) {
      console.error("Debt update failed:", error.message);
      return { error: "The debt record could not be updated." };
    }

    const updated = await updateDebtStatus(auth.client, auth.userId, record.id, record.amount);
    if (!updated) return { error: "The debt status could not be refreshed." };
    revalidatePath("/lend-borrow");
    return { success: "Debt record updated." };
  }

  const { error } = await auth.client.from("debt_records").insert({
    user_id: auth.userId,
    person_name: record.personName,
    direction: record.direction,
    amount_minor: record.amount,
    occurred_at: occurredAt.toISOString(),
    note: record.note,
    status: "outstanding",
  });

  if (error) {
    console.error("Debt save failed:", error.message);
    return { error: "The debt record could not be saved." };
  }

  revalidatePath("/lend-borrow");
  return { success: "Debt record saved." };
}

export async function deleteDebtRecord(_previousState: DebtActionState, formData: FormData): Promise<DebtActionState> {
  const debtId = String(formData.get("id") ?? "");
  if (!debtId) return { error: "No debt record was selected." };

  const auth = await getActionUser();
  if ("error" in auth) return { error: auth.error };

  const { error } = await auth.client
    .from("debt_records")
    .delete()
    .eq("id", debtId)
    .eq("user_id", auth.userId);

  if (error) {
    console.error("Debt delete failed:", error.message);
    return { error: "The debt record could not be deleted." };
  }

  revalidatePath("/lend-borrow");
  return { success: "Debt record deleted." };
}

export async function recordDebtPayment(_previousState: DebtActionState, formData: FormData): Promise<DebtActionState> {
  const parsed = debtPaymentSchema.safeParse({
    debtId: formData.get("debtId"),
    amount: formData.get("amount"),
    paidAt: formData.get("paidAt"),
    note: formData.get("note") ?? "",
  });

  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the repayment details." };

  const payment = parsed.data;
  const auth = await getActionUser();
  if ("error" in auth) return { error: auth.error };

  const { data: debt, error: debtError } = await auth.client
    .from("debt_records")
    .select("id,amount_minor,status")
    .eq("id", payment.debtId)
    .eq("user_id", auth.userId)
    .maybeSingle();

  if (debtError) {
    console.error("Debt fetch failed:", debtError.message);
    return { error: "The debt record could not be loaded." };
  }

  if (!debt) return { error: "This debt record no longer exists." };

  const { data: paymentRows, error: paymentError } = await auth.client
    .from("debt_payments")
    .select("amount_minor")
    .eq("debt_id", payment.debtId)
    .eq("user_id", auth.userId);

  if (paymentError) {
    console.error("Debt payment totals failed:", paymentError.message);
    return { error: "The repayment totals could not be verified." };
  }

  const paidMinor = (paymentRows ?? []).reduce((sum, row) => sum + Number(row.amount_minor ?? 0), 0);
  const outstandingMinor = Math.max(0, Number(debt.amount_minor) - paidMinor);
  if (payment.amount > outstandingMinor) {
    return { error: "The repayment exceeds the remaining balance." };
  }

  let paidAt: Date;
  try {
    paidAt = fromZonedTime(payment.paidAt, auth.timezone);
  } catch (error) {
    if (error instanceof RangeError) return { error: "Your timezone setting is invalid. Update it in Settings." };
    throw error;
  }

  if (!isValid(paidAt)) return { error: "Choose a valid repayment date and time." };

  const { error: insertError } = await auth.client.from("debt_payments").insert({
    user_id: auth.userId,
    debt_id: payment.debtId,
    amount_minor: payment.amount,
    paid_at: paidAt.toISOString(),
    note: payment.note,
  });

  if (insertError) {
    console.error("Debt payment save failed:", insertError.message);
    return { error: "The repayment could not be saved." };
  }

  const updated = await updateDebtStatus(auth.client, auth.userId, payment.debtId, Number(debt.amount_minor));
  if (!updated) return { error: "The debt status could not be refreshed." };

  revalidatePath("/lend-borrow");
  return { success: "Repayment recorded." };
}

export async function deleteDebtPayment(_previousState: DebtActionState, formData: FormData): Promise<DebtActionState> {
  const paymentId = String(formData.get("paymentId") ?? "");
  if (!paymentId) return { error: "No repayment was selected." };

  const auth = await getActionUser();
  if ("error" in auth) return { error: auth.error };

  const { data: payment, error: paymentLookupError } = await auth.client
    .from("debt_payments")
    .select("debt_id,amount_minor")
    .eq("id", paymentId)
    .eq("user_id", auth.userId)
    .maybeSingle();

  if (paymentLookupError) {
    console.error("Repayment lookup failed:", paymentLookupError.message);
    return { error: "The repayment could not be found." };
  }

  if (!payment) return { error: "This repayment is no longer available." };

  const { error: deleteError } = await auth.client
    .from("debt_payments")
    .delete()
    .eq("id", paymentId)
    .eq("user_id", auth.userId);

  if (deleteError) {
    console.error("Repayment delete failed:", deleteError.message);
    return { error: "The repayment could not be removed." };
  }

  const { data: debt, error: debtError } = await auth.client
    .from("debt_records")
    .select("amount_minor")
    .eq("id", payment.debt_id)
    .eq("user_id", auth.userId)
    .maybeSingle();

  if (debtError || !debt) {
    console.error("Debt fetch failed after repayment delete:", debtError?.message ?? "Debt missing");
    revalidatePath("/lend-borrow");
    return { success: "Repayment removed." };
  }

  const updated = await updateDebtStatus(auth.client, auth.userId, payment.debt_id, Number(debt.amount_minor));
  if (!updated) return { error: "The debt status could not be refreshed." };

  revalidatePath("/lend-borrow");
  return { success: "Repayment removed." };
}
