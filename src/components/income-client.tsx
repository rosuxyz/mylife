"use client";

import { useActionState, useMemo, useState } from "react";
import {
  addHourlyRate,
  addIncomePayment,
  createIncomeRecord,
  createJobWithRate,
  type IncomeActionState,
} from "@/app/actions/income";
import { currencySymbol, formatMinorUnits } from "@/lib/money";

type Job = { id: string; employer: string; title: string; currency_code: string };
type Rate = { job_id: string; hourly_rate_minor: number | string; overtime_rate_minor: number | string | null; effective_from: string; effective_to: string | null };
type Account = { id: string; name: string; currency_code: string };
type IncomeRecord = {
  id: string;
  source: string;
  frequency: string;
  expected_date: string | null;
  actual_date: string | null;
  status: string;
  currency_code: string;
  hours_worked_minutes: number;
  regular_earnings_minor: number;
  overtime_earnings_minor: number;
  additional_payments_minor: number;
  deductions_minor: number;
  gross_minor: number;
  net_expected_minor: number;
  actual_received_minor: number;
  notes: string;
  job: Job | null;
};
type Payment = { id: string; income_record_id: string; amount_minor: number; paid_at: string; notes: string };

function getEffectiveRate(rates: Rate[], jobId: string, date: string) {
  return rates
    .filter((rate) => rate.job_id === jobId && rate.effective_from <= date)
    .filter((rate) => rate.effective_to === null || rate.effective_to >= date)
    .sort((left, right) => right.effective_from.localeCompare(left.effective_from))[0] ?? null;
}

function getNextPaydayDate(today: string, paydayWeekday: number) {
  const date = new Date(`${today}T12:00:00Z`);
  const daysUntilPayday = (paydayWeekday - date.getUTCDay() + 7) % 7;
  date.setUTCDate(date.getUTCDate() + daysUntilPayday);
  return date.toISOString().slice(0, 10);
}

function ActionMessage({ state }: { state: IncomeActionState }) {
  if (state.error) return <p className="form-message form-error" role="alert">{state.error}</p>;
  if (state.success) return <p className="form-message form-success" role="status">{state.success}</p>;
  return null;
}

function MoneyField({ label, name, required = false, currencyCode = "GBP" }: { label: string; name: string; required?: boolean; currencyCode?: string }) {
  return (
    <label className="field-label">
      {label}
      <span className="money-input"><span>{currencySymbol(currencyCode)}</span><input min={required ? "0.01" : "0"} name={name} placeholder="0.00" required={required} step="0.01" type="number" /></span>
    </label>
  );
}

