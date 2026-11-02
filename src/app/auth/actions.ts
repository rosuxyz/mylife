"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { getProfileForUser } from "@/lib/supabase/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AuthState = {
  error?: string;
  success?: string;
};

const credentialsSchema = z.object({
  email: z.string().trim().email("Enter a valid email address.").max(254),
  password: z.string().min(8, "Password must be at least 8 characters.").max(128),
});

const signupSchema = credentialsSchema.extend({
  name: z.string().trim().min(1, "Enter your name.").max(100),
});

export async function signIn(
  _previousState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check your details." };

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "Authentication is not configured. Add the Supabase values to .env.local." };

  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error?.code === "email_not_confirmed") {
    return { error: "Confirm your email using the latest confirmation email before signing in." };
  }
  if (error) return { error: "Unable to sign in. Check your email and password." };

  redirect("/");
}

export async function signUp(
  _previousState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check your details." };

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "Authentication is not configured. Add the Supabase values to .env.local." };

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.name },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/auth/callback`,
    },
  });
  if (error) return { error: error.message };
  if (data.user) {
    await getProfileForUser(supabase, data.user, "id");
  }
  if (!data.session) {
    return { success: "Check your email to confirm your account, then sign in." };
  }

  redirect("/");
}

export async function requestPasswordReset(
  _previousState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = z.string().trim().email().max(254).safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address." };

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "Authentication is not configured. Add the Supabase values to .env.local." };

  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/auth/callback?next=/reset-password`,
  });
  if (error) return { error: "Unable to send a reset email. Please try again later." };
  return { success: "If an account exists for that email, a reset link has been sent." };
}

export async function updatePassword(
  _previousState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = z.string().min(12, "Use at least 12 characters.").max(128)
    .safeParse(formData.get("password"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Enter a new password." };

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "Authentication is not configured. Add the Supabase values to .env.local." };

  const { data: { user }, error: sessionError } = await supabase.auth.getUser();
  if (sessionError || !user) return { error: "Your reset link has expired. Request a new one." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) return { error: "Unable to update your password. Please try again." };
  redirect("/");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  if (supabase) {
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(`Unable to sign out: ${error.message}`);
  }
  redirect("/login");
}
