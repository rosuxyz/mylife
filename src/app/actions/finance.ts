"use server";

import { revalidatePath } from "next/cache";
import { fromZonedTime } from "date-fns-tz";
import { isValid } from "date-fns";
import { z } from "zod";
import { moneyInputSchema } from "@/lib/money";
import { getActionUser } from "@/lib/supabase/action-user";

export type FinanceActionState = { error?: string; success?: string };

const uuid = z.string().uuid();

const transactionSchema = z.object({
  kind: z.enum(["income", "expense", "transfer"]),
  accountId: z.string().optional(),
  fromAccountId: z.string().optional(),
  toAccountId: z.string().optional(),
  categoryId: z.string().optional(),
  amount: moneyInputSchema,
  description: z.string().trim().min(1).max(160),
  occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  paymentMethod: z.enum(["cash", "debit_card", "credit_card", "bank_transfer", "direct_debit", "other"]),
  notes: z.string().max(4000),
});

export async function createTransaction(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const kind = formData.get("kind");
  const localDate = String(formData.get("occurredAt") ?? "");
  const parsed = transactionSchema.safeParse({
    kind,
    accountId: String(formData.get("accountId") ?? ""),
    fromAccountId: String(formData.get("fromAccountId") ?? ""),
    toAccountId: String(formData.get("toAccountId") ?? ""),
    categoryId: String(formData.get("categoryId") ?? ""),
    amount: formData.get("amount"),
    description: formData.get("description"),
    occurredAt: localDate,
    paymentMethod: formData.get("paymentMethod"),
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the transaction details." };
  const transaction = parsed.data;

  const auth = await getActionUser();
  if ("error" in auth) return { error: auth.error };
  let occurredAt: Date;
  try {
    occurredAt = fromZonedTime(transaction.occurredAt, auth.timezone);
  } catch (error) {
    if (error instanceof RangeError) return { error: "Your timezone setting is invalid. Update it in Settings." };
    throw error;
  }
  if (!isValid(occurredAt)) return { error: "Choose a valid transaction date and time." };

  const isTransfer = transaction.kind === "transfer";
  let currencyCode = auth.currencyCode;
  if (isTransfer) {
    if (!uuid.safeParse(transaction.fromAccountId).success || !uuid.safeParse(transaction.toAccountId).success) {
      return { error: "Choose both accounts for the transfer." };
    }
    if (transaction.fromAccountId === transaction.toAccountId) {
      return { error: "Choose two different accounts for a transfer." };
    }
    const { data: source, error: sourceError } = await auth.client
      .from("accounts").select("currency_code").eq("id", transaction.fromAccountId)
      .eq("user_id", auth.userId).is("archived_at", null).maybeSingle();
    const { data: destination, error: destinationError } = await auth.client
      .from("accounts").select("currency_code").eq("id", transaction.toAccountId)
      .eq("user_id", auth.userId).is("archived_at", null).maybeSingle();
    if (sourceError || destinationError) {
      console.error("Transfer account lookup failed:", sourceError?.message ?? destinationError?.message);
      return { error: "The selected accounts could not be verified." };
    }
    if (!source || !destination) return { error: "Choose two active accounts that belong to you." };
    if (source.currency_code !== destination.currency_code) {
      return { error: "Transfers between different currencies are not supported." };
    }
    currencyCode = source.currency_code;
  } else if (!uuid.safeParse(transaction.accountId).success) {
    return { error: "Choose an account for the transaction." };
  } else {
    const { data: account, error: accountError } = await auth.client
      .from("accounts").select("currency_code").eq("id", transaction.accountId)
      .eq("user_id", auth.userId).is("archived_at", null).maybeSingle();
    if (accountError) {
      console.error("Transaction account lookup failed:", accountError.message);
      return { error: "The selected account could not be verified." };
    }
    if (!account) return { error: "Choose an active account that belongs to you." };
    currencyCode = account.currency_code;
  }

  if (!isTransfer && transaction.categoryId && !uuid.safeParse(transaction.categoryId).success) {
    return { error: "Choose a valid category." };
  }

  const { error } = await auth.client.from("transactions").insert({
    user_id: auth.userId,
    kind: transaction.kind,
    account_id: isTransfer ? null : transaction.accountId,
    from_account_id: isTransfer ? transaction.fromAccountId : null,
    to_account_id: isTransfer ? transaction.toAccountId : null,
    category_id: isTransfer || !transaction.categoryId ? null : transaction.categoryId,
    amount_minor: transaction.amount,
    currency_code: currencyCode,
    occurred_at: occurredAt.toISOString(),
    description: transaction.description,
    payment_method: transaction.paymentMethod,
    notes: transaction.notes,
  });
  if (error) {
    console.error("Transaction creation failed:", error.message);
    return { error: "The transaction could not be saved. Check the selected account and category." };
  }

  revalidatePath("/finance");
  revalidatePath("/");
  return { success: "Transaction saved." };
}

const accountSchema = z.object({
  name: z.string().trim().min(1).max(80),
  accountType: z.enum(["checking", "savings", "cash", "other"]),
  openingBalance: z.string().trim().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/),
});

export async function createAccount(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = accountSchema.safeParse({
    name: formData.get("name"),
    accountType: formData.get("accountType"),
    openingBalance: formData.get("openingBalance"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the account details." };
  const auth = await getActionUser();
  if ("error" in auth) return { error: auth.error };

  const [whole, fraction = ""] = parsed.data.openingBalance.split(".");
  const openingBalance = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(openingBalance) || openingBalance > 9_000_000_000_000_000) {
    return { error: "The opening balance is too large." };
  }

  const { error } = await auth.client.from("accounts").insert({
    user_id: auth.userId,
    name: parsed.data.name,
    account_type: parsed.data.accountType,
    currency_code: auth.currencyCode,
    opening_balance_minor: openingBalance,
  });
  if (error) {
    console.error("Account creation failed:", error.message);
    return { error: "The account could not be saved." };
  }
  revalidatePath("/finance");
  return { success: "Account added." };
}

const categorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(["income", "expense"]),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});

export async function createCategory(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = categorySchema.safeParse({
    name: formData.get("name"),
    kind: formData.get("kind"),
    color: formData.get("color"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the category details." };
  const auth = await getActionUser();
  if ("error" in auth) return { error: auth.error };

  const { error } = await auth.client.from("categories").insert({
    user_id: auth.userId,
    name: parsed.data.name,
    kind: parsed.data.kind,
    color: parsed.data.color,
  });
  if (error) {
    console.error("Category creation failed:", error.message);
    return { error: error.code === "23505" ? "A category with this name already exists." : "The category could not be saved." };
  }
  revalidatePath("/finance");
  return { success: "Category added." };
}

const budgetSchema = z.object({
  name: z.string().trim().min(1).max(100),
  amount: moneyInputSchema,
  period: z.enum(["weekly", "monthly"]),
  categoryId: z.string().optional(),
  startsOn: z.string().date(),
});

export async function createBudget(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const parsed = budgetSchema.safeParse({
    name: formData.get("name"),
    amount: formData.get("amount"),
    period: formData.get("period"),
    categoryId: String(formData.get("categoryId") ?? ""),
    startsOn: formData.get("startsOn"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the budget details." };
  const auth = await getActionUser();
  if ("error" in auth) return { error: auth.error };
  if (parsed.data.categoryId && !uuid.safeParse(parsed.data.categoryId).success) {
    return { error: "Choose a valid category." };
  }

  const { error } = await auth.client.from("budgets").insert({
    user_id: auth.userId,
    name: parsed.data.name,
    amount_minor: parsed.data.amount,
    currency_code: auth.currencyCode,
    period: parsed.data.period,
    category_id: parsed.data.categoryId || null,
    starts_on: parsed.data.startsOn,
  });
  if (error) {
    console.error("Budget creation failed:", error.message);
    return { error: "The budget could not be saved." };
  }
  revalidatePath("/finance");
  return { success: "Budget created." };
}

export async function deleteTransaction(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "Invalid transaction." };
  const auth = await getActionUser();
  if ("error" in auth) return { error: auth.error };

  const { error } = await auth.client
    .from("transactions")
    .delete()
    .eq("id", id.data)
    .eq("user_id", auth.userId)
    .is("income_payment_id", null)
    .is("work_entry_id", null);
  if (error) {
    console.error("Transaction deletion failed:", error.message);
    return { error: "This transaction could not be deleted." };
  }
  const { data: remainingTransaction, error: verificationError } = await auth.client
    .from("transactions")
    .select("id,work_entry_id,income_payment_id")
    .eq("id", id.data)
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (verificationError) {
    console.error("Transaction deletion verification failed:", verificationError.message);
    return { error: "The transaction deletion could not be verified." };
  }
  if (remainingTransaction) {
    return {
      error: remainingTransaction.work_entry_id
        ? "Income from work hours is managed by the Work Tracker."
        : "This reconciled payment cannot be deleted here.",
    };
  }
  revalidatePath("/finance");
  revalidatePath("/");
  return { success: "Transaction deleted." };
}

export async function updateTransaction(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const id = uuid.safeParse(formData.get("id"));
  const parsed = transactionSchema.safeParse({
    kind: formData.get("kind"),
    accountId: String(formData.get("accountId") ?? ""),
    fromAccountId: String(formData.get("fromAccountId") ?? ""),
    toAccountId: String(formData.get("toAccountId") ?? ""),
    categoryId: String(formData.get("categoryId") ?? ""),
    amount: formData.get("amount"),
    description: formData.get("description"),
    occurredAt: formData.get("occurredAt"),
    paymentMethod: formData.get("paymentMethod"),
    notes: formData.get("notes") ?? "",
  });
  if (!id.success || !parsed.success) {
    return { error: parsed.success ? "Invalid transaction." : parsed.error.issues[0]?.message ?? "Check the transaction details." };
  }
  const auth = await getActionUser();
  if ("error" in auth) return { error: auth.error };

  let occurredAt: Date;
  try {
    occurredAt = fromZonedTime(parsed.data.occurredAt, auth.timezone);
  } catch (error) {
    if (error instanceof RangeError) return { error: "Your timezone setting is invalid. Update it in Settings." };
    throw error;
  }
  if (!isValid(occurredAt)) return { error: "Choose a valid transaction date and time." };
  const isTransfer = parsed.data.kind === "transfer";
  let currencyCode = auth.currencyCode;
  if (isTransfer) {
    if (!uuid.safeParse(parsed.data.fromAccountId).success || !uuid.safeParse(parsed.data.toAccountId).success
      || parsed.data.fromAccountId === parsed.data.toAccountId) {
      return { error: "Choose two different accounts for the transfer." };
    }
    const [sourceResult, destinationResult] = await Promise.all([
      auth.client.from("accounts").select("currency_code").eq("id", parsed.data.fromAccountId)
        .eq("user_id", auth.userId).is("archived_at", null).maybeSingle(),
      auth.client.from("accounts").select("currency_code").eq("id", parsed.data.toAccountId)
        .eq("user_id", auth.userId).is("archived_at", null).maybeSingle(),
    ]);
    if (sourceResult.error || destinationResult.error) {
      console.error("Transaction update account lookup failed:", sourceResult.error?.message ?? destinationResult.error?.message);
      return { error: "The selected accounts could not be verified." };
    }
    if (!sourceResult.data || !destinationResult.data
      || sourceResult.data.currency_code !== destinationResult.data.currency_code) {
      return { error: "Choose active accounts in the same currency." };
    }
    currencyCode = sourceResult.data.currency_code;
  } else {
    if (!uuid.safeParse(parsed.data.accountId).success) return { error: "Choose an account for the transaction." };
    const { data: account, error } = await auth.client.from("accounts")
      .select("currency_code").eq("id", parsed.data.accountId).eq("user_id", auth.userId)
      .is("archived_at", null).maybeSingle();
    if (error) {
      console.error("Transaction update account lookup failed:", error.message);
      return { error: "The selected account could not be verified." };
    }
    if (!account) return { error: "Choose an active account that belongs to you." };
    currencyCode = account.currency_code;
    if (parsed.data.categoryId && !uuid.safeParse(parsed.data.categoryId).success) {
      return { error: "Choose a valid category." };
    }
  }

  const { data: updated, error } = await auth.client.from("transactions").update({
    kind: parsed.data.kind,
    account_id: isTransfer ? null : parsed.data.accountId,
    from_account_id: isTransfer ? parsed.data.fromAccountId : null,
    to_account_id: isTransfer ? parsed.data.toAccountId : null,
    category_id: isTransfer || !parsed.data.categoryId ? null : parsed.data.categoryId,
    amount_minor: parsed.data.amount,
    currency_code: currencyCode,
    occurred_at: occurredAt.toISOString(),
    description: parsed.data.description,
    payment_method: parsed.data.paymentMethod,
    notes: parsed.data.notes,
  }).eq("id", id.data).eq("user_id", auth.userId).is("income_payment_id", null).is("work_entry_id", null)
    .select("id").maybeSingle();
  if (error) {
    console.error("Transaction update failed:", error.message);
    return { error: "The transaction could not be updated. Check its account and category." };
  }
  if (!updated) return { error: "This transaction is missing, reconciled, or managed by the Work Tracker." };
  revalidatePath("/finance");
  revalidatePath("/");
  return { success: "Transaction updated." };
}

export async function updateCategory(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const id = uuid.safeParse(formData.get("id"));
  const parsed = z.object({
    name: z.string().trim().min(1).max(60),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  }).safeParse({ name: formData.get("name"), color: formData.get("color") });
  if (!id.success || !parsed.success) return { error: "Enter a valid category name and colour." };
  const auth = await getActionUser();
  if ("error" in auth) return { error: auth.error };
  const { error } = await auth.client.from("categories").update(parsed.data)
    .eq("id", id.data).eq("user_id", auth.userId);
  if (error) {
    console.error("Category update failed:", error.message);
    return { error: error.code === "23505" ? "A category with this name already exists." : "The category could not be updated." };
  }
  revalidatePath("/finance");
  return { success: "Category updated." };
}

export async function deleteCategory(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "Invalid category." };
  const auth = await getActionUser();
  if ("error" in auth) return { error: auth.error };
  const { error } = await auth.client.from("categories").delete().eq("id", id.data).eq("user_id", auth.userId);
  if (error) {
    console.error("Category deletion failed:", error.message);
    return { error: error.code === "23503" ? "This category is in use and cannot be deleted." : "The category could not be deleted." };
  }
  revalidatePath("/finance");
  return { success: "Category deleted." };
}

export async function updateBudget(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const id = uuid.safeParse(formData.get("id"));
  const parsed = budgetSchema.safeParse({
    name: formData.get("name"),
    amount: formData.get("amount"),
    period: formData.get("period"),
    categoryId: String(formData.get("categoryId") ?? ""),
    startsOn: formData.get("startsOn"),
  });
  if (!id.success || !parsed.success) {
    return { error: parsed.success ? "Invalid budget." : parsed.error.issues[0]?.message ?? "Check the budget details." };
  }
  if (parsed.data.categoryId && !uuid.safeParse(parsed.data.categoryId).success) {
    return { error: "Choose a valid category." };
  }
  const auth = await getActionUser();
  if ("error" in auth) return { error: auth.error };
  const { data: existing, error: lookupError } = await auth.client.from("budgets")
    .select("currency_code").eq("id", id.data).eq("user_id", auth.userId).maybeSingle();
  if (lookupError) {
    console.error("Budget currency lookup failed:", lookupError.message);
    return { error: "The budget could not be verified." };
  }
  if (!existing) return { error: "This budget is missing or does not belong to you." };
  const { error } = await auth.client.from("budgets").update({
    name: parsed.data.name,
    amount_minor: parsed.data.amount,
    currency_code: existing.currency_code,
    period: parsed.data.period,
    category_id: parsed.data.categoryId || null,
    starts_on: parsed.data.startsOn,
  }).eq("id", id.data).eq("user_id", auth.userId);
  if (error) {
    console.error("Budget update failed:", error.message);
    return { error: "The budget could not be updated. Check its category." };
  }
  revalidatePath("/finance");
  return { success: "Budget updated." };
}

export async function deleteBudget(
  _previousState: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "Invalid budget." };
  const auth = await getActionUser();
  if ("error" in auth) return { error: auth.error };
  const { error } = await auth.client.from("budgets").delete().eq("id", id.data).eq("user_id", auth.userId);
  if (error) {
    console.error("Budget deletion failed:", error.message);
    return { error: "The budget could not be deleted." };
  }
  revalidatePath("/finance");
  return { success: "Budget deleted." };
}
