"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { deleteAccount, updateSettings, type SettingsActionState } from "@/app/actions/settings";

type Job = { id: string; employer: string; title: string };
type Settings = {
  display_name: string;
  currency_code: string;
  timezone: string;
  week_starts_on: number;
  default_payday_weekday: number;
  default_break_minutes: number;
  default_hourly_rate_minor: number;
  default_job_id: string | null;
  theme: "dark" | "light" | "system";
};

function ActionMessage({ state }: { state: SettingsActionState }) {
  if (state.error) return <p className="form-message form-error" role="alert">{state.error}</p>;
  if (state.success) return <p className="form-message form-success" role="status">{state.success}</p>;
  return null;
}

function SettingsForm({ profile, jobs }: { profile: Settings; jobs: Job[] }) {
  const [state, action, pending] = useActionState(updateSettings, {});
  useEffect(() => {
    if (!state.theme) return;
    window.localStorage.setItem("mylife-theme", state.theme);
    document.documentElement.dataset.theme = state.theme;
    window.dispatchEvent(new Event("mylife-theme-change"));
  }, [state.theme]);
  return (
    <form action={action} className="settings-form">
      <section className="settings-section">
        <h2>Personal</h2>
        <p>These preferences control date display and future entries.</p>
        <div className="form-grid">
          <label className="field-label">Display name<input defaultValue={profile.display_name} maxLength={100} name="displayName" /></label>
          <label className="field-label">Default currency<select defaultValue={profile.currency_code} name="currencyCode"><option value="GBP">GBP · Pound sterling</option><option value="USD">USD · US dollar</option><option value="EUR">EUR · Euro</option><option value="CAD">CAD · Canadian dollar</option><option value="AUD">AUD · Australian dollar</option><option value="NZD">NZD · New Zealand dollar</option><option value="INR">INR · Indian rupee</option></select></label>
          <label className="field-label">Timezone<input defaultValue={profile.timezone} maxLength={100} name="timezone" placeholder="Europe/London" required /></label>
          <label className="field-label">Working week starts<select defaultValue={String(profile.week_starts_on)} name="weekStartsOn"><option value="0">Sunday</option><option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option></select></label>
        </div>
      </section>
      <section className="settings-section">
        <h2>Income preferences</h2>
        <p>Choose your usual payday. New expected income records will use this weekday, and you can change each date when needed.</p>
        <div className="form-grid">
          <label className="field-label">Usual payday
            <select defaultValue={String(profile.default_payday_weekday)} name="paydayWeekday">
              <option value="0">Sunday</option>
              <option value="1">Monday</option>
              <option value="2">Tuesday</option>
              <option value="3">Wednesday</option>
              <option value="4">Thursday</option>
              <option value="5">Friday</option>
              <option value="6">Saturday</option>
            </select>
          </label>
        </div>
      </section>
      <section className="settings-section">
        <h2>Work preferences</h2>
        <p>Set the rate and unpaid break MyLife uses by default for daily work entries.</p>
        <div className="form-grid">
          <label className="field-label">Default hourly rate (£/hour)<input defaultValue={(profile.default_hourly_rate_minor / 100).toFixed(2)} min="0" name="defaultHourlyRate" required step="0.01" type="number" /></label>
          <label className="field-label">Default unpaid break (minutes)<input defaultValue={profile.default_break_minutes} max="1440" min="0" name="defaultBreakMinutes" required type="number" /></label>
          <label className="field-label">Default job<select defaultValue={profile.default_job_id ?? ""} name="defaultJobId"><option value="">No default job</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.employer} · {job.title}</option>)}</select></label>
        </div>
      </section>
      <section className="settings-section">
        <h2>Appearance</h2>
        <p>Your appearance choice is saved to your profile and browser.</p>
        <label className="field-label settings-theme-field">Theme<select defaultValue={profile.theme} name="theme"><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select></label>
      </section>
      <ActionMessage state={state} />
      <button className="primary-button" disabled={pending} type="submit">{pending ? "Saving…" : "Save settings"}</button>
    </form>
  );
}

function DeleteAccountForm() {
  const [state, action, pending] = useActionState(deleteAccount, {});
  return (
    <form action={action} className="delete-account-form">
      <p>This permanently deletes your account and its records. Export your data first; deleted records cannot be restored by MyLife.</p>
      <label className="field-label">Type DELETE to confirm<input autoComplete="off" name="confirmation" required /></label>
      <ActionMessage state={state} />
      <button className="danger-button" disabled={pending} type="submit">{pending ? "Deleting…" : "Delete account and data"}</button>
    </form>
  );
}

export function SettingsClient({
  profile,
  jobs,
  email,
}: {
  profile: Settings;
  jobs: Job[];
  email: string;
}) {
  return (
    <div className="module-page">
      <div className="module-heading">
        <div><div className="eyebrow">YOUR ACCOUNT, YOUR PREFERENCES</div><h1>Settings</h1><p>Personalise MyLife and manage your data.</p></div>
        <span className="connected-badge"><span /> Authenticated</span>
      </div>
      <section className="module-card settings-account-card">
        <div><h2>Account</h2><p>{email}</p></div>
        <div className="settings-account-links"><Link href="/forgot-password">Change password</Link><Link href="/finance">Manage accounts & categories</Link></div>
      </section>
      <section className="module-card settings-main-card">
        <SettingsForm jobs={jobs} profile={profile} />
      </section>
      <section className="module-card settings-main-card">
        <h2>Export your data</h2>
        <p className="module-card-subtitle">Exports are private, generated from your account records, and downloaded directly to this device.</p>
        <div className="export-links">
          <a href="/api/export?type=transactions">Transactions CSV</a>
          <a href="/api/export?type=income">Income CSV</a>
          <a href="/api/export?type=work">Work history CSV</a>
          <a href="/api/export?type=backup">Full JSON backup</a>
        </div>
      </section>
      <section className="module-card settings-main-card danger-zone">
        <h2>Delete account</h2>
        <DeleteAccountForm />
      </section>
    </div>
  );
}
