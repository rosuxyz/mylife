"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { moneyInputSchema } from "@/lib/money";
import { getActionUser } from "@/lib/supabase/action-user";

export type GoalActionState = { error?: string; success?: string };

const uuid = z.string().uuid();
const goalSchema = z.object({
  name: z.string().trim().min(1).max(100),
  target: moneyInputSchema,
  startsOn: z.string().date(),
  deadline: z.string().date().or(z.literal("")),
  description: z.string().max(2000),
});

export async function createGoal(
  _previousState: GoalActionState,
  formData: FormData,
): Promise<GoalActionState> {
  const parsed = goalSchema.safeParse({
    name: formData.get("name"),
    target: formData.get("target"),
    startsOn: formData.get("startsOn"),
    deadline: formData.get("deadline") || "",
    description: formData.get("description") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the goal details." };
  if (parsed.data.deadline && parsed.data.deadline < parsed.data.startsOn) {
    return { error: "The deadline cannot be before the goal start date." };
  }
  const auth = await getActionUser();
  if ("error" in auth) return { error: auth.error };
  const { error } = await auth.client.from("savings_goals").insert({
    user_id: auth.userId,
    name: parsed.data.name,
    target_amount_minor: parsed.data.target,
    currency_code: auth.currencyCode,
    starts_on: parsed.data.startsOn,
    deadline: parsed.data.deadline || null,
    description: parsed.data.description,
  });
  if (error) {
    console.error("Goal creation failed:", error.message);
    return { error: "The savings goal could not be saved." };
  }
  revalidatePath("/goals");
  return { success: "Savings goal created." };
}

export async function updateGoal(
  _previousState: GoalActionState,
  formData: FormData,
): Promise<GoalActionState> {
  const id = uuid.safeParse(formData.get("id"));
  const parsed = goalSchema.safeParse({
    name: formData.get("name"),
    target: formData.get("target"),
    startsOn: formData.get("startsOn"),
    deadline: formData.get("deadline") || "",
    description: formData.get("description") ?? "",
  });
  if (!id.success || !parsed.success) return { error: parsed.success ? "Invalid goal." : parsed.error.issues[0]?.message ?? "Check the goal details." };
  if (parsed.data.deadline && parsed.data.deadline < parsed.data.startsOn) {
    return { error: "The deadline cannot be before the goal start date." };
  }
  const auth = await getActionUser();
  if ("error" in auth) return { error: auth.error };
  const { error } = await auth.client.from("savings_goals").update({
    name: parsed.data.name,
    target_amount_minor: parsed.data.target,
    starts_on: parsed.data.startsOn,
    deadline: parsed.data.deadline || null,
    description: parsed.data.description,
  }).eq("id", id.data).eq("user_id", auth.userId);
  if (error) {
    console.error("Goal update failed:", error.message);
    return { error: "The goal could not be updated." };
  }
  revalidatePath("/goals");
  return { success: "Goal updated. Account balances are unchanged." };
}

export async function addGoalContribution(
  _previousState: GoalActionState,
  formData: FormData,
): Promise<GoalActionState> {
  const goalId = uuid.safeParse(formData.get("goalId"));
  const amount = moneyInputSchema.safeParse(formData.get("amount"));
  const contributedAt = z.string().date().safeParse(formData.get("contributedAt"));
  const note = z.string().max(500).safeParse(formData.get("note") ?? "");
  if (!goalId.success || !amount.success || !contributedAt.success || !note.success) {
    return { error: "Enter a valid contribution amount and date." };
  }
  const auth = await getActionUser();
  if ("error" in auth) return { error: auth.error };
  const { error } = await auth.client.from("goal_contributions").insert({
    user_id: auth.userId,
    goal_id: goalId.data,
    amount_minor: amount.data,
    contributed_at: new Date(`${contributedAt.data}T12:00:00Z`).toISOString(),
    note: note.data,
  });
  if (error) {
    console.error("Goal contribution failed:", error.message);
    return { error: "The contribution could not be saved." };
  }
  revalidatePath("/goals");
  return { success: "Contribution recorded. Your account balance is unchanged." };
}

export async function deleteGoal(
  _previousState: GoalActionState,
  formData: FormData,
): Promise<GoalActionState> {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "Invalid goal." };
  const auth = await getActionUser();
  if ("error" in auth) return { error: auth.error };
  const { error } = await auth.client.from("savings_goals").delete()
    .eq("id", id.data).eq("user_id", auth.userId);
  if (error) {
    console.error("Goal deletion failed:", error.message);
    return { error: "The goal could not be deleted." };
  }
  revalidatePath("/goals");
  return { success: "Goal and its history were deleted." };
}