function IncomeRecordForm({ jobs, rates, currencyCode, today, paydayWeekday }: { jobs: Job[]; rates: Rate[]; currencyCode: string; today: string; paydayWeekday: number }) {
  const [state, action, pending] = useActionState(createIncomeRecord, {});
  const [jobId, setJobId] = useState("");
  const [source, setSource] = useState("");
  const [sourceWasEdited, setSourceWasEdited] = useState(false);
  const [hourlyRate, setHourlyRate] = useState("");
  const [hourlyRateWasEdited, setHourlyRateWasEdited] = useState(false);

  const selectedJob = jobs.find((job) => job.id === jobId) ?? null;
  const selectedRate = useMemo(
    () => getEffectiveRate(rates, jobId, today),
    [rates, jobId, today],
  );
  const selectedRateMinor = selectedRate ? Number(selectedRate.hourly_rate_minor) : null;

  return (
    <form action={action} className="domain-form">
      <div className="form-grid">
        <label className="field-label">
          Income source
          <input
            maxLength={120}
            name="source"
            onChange={(event) => {
              setSource(event.target.value);
              setSourceWasEdited(true);
            }}
            placeholder="Employer, client, or source"
            required
            value={source}
          />
        </label>
        <label className="field-label">
          Linked job
          <select
            name="jobId"
            onChange={(event) => {
              const nextJobId = event.target.value;
              const nextJob = jobs.find((job) => job.id === nextJobId);
              const nextRate = getEffectiveRate(rates, nextJobId, today);
              setJobId(nextJobId);
              if (!sourceWasEdited) {
                setSource(nextJob?.employer ?? "");
              }
              if (!hourlyRateWasEdited) {
                setHourlyRate(nextRate ? (Number(nextRate.hourly_rate_minor) / 100).toFixed(2) : "");
              }
            }}
            value={jobId}
          >
            <option value="">Not linked to a job</option>
            {jobs.map((job) => <option key={job.id} value={job.id}>{job.employer}{job.title ? ` · ${job.title}` : ""}</option>)}
          </select>
        </label>
        <label className="field-label">
          Frequency
          <select defaultValue="weekly" name="frequency">
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
            <option value="monthly">Monthly</option>
            <option value="irregular">Irregular</option>
            <option value="custom">Custom schedule</option>
          </select>
        </label>
        <label className="field-label">
          Hours worked
          <input min="0" name="hours" placeholder="e.g. 32.5" required step="0.01" type="number" />
        </label>
        <label className="field-label">
          Hourly rate
          <span className="money-input">
            <span>{currencySymbol(selectedJob?.currency_code ?? currencyCode)}</span>
            <input
              min="0.01"
              name="hourlyRate"
              onChange={(event) => {
                setHourlyRate(event.target.value);
                setHourlyRateWasEdited(true);
              }}
              placeholder="0.00"
              required
              step="0.01"
              type="number"
              value={hourlyRate}
            />
          </span>
          {selectedJob && (
            <small className="field-hint">
              {selectedRateMinor !== null
                ? `Profile rate: ${formatMinorUnits(selectedRateMinor, selectedJob.currency_code)} per hour.`
                : `No effective hourly rate was found for ${selectedJob.employer}.`}
            </small>
          )}
          {hourlyRateWasEdited && (
            <button
              className="link-button"
              onClick={() => {
                const nextRate = getEffectiveRate(rates, jobId, today);
                setHourlyRate(nextRate ? (Number(nextRate.hourly_rate_minor) / 100).toFixed(2) : "");
                setHourlyRateWasEdited(false);
              }}
              type="button"
            >
              Use selected job rate
            </button>
          )}
        </label>
        <MoneyField currencyCode={currencyCode} label="Overtime earnings" name="overtime" />
        <MoneyField currencyCode={currencyCode} label="Additional payments" name="additional" />
        <MoneyField currencyCode={currencyCode} label="Deductions" name="deductions" />
        <label className="field-label">
          Expected payday
          <input defaultValue={getNextPaydayDate(today, paydayWeekday)} name="expectedDate" type="date" />
        </label>
        <label className="field-label field-wide">
          Notes
          <input maxLength={4000} name="notes" placeholder="Optional notes" />
        </label>
      </div>
      <ActionMessage state={state} />
      <p className="form-hint">Estimated gross is calculated from hours × rate, overtime, and extras; deductions produce estimated net. No balance changes until payment reconciliation.</p>
      <button className="primary-button" disabled={pending} type="submit">{pending ? "Calculating…" : "Save expected income"}</button>
    </form>
  );
}

function JobForm({ currencyCode }: { currencyCode: string }) {
  const [state, action, pending] = useActionState(createJobWithRate, {});
  return (
    <form action={action} className="domain-form compact-form">
      <div className="form-grid">
        <label className="field-label">Employer<input maxLength={120} name="employer" required /></label>
        <label className="field-label">Job title<input maxLength={120} name="title" required /></label>
        <MoneyField currencyCode={currencyCode} label="Hourly rate" name="rate" required />
        <MoneyField currencyCode={currencyCode} label="Overtime hourly rate (optional)" name="overtimeRate" />
        <label className="field-label">Weekly overtime threshold (hours)<input min="0" name="overtimeThresholdHours" placeholder="Blank means no overtime rule" step="0.01" type="number" /></label>
        <label className="field-label">Overtime multiplier<input defaultValue="1.5" max="10" min="1" name="overtimeMultiplier" required step="0.001" type="number" /></label>
        <label className="field-label">Rate effective from<input name="effectiveFrom" required type="date" /></label>
      </div>
      <ActionMessage state={state} />
      <button className="secondary-button" disabled={pending} type="submit">{pending ? "Saving…" : "Add job and rate"}</button>
    </form>
  );
}

