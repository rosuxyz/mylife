"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  requestPasswordReset,
  signIn,
  signUp,
  updatePassword,
  type AuthState,
} from "@/app/auth/actions";

type AuthMode = "login" | "signup" | "reset" | "update-password";

const actions = {
  login: signIn,
  signup: signUp,
  reset: requestPasswordReset,
  "update-password": updatePassword,
} satisfies Record<AuthMode, (state: AuthState, formData: FormData) => Promise<AuthState>>;

const content: Record<AuthMode, { title: string; subtitle: string; button: string }> = {
  login: { title: "Welcome back", subtitle: "Sign in to your private space.", button: "Sign in" },
  signup: { title: "Create your account", subtitle: "Start building your personal space.", button: "Create account" },
  reset: { title: "Reset your password", subtitle: "We’ll send a secure reset link if the account exists.", button: "Send reset link" },
  "update-password": { title: "Choose a new password", subtitle: "Use at least 12 characters for your new password.", button: "Update password" },
};

export function AuthForm({ mode, notice }: { mode: AuthMode; notice?: string }) {
  const [state, action, pending] = useActionState(actions[mode], {});
  const copy = content[mode];

  return (
    <main className="auth-page">
      <section aria-labelledby="auth-title" className="auth-card">
        <Link aria-label="MyLife home" className="auth-brand" href="/">
          <span className="auth-brand-mark">✳</span> mylife
        </Link>
        <h1 id="auth-title">{copy.title}</h1>
        <p className="auth-subtitle">{copy.subtitle}</p>
        {notice && <p className="auth-message auth-error" role="alert">{notice}</p>}
        <form action={action} className="auth-form">
          {mode === "signup" && (
            <label>
              Name
              <input autoComplete="name" maxLength={100} name="name" required />
            </label>
          )}
          {mode !== "update-password" && (
            <label>
              Email
              <input autoComplete="email" maxLength={254} name="email" required type="email" />
            </label>
          )}
          {(mode === "login" || mode === "signup") && (
            <label>
              Password
              <input
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                maxLength={128}
                minLength={8}
                name="password"
                required
                type="password"
              />
            </label>
          )}
          {mode === "update-password" && (
            <label>
              New password
              <input autoComplete="new-password" maxLength={128} minLength={12} name="password" required type="password" />
            </label>
          )}
          {state.error && <p className="auth-message auth-error" role="alert">{state.error}</p>}
          {state.success && <p className="auth-message auth-success" role="status">{state.success}</p>}
          <button className="auth-submit" disabled={pending} type="submit">
            {pending ? "Please wait…" : copy.button}
          </button>
        </form>
        <div className="auth-links">
          {(mode === "login" || mode === "signup") && (
            <Link href={mode === "login" ? "/signup" : "/login"}>
              {mode === "login" ? "Create an account" : "Already have an account? Sign in"}
            </Link>
          )}
          {mode === "login" && <Link href="/forgot-password">Forgot password?</Link>}
          {mode === "reset" && <Link href="/login">Back to sign in</Link>}
        </div>
        <p className="auth-privacy">Your financial information is private to your account.</p>
      </section>
    </main>
  );
}
