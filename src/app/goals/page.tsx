import { redirect } from "next/navigation";
import { connection } from "next/server";
import { DatabaseError, DatabaseSetup } from "@/components/database-state";
import { GoalsClient } from "@/components/goals-client";
import { getProfileForUser } from "@/lib/supabase/profile";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { isSupabaseSchemaMissing } from "@/lib/supabase/schema-status";

export const instant = false;

export default async function GoalsPage() {
  await connection();
  const { supabase, user } = await getAuthenticatedUser();
  if (!supabase) return <DatabaseSetup />;
  if (!user) redirect("/login");

  const loadContributions = async () => {
    const contributions: {
      id: string;
      goal_id: string;
      amount_minor: number;
      contributed_at: string;
      note: string;
    }[] = [];
    const pageSize = 1000;
    let offset = 0;
    while (true) {
      const result = await supabase
        .from("goal_contributions")
        .select("id,goal_id,amount_minor,contributed_at,note")
        .order("contributed_at", { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (result.error) return { data: null, error: result.error };
      const page = result.data ?? [];
      contributions.push(...page.map((item) => ({ ...item, amount_minor: Number(item.amount_minor) })));
      if (page.length < pageSize) return { data: contributions, error: null };
      offset += pageSize;
    }
  };
  const [goalsResult, contributionsResult, profileResult] = await Promise.all([
    supabase.from("savings_goals").select("id,name,target_amount_minor,currency_code,starts_on,deadline,description").is("archived_at", null).order("created_at", { ascending: false }),
    loadContributions(),
    getProfileForUser(supabase, user, "currency_code,timezone"),
  ]);
  const failure = goalsResult.error ?? contributionsResult.error;
  if (failure) {
    console.error("Savings goals data load failed:", failure.message);
    return <DatabaseError message="Your savings goals could not be loaded." schemaMissing={isSupabaseSchemaMissing(failure)} />;
  }

  const contributionsByGoal = new Map<string, NonNullable<typeof contributionsResult.data>>();
  for (const contribution of contributionsResult.data ?? []) {
    const existing = contributionsByGoal.get(contribution.goal_id) ?? [];
    existing.push(contribution);
    contributionsByGoal.set(contribution.goal_id, existing);
  }
  const goals = (goalsResult.data ?? []).map((goal) => ({
    ...goal,
    target_amount_minor: Number(goal.target_amount_minor),
    contributions: contributionsByGoal.get(goal.id) ?? [],
  }));
  if (!profileResult) return <DatabaseError message="Your personal profile is missing." />;
  return <GoalsClient currencyCode={profileResult.currency_code ?? "GBP"} goals={goals} timezone={profileResult.timezone ?? "Europe/London"} />;
}
