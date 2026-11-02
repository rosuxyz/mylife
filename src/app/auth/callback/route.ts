import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const allowedNextPaths = new Set(["/", "/reset-password"]);

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextPath = url.searchParams.get("next");
  const destination = nextPath && allowedNextPaths.has(nextPath) ? nextPath : "/";
  const supabase = await createSupabaseServerClient();

  if (!supabase || !code) {
    return NextResponse.redirect(new URL("/login?error=callback", request.url));
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("Supabase authentication callback failed:", error.message);
    const reason = /code verifier|pkce/i.test(error.message) ? "browser" : "confirmation";
    return NextResponse.redirect(new URL(`/login?error=${reason}`, request.url));
  }

  return NextResponse.redirect(new URL(destination, request.url));
}
