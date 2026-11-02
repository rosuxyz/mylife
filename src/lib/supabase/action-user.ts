import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getProfileForUser } from "@/lib/supabase/profile";

export async function getActionUser() {
  const client = await createSupabaseServerClient();
  if (!client) return { error: "Connect Supabase in .env.local before saving records." } as const;

  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) {
    return { error: "Sign in before saving personal records." } as const;
  }

  const profile = await getProfileForUser(client, authData.user, "currency_code,timezone");
  if (!profile) {
    return { error: "Your profile is not ready yet. Refresh and try again." } as const;
  }

  return {
    client,
    userId: authData.user.id,
    currencyCode: (profile.currency_code ?? "GBP") as string,
    timezone: (profile.timezone ?? "Europe/London") as string,
  } as const;
}
