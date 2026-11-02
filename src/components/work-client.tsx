"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  deleteDailyWorkHours,
  deleteWorkJobProfile,
  saveDailyWorkRecord,
  saveWorkJobProfile,
  type WorkActionState,
} from "@/app/actions/work";
import { chartColors, ChartEmpty, HoursChartTooltip, useChartAnimation, VisualizationCard } from "@/components/visualizations";
import { currencySymbol, formatMinorUnits } from "@/lib/money";

type WorkEntry = {
  id: string;
  work_date: string;
  hours_worked: number;
  currency_code: string;
  job_id: string | null;
  employer_snapshot: string;
  start_time: string | null;
  end_time: string | null;
  break_minutes: number | null;
  net_working_minutes: number | null;
  hourly_rate_snapshot_minor: number | null;
  calculated_earnings_minor: number | null;
  created_at: string;
  updated_at: string;
};

type JobProfile = {
  id: string;
  employer: string;
  title: string;
  currency_code: string;
  is_active: boolean;
  hourly_rate_minor: number | null;
};

type Totals = {
  week: number;
  month: number;
  year: number;
};

function ActionMessage({ state }: { state: WorkActionState }) {
  if (state.error) return <p className="form-message form-error" role="alert">{state.error}</p>;
  if (state.success) return <p className="form-message form-success" role="status">{state.success}</p>;
  return null;
}

function formatHours(value: number) {
  const rounded = Number(value.toFixed(2));
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(2).replace(/\.00$/, "")}h`;
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00Z`));
}

function formatLongDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function getWorkedHours(entry: WorkEntry) {
  return entry.net_working_minutes === null
    ? entry.hours_worked
    : entry.net_working_minutes / 60;
}

function elapsedMinutesBetween(startTime: string, endTime: string) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(startTime)
    || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(endTime)) return null;
  const start = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3, 5));
  const end = Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3, 5));
  const elapsed = end - start;
  return elapsed < 0 ? elapsed + 1440 : elapsed === 0 ? null : elapsed;
}

function parseRateMinor(value: string) {
  if (!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return hours && remainingMinutes
    ? `${hours}h ${remainingMinutes}m`
    : hours
      ? `${hours}h`
      : `${remainingMinutes}m`;
}

function JobProfileForm({ job }: { job?: JobProfile }) {
  const [state, action, pending] = useActionState(saveWorkJobProfile, {});
  return (
    <form action={action} className="domain-form compact-form">
      {job && <input name="jobId" type="hidden" value={job.id} />}
      <div className="form-grid">
        <label className="field-label">Employer<input defaultValue={job?.employer ?? ""} maxLength={120} name="employer" required /></label>
        <label className="field-label">Job title (optional)<input defaultValue={job?.title ?? ""} maxLength={120} name="title" /></label>
        <label className="field-label">
          Hourly rate (£/hour)
          <input
            defaultValue={job?.hourly_rate_minor === null || job?.hourly_rate_minor === undefined
              ? ""
              : (job.hourly_rate_minor / 100).toFixed(2)}
            max="1000000"
            min="0.01"
            name="rate"
            required
            step="0.01"
            type="number"
          />
        </label>
        {job && (
          <label className="field-label">
            Status
            <select defaultValue={job.is_active ? "true" : "false"} name="active">
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </label>
        )}
      </div>
      <ActionMessage state={state} />
      <button className="secondary-button" disabled={pending} type="submit">
        {pending ? "Saving…" : job ? "Save profile" : "Add Job Profile"}
      </button>
    </form>
  );
}

function JobProfileCard({ job }: { job: JobProfile }) {
  const [state, action, pending] = useActionState(deleteWorkJobProfile, {});
  return (
    <article className="job-profile-card">
      <div className="job-profile-summary">
        <div>
          <strong>{job.employer}</strong>
          {job.title && <span>{job.title}</span>}
        </div>
        <div className="job-profile-summary-meta">
          <strong>{job.hourly_rate_minor === null ? "No rate" : `${formatMinorUnits(job.hourly_rate_minor, job.currency_code)} / hour`}</strong>
          <span>{job.is_active ? "Active" : "Inactive"}</span>
        </div>
      </div>
      <details className="details-form job-profile-edit">
        <summary>Edit profile</summary>
        <JobProfileForm job={job} />
        <form action={action} className="inline-form">
          <input name="jobId" type="hidden" value={job.id} />
          <button className="link-button danger-link" disabled={pending} type="submit">
            {pending ? "Deleting…" : "Delete"}
          </button>
        </form>
        <ActionMessage state={state} />
      </details>
    </article>
  );
}

function buildDailyChartData(entries: WorkEntry[], today: string) {
  const entriesByDate = new Map<string, number>();
  for (const entry of entries) {
    entriesByDate.set(entry.work_date, getWorkedHours(entry));
  }

  const data: { work_date: string; label: string; hours: number }[] = [];
  const end = new Date(`${today}T12:00:00Z`);
  for (let offset = 13; offset >= 0; offset -= 1) {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - offset);
    const key = date.toISOString().slice(0, 10);
    data.push({
      work_date: key,
      label: new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(date),
      hours: entriesByDate.get(key) ?? 0,
    });
  }
  return data;
}