function RateForm({ jobs }: { jobs: Job[] }) {
  const [state, action, pending] = useActionState(addHourlyRate, {});
  const [jobId, setJobId] = useState(jobs[0]?.id ?? "");
  const currencyCode = jobs.find((job) => job.id === jobId)?.currency_code ?? "GBP";
  return (
    <form action={action} className="domain-form compact-form">
      <div className="form-grid">
        <label className="field-label">
          Job
          <select onChange={(event) => setJobId(event.target.value)} value={jobId} name="jobId" required>
            {jobs.map((job) => <option key={job.id} value={job.id}>{job.employer} · {job.title}</option>)}
          </select>
        </label>
        <MoneyField currencyCode={currencyCode} label="New hourly rate" name="rate" required />
        <MoneyField currencyCode={currencyCode} label="Overtime rate (optional)" name="overtimeRate" />
        <label className="field-label">Effective from<input name="effectiveFrom" required type="date" /></label>
      </div>
      <ActionMessage state={state} />
      <button className="secondary-button" disabled={pending || jobs.length === 0} type="submit">{pending ? "Saving…" : "Add rate history"}</button>
    </form>
  );
}

function ReconcileForm({
  record,
  accounts,
}: {
  record: IncomeRecord;
  accounts: Account[];
}) {
  const [state, action, pending] = useActionState(addIncomePayment, {});
  const openAmount = Math.max(0, record.net_expected_minor - record.actual_received_minor);
  return (
    <details className="reconcile-details">
      <summary>Reconcile payment</summary>
      <form action={action} className="domain-form compact-form">
        <input name="incomeRecordId" type="hidden" value={record.id} />
        <div className="form-grid">
          <label className="field-label">
            Deposit account
            <select defaultValue="" name="accountId" required>
              <option value="">Choose account</option>
              {accounts.filter((account) => account.currency_code === record.currency_code).map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </label>
          <MoneyField currencyCode={record.currency_code} label="Amount received" name="amount" required />
          <label className="field-label">Payment date<input name="paidOn" required type="date" /></label>
          <label className="field-label">
            Payment method
            <select defaultValue="bank_transfer" name="paymentMethod">
              <option value="bank_transfer">Bank transfer</option>
              <option value="cash">Cash</option>
              <option value="debit_card">Debit card</option>
              <option value="credit_card">Credit card</option>
              <option value="direct_debit">Direct debit</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="field-label field-wide">Notes<input maxLength={2000} name="notes" /></label>
        </div>
        <p className="form-hint">Remaining expected: {formatMinorUnits(openAmount, record.currency_code)}. Partial and excess payments are supported.</p>
        <ActionMessage state={state} />
        <button className="secondary-button" disabled={pending || accounts.every((account) => account.currency_code !== record.currency_code)} type="submit">
          {pending ? "Saving…" : "Record payment"}
        </button>
      </form>
    </details>
  );
}

export function IncomeClient({
  jobs,
  rates,
  records,
  payments,
  accounts,
  currencyCode,
  today,
  paydayWeekday,
}: {
  jobs: Job[];
  rates: Rate[];
  records: IncomeRecord[];
  payments: Payment[];
  accounts: Account[];
  currencyCode: string;
  today: string;
  paydayWeekday: number;
}) {
  const totals = records.reduce<Record<string, { outstanding: number; received: number }>>((result, record) => {
    const total = result[record.currency_code] ?? { outstanding: 0, received: 0 };
    total.outstanding += Math.max(0, record.net_expected_minor - record.actual_received_minor);
    total.received += record.actual_received_minor;
    result[record.currency_code] = total;
    return result;
  }, {});

  return (
    <div className="module-page">
      <div className="module-heading">
        <div>
          <div className="eyebrow">WEEKLY-FIRST PAY TRACKING</div>
          <h1>Income</h1>
          <p>Work Tracker earnings are added to Finance when saved. Avoid reconciling the same pay here, or it will be counted twice.</p>
        </div>
        <span className="connected-badge"><span /> Reconciled to ledger</span>
      </div>

      <div className="finance-summary-grid">
        {Object.entries(totals).map(([code, total]) => (
          <article className="finance-summary-card" key={code}>
            <span>Outstanding · {code}</span>
            <strong>{formatMinorUnits(total.outstanding, code)}</strong>
            <small>Received {formatMinorUnits(total.received, code)}</small>
          </article>
        ))}
        <article className="finance-summary-card"><span>Jobs and rates</span><strong>{jobs.length}</strong><small>Effective-dated historical rates</small></article>
      </div>

      <section className="module-card">
        <h2>Income records</h2>
        <p className="module-card-subtitle">Expected or pending earnings do not change account balances.</p>
        <div className="income-record-list">
          {records.map((record) => {
            const recordPayments = payments.filter((payment) => payment.income_record_id === record.id);
            return (
              <article className="income-record-card" key={record.id}>
                <div className="income-record-heading">
                  <div>
                    <strong>{record.source}</strong>
                    <span>{record.job ? `${record.job.employer} · ${record.job.title}` : record.frequency} · {record.expected_date ? `Expected ${record.expected_date}` : "No expected date"}</span>
                  </div>
                  <span className={`status-pill status-${record.status}`}>{record.status.replaceAll("_", " ")}</span>
                </div>
                <div className="income-amount-grid">
                  <span>Gross<strong>{formatMinorUnits(record.gross_minor, record.currency_code)}</strong></span>
                  <span>Net expected<strong>{formatMinorUnits(record.net_expected_minor, record.currency_code)}</strong></span>
                  <span>Received<strong>{formatMinorUnits(record.actual_received_minor, record.currency_code)}</strong></span>
                </div>
                <div className="income-breakdown">
                  <span>{(record.hours_worked_minutes / 60).toFixed(2)} hours</span>
                  <span>Regular {formatMinorUnits(record.regular_earnings_minor, record.currency_code)}</span>
                  <span>Overtime {formatMinorUnits(record.overtime_earnings_minor, record.currency_code)}</span>
                  <span>Extras {formatMinorUnits(record.additional_payments_minor, record.currency_code)}</span>
                  <span>Deductions {formatMinorUnits(record.deductions_minor, record.currency_code)}</span>
                </div>
                {recordPayments.length > 0 && (
                  <div className="payment-history">
                    <span>Payments received:</span>
                    {recordPayments.map((payment) => (
                      <span key={payment.id}>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(payment.paid_at))} · {formatMinorUnits(payment.amount_minor, record.currency_code)}</span>
                    ))}
                  </div>
                )}
                {record.status !== "received" && <ReconcileForm accounts={accounts} record={record} />}
              </article>
            );
          })}
          {records.length === 0 && <p className="empty-copy">No income records yet. Add an estimate below; it will not count as received income.</p>}
        </div>
      </section>

      <div className="module-columns income-forms-grid">
        <section className="module-card">
          <h2>Record expected income</h2>
          <p className="module-card-subtitle">Calculations use integer minor units and remain separate from your cash balance.</p>
          <IncomeRecordForm currencyCode={currencyCode} jobs={jobs} rates={rates} paydayWeekday={paydayWeekday} today={today} />
        </section>
        <section className="module-card">
          <h2>Jobs and hourly rates</h2>
          <p className="module-card-subtitle">Changing a rate never rewrites completed shift snapshots.</p>
          <div className="job-list">
            {jobs.map((job) => {
              const jobRates = rates.filter((rate) => rate.job_id === job.id);
              return (
                <div className="job-row" key={job.id}>
                  <strong>{job.employer}<span>{job.title}</span></strong>
                  <span>{jobRates.map((rate) => `${formatMinorUnits(Number(rate.hourly_rate_minor), job.currency_code)} · from ${rate.effective_from}${rate.effective_to ? ` to ${rate.effective_to}` : ""}`).join(" / ")}</span>
                </div>
              );
            })}
            {jobs.length === 0 && <p className="empty-copy">Add an employer and rate to clock in and calculate shift earnings.</p>}
          </div>
          <details className="details-form">
            <summary>Add a job</summary>
            <JobForm currencyCode={currencyCode} />
          </details>
          {jobs.length > 0 && (
            <details className="details-form">
              <summary>Change a rate</summary>
              <RateForm jobs={jobs} />
            </details>
          )}
        </section>
      </div>
    </div>
  );
}
