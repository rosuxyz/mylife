import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import { AppShell } from "@/components/app-shell";
import { getProfileForUser } from "@/lib/supabase/profile";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MyLife — Your personal space",
  description:
    "A private space to bring your finances, working week, and personal goals together.",
};

export const instant = false;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  const { supabase, user } = await getAuthenticatedUser();
  let defaultTheme: "dark" | "light" | "system" = "dark";
  if (supabase && user) {
    const profile = await getProfileForUser(supabase, user, "theme");
    if (profile?.theme === "dark" || profile?.theme === "light" || profile?.theme === "system") {
      defaultTheme = profile.theme;
    }
  }
  return (
    <html lang="en" data-theme={defaultTheme} className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="min-h-full antialiased">
        <AppShell defaultTheme={defaultTheme} userEmail={user?.email ?? null}>{children}</AppShell>
      </body>
    </html>
  );
}