function buildTrendData(entries: WorkEntry[], today: string, granularity: "weekly" | "monthly", weekStartsOn: number) {
  const totals = new Map<string, number>();
  const periodStart = (value: string) => {
    const date = new Date(`${value}T12:00:00Z`);
    if (granularity === "monthly") {
      date.setUTCDate(1);
    } else {
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() - weekStartsOn + 7) % 7));
    }
    return date.toISOString().slice(0, 10);
  };
  for (const entry of entries) {
    const key = periodStart(entry.work_date);
    totals.set(key, (totals.get(key) ?? 0) + getWorkedHours(entry));
  }

  const current = new Date(`${periodStart(today)}T12:00:00Z`);
  const output: { period_start: string; label: string; hours: number }[] = [];
  for (let offset = 11; offset >= 0; offset -= 1) {
    const date = new Date(current);
    if (granularity === "monthly") date.setUTCMonth(date.getUTCMonth() - offset);
    else date.setUTCDate(date.getUTCDate() - 7 * offset);
    const key = date.toISOString().slice(0, 10);
    output.push({
      period_start: key,
      label: new Intl.DateTimeFormat("en-GB", {
        ...(granularity === "monthly" ? { month: "short" as const } : { day: "numeric" as const, month: "short" as const }),
        timeZone: "UTC",
      }).format(date),
      hours: totals.get(key) ?? 0,
    });
  }
  return output;
}

