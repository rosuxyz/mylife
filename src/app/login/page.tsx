import { AuthForm } from "@/components/auth-form";

export const instant = false;

type Props = { searchParams: Promise<{ error?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const { error } = await searchParams;
  const notice = error === "browser"
    ? "This confirmation link was opened without the browser session that created it. Open the latest email on the same browser and device where you signed up, or request a new confirmation email."
    : error === "confirmation" || error === "callback"
      ? "This confirmation link is expired or invalid. Request a fresh confirmation email, then open it in the same browser where you signed up."
      : undefined;
  return <AuthForm mode="login" notice={notice} />;
}
