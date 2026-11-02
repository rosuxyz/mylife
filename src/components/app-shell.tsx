"use client";

import {
  Banknote,
  Bell,
  ChartNoAxesCombined,
  ChevronDown,
  Clock3,
  HandCoins,
  LayoutDashboard,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
  Sun,
  Target,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { signOut } from "@/app/auth/actions";
import { updateThemePreference } from "@/app/actions/settings";

type Theme = "dark" | "light" | "system";

const navigation = [
  { label: "Overview", icon: LayoutDashboard, href: "/", available: true },
  { label: "Finance", icon: Wallet, href: "/finance", available: true },
  { label: "Lend & Borrow", icon: HandCoins, href: "/lend-borrow", available: true },
  { label: "Income", icon: Banknote, href: "/income", available: true },
  { label: "Work tracker", icon: Clock3, href: "/work", available: true },
  { label: "Analytics", icon: ChartNoAxesCombined, href: "/analytics", available: true },
  { label: "Goals", icon: Target, href: "/goals", available: true },
];

const themeOptions: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Settings },
];

function getThemeSnapshot(defaultTheme: Theme): Theme {
  const savedTheme = window.localStorage.getItem("mylife-theme");
  return savedTheme === "dark" || savedTheme === "light" || savedTheme === "system"
    ? savedTheme
    : defaultTheme;
}

function subscribeToTheme(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener("mylife-theme-change", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("mylife-theme-change", onChange);
  };
}

function saveTheme(theme: Theme) {
  window.localStorage.setItem("mylife-theme", theme);
  document.documentElement.dataset.theme = theme;
  window.dispatchEvent(new Event("mylife-theme-change"));
}

function getTodayLabel() {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date());
}

function getThemeLabel(theme: Theme) {
  return themeOptions.find((option) => option.value === theme)?.label ?? "Dark";
}

export function AppShell({
  children,
  defaultTheme,
  userEmail,
}: {
  children: React.ReactNode;
  defaultTheme: Theme;
  userEmail: string | null;
}) {
  const pathname = usePathname();
  const theme = useSyncExternalStore(
    subscribeToTheme,
    () => getThemeSnapshot(defaultTheme),
    () => defaultTheme,
  );
  const [todayLabel, setTodayLabel] = useState("Today");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [themeSaveError, setThemeSaveError] = useState("");
  const [isSavingTheme, startThemeSave] = useTransition();

  useEffect(() => {
    const updateLabel = () => setTodayLabel(getTodayLabel());
    const initialUpdate = window.setTimeout(updateLabel, 0);
    const interval = window.setInterval(() => setTodayLabel(getTodayLabel()), 60_000);
    return () => {
      window.clearTimeout(initialUpdate);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!mobileOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileOpen(false);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileOpen]);

  function cycleTheme() {
    const currentIndex = themeOptions.findIndex((option) => option.value === theme);
    const nextTheme = themeOptions[(currentIndex + 1) % themeOptions.length].value;
    saveTheme(nextTheme);
    setThemeSaveError("");
    if (userEmail) {
      startThemeSave(async () => {
        const result = await updateThemePreference(nextTheme);
        setThemeSaveError(result.error ?? "");
      });
    }
  }

  const ThemeIcon =
    themeOptions.find((option) => option.value === theme)?.icon ?? Moon;
  const isAuthPage = [
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
  ].includes(pathname);

  if (isAuthPage) return <>{children}</>;

  return (
    <div className={`app-layout${collapsed ? " sidebar-collapsed" : ""}`}>
      {mobileOpen && (
        <button
          aria-label="Close navigation"
          className="sidebar-backdrop"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside className={`sidebar${mobileOpen ? " sidebar-mobile-open" : ""}`}>
        <div className="sidebar-brand">
          <div className="brand-mark" aria-hidden="true">
            <Sparkles size={18} strokeWidth={2.2} />
          </div>
          <span className="brand-name">mylife</span>
          <button
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            className="icon-button sidebar-collapse"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
          <button
            aria-label="Close navigation"
            className="icon-button sidebar-mobile-close"
            onClick={() => setMobileOpen(false)}
          >
            <X size={18} />
          </button>
        </div>

        <div className="workspace-switcher">
          <div className="workspace-avatar">M</div>
          <div className="workspace-copy">
            <span className="workspace-label">PERSONAL SPACE</span>
            <span className="workspace-name">My workspace</span>
          </div>
          <ChevronDown className="workspace-chevron" size={15} />
        </div>

        <nav aria-label="Main navigation" className="main-navigation">
          <span className="nav-section-label">Workspace</span>
          {navigation.map(({ label, icon: Icon, href, available }) =>
            available ? (
              <Link
                aria-current={pathname === href ? "page" : undefined}
                className={`nav-item${pathname === href ? " nav-item-active" : ""}`}
                href={href}
                key={label}
                onClick={() => setMobileOpen(false)}
                title={collapsed ? label : undefined}
              >
                <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                <span className="nav-label">{label}</span>
              </Link>
            ) : (
              <div
                aria-disabled="true"
                className="nav-item nav-item-disabled"
                key={label}
                title={`${label} will be added in a later phase`}
              >
                <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                <span className="nav-label">{label}</span>
                <span className="nav-soon">Soon</span>
              </div>
            ),
          )}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-divider" />
          <Link className={`nav-item settings-item${pathname === "/settings" ? " nav-item-active" : ""}`} href="/settings">
            <Settings aria-hidden="true" size={18} strokeWidth={1.8} />
            <span className="nav-label">Settings</span>
          </Link>
          <div className="profile-card">
            <div className="profile-avatar">M</div>
            <div className="profile-copy">
              <span className="profile-name">{userEmail ?? "MyLife"}</span>
              {userEmail ? (
                <span className="profile-caption">Signed in</span>
              ) : (
                <span className="profile-caption">
                  <Link className="profile-link" href="/login">Sign in</Link>
                  <span aria-hidden="true"> · </span>
                  <Link className="profile-link" href="/signup">Create account</Link>
                </span>
              )}
            </div>
            {userEmail && (
              <form action={signOut}>
                <button aria-label="Sign out" className="signout-button" title="Sign out" type="submit">
                  <ChevronDown className="profile-chevron" size={15} />
                </button>
              </form>
            )}
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            <button
              aria-label="Open navigation"
              className="icon-button mobile-menu-button"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={19} />
            </button>
            <div className="breadcrumb">
              <span className="breadcrumb-muted">Workspace</span>
              <span aria-hidden="true" className="breadcrumb-separator">/</span>
              <span className="breadcrumb-current">Overview</span>
            </div>
          </div>
          <div className="topbar-actions">
            <span className="today-label">
              {todayLabel}
            </span>
            <span aria-hidden="true" className="topbar-divider" />
            <button
              aria-label={`Current theme: ${getThemeLabel(theme)}. Change theme`}
              className="theme-button"
              disabled={isSavingTheme}
              onClick={cycleTheme}
              title="Change theme"
            >
              <ThemeIcon aria-hidden="true" size={16} />
              <span>{getThemeLabel(theme)}</span>
              <ChevronDown aria-hidden="true" className="theme-chevron" size={14} />
            </button>
            <button
              aria-label="Notifications are not available yet"
              className="icon-button notification-button"
              disabled
              title="Notifications will be available in a later phase"
            >
              <Bell size={18} />
              <span className="notification-dot" />
            </button>
          </div>
        </header>
        {themeSaveError && <p className="theme-save-error" role="alert">{themeSaveError}</p>}
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}