export function WorkClient({
  entries,
  jobs,
  totals,
  today,
  weekStartsOn,
  defaultBreakMinutes,
  defaultHourlyRateMinor,
  currencyCode,
  timezone,
}: {
  entries: WorkEntry[];
  jobs: JobProfile[];
  totals: Totals;
  today: string;
  weekStartsOn: number;
  defaultBreakMinutes: number;
  defaultHourlyRateMinor: number;
  currencyCode: string;
  timezone: string;
}) {
  const animateCharts = useChartAnimation();
  const [editingEntry, setEditingEntry] = useState<WorkEntry | null>(null);
  const [workDate, setWorkDate] = useState(today);
  const [correctingDate, setCorrectingDate] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [employerSnapshot, setEmployerSnapshot] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [breakMinutes, setBreakMinutes] = useState(String(defaultBreakMinutes));
  const [rateOverride, setRateOverride] = useState("");
  const [rateManuallyEdited, setRateManuallyEdited] = useState(false);
  const [trendGranularity, setTrendGranularity] = useState<"weekly" | "monthly">("weekly");
  const [saveState, saveAction, savePending] = useActionState(saveDailyWorkRecord, {});
  const [deleteState, deleteAction, deletePending] = useActionState(deleteDailyWorkHours, {});

  const dailyChart = useMemo(() => buildDailyChartData(entries, today), [entries, today]);
  const trendChart = useMemo(
    () => buildTrendData(entries, today, trendGranularity, weekStartsOn),
    [entries, today, trendGranularity, weekStartsOn],
  );

  function setEditEntry(entry: WorkEntry | null) {
    setEditingEntry(entry);
    setWorkDate(entry?.work_date ?? today);
    setCorrectingDate(false);
    setSelectedJobId(entry?.job_id ?? "");
    setEmployerSnapshot(entry?.employer_snapshot ?? "");
    setStartTime(entry?.start_time?.slice(0, 5) ?? "");
    setEndTime(entry?.end_time?.slice(0, 5) ?? "");
    setBreakMinutes(String(entry?.break_minutes ?? defaultBreakMinutes));
    setRateOverride("");
    setRateManuallyEdited(false);
  }

  const elapsedMinutes = elapsedMinutesBetween(startTime, endTime);
  const parsedBreakMinutes = /^\d{1,4}$/.test(breakMinutes) ? Number(breakMinutes) : null;
  const calculationIsValid = elapsedMinutes !== null
    && parsedBreakMinutes !== null
    && parsedBreakMinutes <= elapsedMinutes;
  const netWorkingMinutes = calculationIsValid
    ? elapsedMinutes - parsedBreakMinutes
    : null;
  const typedRateMinor = rateManuallyEdited ? parseRateMinor(rateOverride) : null;
  const rateInputIsValid = !rateManuallyEdited || (typedRateMinor !== null && typedRateMinor > 0);
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null;
  const earningsCurrencyCode = selectedJob?.currency_code ?? editingEntry?.currency_code ?? currencyCode;
  const retainEntryRate = Boolean(editingEntry && (!selectedJobId || selectedJobId === editingEntry.job_id));
  const hourlyRateMinor = rateManuallyEdited
    ? typedRateMinor ?? 0
    : (retainEntryRate ? editingEntry?.hourly_rate_snapshot_minor : selectedJob?.hourly_rate_minor)
      ?? (!selectedJobId ? defaultHourlyRateMinor : 0);
  const displayedRate = rateManuallyEdited
    ? rateOverride
    : hourlyRateMinor > 0
      ? (hourlyRateMinor / 100).toFixed(2)
      : "";
  const calculatedEarningsMinor = netWorkingMinutes === null || hourlyRateMinor <= 0
    ? null
    : Math.round(netWorkingMinutes * hourlyRateMinor / 60);

  const recentEntries = [...entries].sort((a, b) => b.work_date.localeCompare(a.work_date));

  return (
    <div className="module-page">
      <div className="module-heading">
        <div>
          <div className="eyebrow">DAILY HABIT TRACKER</div>
          <h1>Work tracker</h1>
          <p>Log your daily hours and automatically add calculated earnings to your default Finance account.</p>
        </div>
      </div>

      <section className="module-card">
        <div className="module-card-header">
          <h2>{editingEntry ? "Edit work record" : "Log today’s work"}</h2>
        </div>
        <form action={saveAction} className="domain-form">
          <input name="entryId" type="hidden" value={editingEntry?.id ?? ""} />
          <input name="workDate" type="hidden" value={workDate} />
          <input name="jobId" type="hidden" value={selectedJobId} />
          <input name="employerSnapshot" type="hidden" value={employerSnapshot} />
          <div className="form-grid">
            <div className="field-label">
              Working date
              <div className="work-date-display">
                <strong>{formatLongDate(workDate)}</strong>
                {!editingEntry && <small>Selected automatically for today · {timezone} local date</small>}
                {editingEntry && !correctingDate && (
                  <button className="link-button" onClick={() => setCorrectingDate(true)} type="button">
                    Correct date
                  </button>
                )}
              </div>
              {editingEntry && correctingDate && (
                <div className="work-date-correction">
                  <input
                    max={today}
                    min="2000-01-01"
                    onChange={(event) => setWorkDate(event.target.value)}
                    required
                    type="date"
                    value={workDate}
                  />
                  <button className="link-button" onClick={() => { setWorkDate(editingEntry.work_date); setCorrectingDate(false); }} type="button">
                    Keep original date
                  </button>
                </div>
              )}
            </div>
            <label className="field-label">
              Job Profile (optional)
              <select
                onChange={(event) => {
                  const id = event.target.value;
                  const job = jobs.find((profile) => profile.id === id);
                  setSelectedJobId(id);
                  if (job) setEmployerSnapshot(job.employer);
                  else if (!editingEntry) setEmployerSnapshot("");
                }}
                value={selectedJobId}
              >
                <option value="">No Job Profile</option>
                {jobs.filter((job) => job.is_active || job.id === editingEntry?.job_id).map((job) => (
                  <option disabled={!job.is_active} key={job.id} value={job.id}>
                    {job.employer}{job.title ? ` · ${job.title}` : ""}{job.is_active ? "" : " · Inactive"}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Employer
              <input
                maxLength={120}
                onChange={(event) => setEmployerSnapshot(event.target.value)}
                placeholder="Optional"
                value={employerSnapshot}
              />
            </label>
            <label className="field-label">
              From
              <input onChange={(event) => setStartTime(event.target.value)} required type="time" value={startTime} />
              <input name="startTime" type="hidden" value={startTime} />
            </label>
            <label className="field-label">
              To
              <input onChange={(event) => setEndTime(event.target.value)} required type="time" value={endTime} />
              <input name="endTime" type="hidden" value={endTime} />
            </label>
            <label className="field-label">
              Break duration (minutes)
              <input
                max={1440}
                min={0}
                name="breakMinutes"
                onChange={(event) => setBreakMinutes(event.target.value)}
                required
                step={1}
                type="number"
                value={breakMinutes}
              />
            </label>
            <label className="field-label">
              Hourly rate override ({currencySymbol(earningsCurrencyCode)}/hour, optional)
              <input
                max="1000000"
                min="0.01"
                name={rateManuallyEdited ? "rateOverride" : undefined}
                onChange={(event) => {
                  setRateOverride(event.target.value);
                  setRateManuallyEdited(true);
                }}
                placeholder="Use saved rate"
                step="0.01"
                type="number"
                value={displayedRate}
              />
              {rateManuallyEdited && (
                <button
                  className="link-button"
                  onClick={() => { setRateOverride(""); setRateManuallyEdited(false); }}
                  type="button"
                >
                  Use Job Profile or saved default
                </button>
              )}
              <small>
                {selectedJob && !rateManuallyEdited && !retainEntryRate
                  ? `Filled from ${selectedJob.employer}${selectedJob.title ? ` · ${selectedJob.title}` : ""}.`
                  : editingEntry?.hourly_rate_snapshot_minor && retainEntryRate
                  ? `This record’s saved rate is ${formatMinorUnits(editingEntry.hourly_rate_snapshot_minor, editingEntry.currency_code)} per hour.`
                  : !selectedJobId && defaultHourlyRateMinor > 0
                    ? `Saved default: ${formatMinorUnits(defaultHourlyRateMinor, earningsCurrencyCode)} per hour.`
                    : selectedJob && !selectedJob.hourly_rate_minor
                      ? "No rate is saved for this profile on this date."
                      : "Enter a rate override, or set a default rate in Settings."}
              </small>
            </label>
          </div>
          <div className="work-calculation" aria-live="polite">
            <div><span>Total elapsed</span><strong>{elapsedMinutes === null ? "—" : formatDuration(elapsedMinutes)}</strong></div>
            <div><span>Break</span><strong>{parsedBreakMinutes === null ? "—" : formatDuration(parsedBreakMinutes)}</strong></div>
            <div><span>Net working time</span><strong>{netWorkingMinutes === null ? "—" : formatDuration(netWorkingMinutes)}</strong></div>
            <div><span>Calculated earnings</span><strong>{calculatedEarningsMinor === null ? "—" : formatMinorUnits(calculatedEarningsMinor, earningsCurrencyCode)}</strong></div>
          </div>
          <p className="form-hint">Saving this work record adds its calculated earnings to your default Finance account as income. Editing or deleting the work record updates or removes that linked Finance entry.</p>
          {defaultHourlyRateMinor <= 0 && !rateOverride && !selectedJob?.hourly_rate_minor && !editingEntry?.hourly_rate_snapshot_minor && (
            <p className="form-help">Set a default hourly rate in <Link href="/settings">Settings</Link>, or enter an override above.</p>
          )}
          <ActionMessage state={saveState} />
          <div className="form-actions-row">
            <button className="primary-button" disabled={savePending || !calculationIsValid || !rateInputIsValid || calculatedEarningsMinor === null} type="submit">
              {savePending ? "Saving…" : editingEntry ? "Update work record" : "Save work record"}
            </button>
            {editingEntry && (
              <button className="secondary-button" onClick={() => setEditEntry(null)} type="button">
                Cancel edit
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="module-card">
        <div className="module-card-header">
          <div>
            <h2>Job Profiles</h2>
            <p className="module-card-subtitle">Optional saved employers and rates for faster work entries.</p>
          </div>
        </div>
        <div className="job-profile-list">
          {jobs.map((job) => <JobProfileCard job={job} key={job.id} />)}
          {jobs.length === 0 && <p className="empty-copy">No Job Profiles yet. You can still add work records with manual details.</p>}
        </div>
        <details className="details-form">
          <summary>Add a Job Profile</summary>
          <JobProfileForm />
        </details>
      </section>

      <section className="module-card stats-grid">
        <div className="stat-card">
          <span className="stat-label">This week</span>
          <strong>{formatHours(totals.week)}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">This month</span>
          <strong>{formatHours(totals.month)}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">This year</span>
          <strong>{formatHours(totals.year)}</strong>
        </div>
      </section>

      <div className="visualization-grid">
        <VisualizationCard title="Daily hours worked" subtitle="Recorded hours · last 14 days">
          {entries.length ? (
            <div className="visualization-plot">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyChart} margin={{ top: 8, right: 6, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border-soft)" strokeDasharray="3 5" vertical={false} />
                  <XAxis axisLine={false} dataKey="label" tick={{ fill: "var(--muted)", fontSize: 9 }} tickLine={false} />
                  <YAxis axisLine={false} tickFormatter={(value) => `${Number(value)}h`} tick={{ fill: "var(--muted)", fontSize: 9 }} tickLine={false} width={34} />
                  <Tooltip content={<HoursChartTooltip />} labelFormatter={(_label, payload) => payload?.[0]?.payload?.work_date ?? _label} />
                  <Bar animationDuration={450} isAnimationActive={animateCharts} dataKey="hours" fill={chartColors.hours} name="Hours worked" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <ChartEmpty message="No work hours logged yet. Add your first day to see your daily chart." />}
        </VisualizationCard>

        <VisualizationCard
          title="Work-hour trends"
          subtitle="Hours recorded per period"
          headerAction={
            <div aria-label="Work trend interval" className="trend-segmented" role="group">
              <button aria-pressed={trendGranularity === "weekly"} onClick={() => setTrendGranularity("weekly")} type="button">Weekly</button>
              <button aria-pressed={trendGranularity === "monthly"} onClick={() => setTrendGranularity("monthly")} type="button">Monthly</button>
            </div>
          }
        >
          {entries.length ? (
            <div className="visualization-plot">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendChart} margin={{ top: 8, right: 6, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border-soft)" strokeDasharray="3 5" vertical={false} />
                  <XAxis axisLine={false} dataKey="label" tick={{ fill: "var(--muted)", fontSize: 9 }} tickLine={false} />
                  <YAxis axisLine={false} tickFormatter={(value) => `${Number(value)}h`} tick={{ fill: "var(--muted)", fontSize: 9 }} tickLine={false} width={34} />
                  <Tooltip content={<HoursChartTooltip />} />
                  <Bar animationDuration={450} isAnimationActive={animateCharts} dataKey="hours" fill={chartColors.hours} name="Hours worked" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <ChartEmpty message="Log a day of work to see weekly and monthly trends." />}
        </VisualizationCard>
      </div>

      <section className="module-card">
        <div className="module-card-header">
          <h2>Daily history</h2>
        </div>
        {recentEntries.length === 0 ? (
          <p className="empty-copy">No work logged yet. Add your first day to get started.</p>
        ) : (
          <div className="history-list">
            {recentEntries.map((entry) => (
              <div className="history-row" key={entry.id}>
                <div>
                  <strong>{formatShortDate(entry.work_date)}</strong>
                  <small>
                    {entry.start_time && entry.end_time
                      ? `${entry.start_time.slice(0, 5)}–${entry.end_time.slice(0, 5)} · ${entry.break_minutes ?? 0}m break`
                      : `${entry.work_date} · hours-only record`}
                  </small>
                  {entry.employer_snapshot && <small>{entry.employer_snapshot}</small>}
                </div>
                <div>
                  <div className="history-hours">{formatHours(getWorkedHours(entry))}</div>
                  {entry.calculated_earnings_minor !== null && (
                    <small>{formatMinorUnits(entry.calculated_earnings_minor, entry.currency_code)}</small>
                  )}
                </div>
                <div className="history-actions">
                  <button className="link-button" onClick={() => setEditEntry(entry)} type="button">Edit</button>
                  <form action={deleteAction} className="inline-form">
                    <input name="entryId" type="hidden" value={entry.id} />
                    <button className="link-button danger-link" disabled={deletePending} type="submit">Delete</button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
        <ActionMessage state={deleteState} />
      </section>
    </div>
  );
}
