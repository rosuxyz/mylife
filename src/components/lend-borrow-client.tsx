"use client";

import { useActionState, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  deleteDebtPayment,
  deleteDebtRecord,
  recordDebtPayment,
  saveDebtRecord,
  type DebtActionState,
} from "@/app/actions/lend-borrow";
import { formatMinorUnits } from "@/lib/money";
import { getMonthKeys, getMonthLabel } from "@/lib/chart-data";
import { chartColors, ChartEmpty, MoneyChartTooltip, useChartAnimation, VisualizationCard } from "@/components/visualizations";

type DebtPayment = {
  id: string;
  debt_id: string;
  amount_minor: number;
  paid_at: string;
  note: string;
};

type DebtRecord = {
  id: string;
  person_name: string;
  direction: "lent" | "borrowed";
  amount_minor: number;
  occurred_at: string;
  note: string;
  status: string;
  payments: DebtPayment[];
};

function ActionMessage({ state }: { state: DebtActionState }) {
  if (state.error) return <p className="form-message form-error" role="alert">{state.error}</p>;
  if (state.success) return <p className="form-message form-success" role="status">{state.success}</p>;
  return null;
}

function formatMoney(value: number, currencyCode: string) {
  return formatMinorUnits(value, currencyCode);
}

function formatDateTimeLocal(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const getPart = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${getPart("year")}-${getPart("month")}-${getPart("day")}T${getPart("hour")}:${getPart("minute")}`;
}

function formatDisplayDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getOutstanding(record: DebtRecord) {
  const paidMinor = (record.payments ?? []).reduce((sum, payment) => sum + Number(payment.amount_minor ?? 0), 0);
  return Math.max(0, Number(record.amount_minor) - paidMinor);
}

function getDebtStatus(record: DebtRecord) {
  const outstanding = getOutstanding(record);
  if (outstanding === 0) return "repaid";
  if ((record.payments ?? []).length > 0) return "partially_repaid";
  return "outstanding";
}

function dateInTimezone(timezone: string, value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function LendBorrowClient({
  currencyCode,
  records,
  timezone,
  asOf,
}: {
  currencyCode: string;
  records: DebtRecord[];
  timezone: string;
  asOf: string;
}) {
  const animateCharts = useChartAnimation();
  const [recordState, recordAction, recordPending] = useActionState(saveDebtRecord, {});
  const [deleteRecordState, deleteRecordAction, deleteRecordPending] = useActionState(deleteDebtRecord, {});
  const [paymentState, paymentAction, paymentPending] = useActionState(recordDebtPayment, {});
  const [deletePaymentState, deletePaymentAction, deletePaymentPending] = useActionState(deleteDebtPayment, {});
  const [editingId, setEditingId] = useState<string | null>(null);

  const defaults = useMemo(() => formatDateTimeLocal(new Date(asOf), timezone), [asOf, timezone]);
  const selectedRecord = records.find((record) => record.id === editingId) ?? null;

  const summary = useMemo(() => {
    return records.reduce(
      (result, record) => {
        const outstanding = getOutstanding(record);
        if (record.direction === "lent") {
          result.lent += outstanding;
        } else {
          result.borrowed += outstanding;
        }
        return result;
      },
      { lent: 0, borrowed: 0 },
    );
  }, [records]);
  const today = dateInTimezone(timezone, asOf);
  const firstMonth = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
  firstMonth.setUTCMonth(firstMonth.getUTCMonth() - 11);
  const periods = getMonthKeys(`${firstMonth.toISOString().slice(0, 7)}-01`, today);
  const repaymentByMonth = new Map(periods.map((period) => [period, {
    period_start: period,
    label: getMonthLabel(period),
    lent: 0,
    borrowed: 0,
  }]));
  for (const record of records) {
    for (const payment of record.payments) {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
      }).formatToParts(new Date(payment.paid_at));
      const year = parts.find((part) => part.type === "year")?.value ?? "";
      const month = parts.find((part) => part.type === "month")?.value ?? "";
      const period = repaymentByMonth.get(`${year}-${month}-01`);
      if (period) period[record.direction] += Number(payment.amount_minor);
    }
  }
  const repaymentHistory = [...repaymentByMonth.values()];
  const outstanding = [
    { name: "Lent", value: summary.lent, color: chartColors.lent },
    { name: "Borrowed", value: summary.borrowed, color: chartColors.borrowed },
  ].filter((item) => item.value > 0);
  const hasRepayments = repaymentHistory.some((period) => period.lent > 0 || period.borrowed > 0);

  return (
    <div className="module-page">
      <div className="module-heading">
        <div>
          <div className="eyebrow">MONEY</div>
          <h1>Lend &amp; Borrow</h1>
          <p>Track what people owe you and what you owe.</p>
        </div>
      </div>

      <section className="module-card">
        <div className="module-card-header">
          <h2>Outstanding balances</h2>
        </div>
        <div className="lend-summary-grid">
          <div className="lend-summary-card">
            <span className="lend-summary-label">Lent to others</span>
            <strong>{formatMoney(summary.lent, currencyCode)}</strong>
            <span className="lend-summary-detail">Still owed to me</span>
          </div>
          <div className="lend-summary-card">
            <span className="lend-summary-label">Borrowed from others</span>
            <strong>{formatMoney(summary.borrowed, currencyCode)}</strong>
            <span className="lend-summary-detail">Still owed by me</span>
          </div>
        </div>
      </section>

      <div className="visualization-grid">
        <VisualizationCard title="Outstanding balance" subtitle="Money still owed to you compared with money you owe">
          {outstanding.length ? (
            <>
              <div className="visualization-plot visualization-plot-short">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      animationDuration={500}
                      data={outstanding}
                      dataKey="value"
                      innerRadius="57%"
                      nameKey="name"
                      outerRadius="82%"
                      paddingAngle={3}
                      isAnimationActive={animateCharts}
                      stroke="var(--card)"
                      strokeWidth={2}
                    >
                      {outstanding.map((item) => <Cell fill={item.color} key={item.name} />)}
                    </Pie>
                    <Tooltip content={<MoneyChartTooltip currencyCode={currencyCode} />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="visualization-legend">
                {outstanding.map((item) => (
                  <span className="visualization-legend-item" key={item.name}>
                    <i style={{ backgroundColor: item.color }} />
                    {item.name}: {formatMoney(item.value, currencyCode)}
                  </span>
                ))}
              </div>
            </>
          ) : <ChartEmpty message={records.length ? "All recorded balances are repaid. New outstanding amounts will appear here." : "No outstanding balances yet. Add a lend or borrow record to see the comparison."} />}
        </VisualizationCard>

        <VisualizationCard title="Repayment history" subtitle="Repayments by month · last 12 months">
          {hasRepayments ? (
            <>
              <div className="visualization-plot">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={repaymentHistory} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
                    <CartesianGrid stroke="var(--border-soft)" strokeDasharray="3 5" vertical={false} />
                    <XAxis axisLine={false} dataKey="label" tick={{ fill: "var(--muted)", fontSize: 10 }} tickLine={false} />
                    <YAxis axisLine={false} tickFormatter={(value) => formatMoney(Number(value), currencyCode)} tick={{ fill: "var(--muted)", fontSize: 9 }} tickLine={false} width={58} />
                    <Tooltip content={<MoneyChartTooltip currencyCode={currencyCode} />} />
                    <Bar animationDuration={500} isAnimationActive={animateCharts} dataKey="lent" fill={chartColors.lent} name="Repayments received" radius={[4, 4, 0, 0]} />
                    <Bar animationDuration={500} isAnimationActive={animateCharts} dataKey="borrowed" fill={chartColors.borrowed} name="Repayments made" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="visualization-legend">
                <span className="visualization-legend-item"><i style={{ backgroundColor: chartColors.lent }} />Repayments received</span>
                <span className="visualization-legend-item"><i style={{ backgroundColor: chartColors.borrowed }} />Repayments made</span>
              </div>
            </>
          ) : <ChartEmpty message="Repayment activity will appear here after you record a repayment." />}
        </VisualizationCard>
      </div>

      <section className="module-card">
        <div className="module-card-header">
          <h2>{editingId ? "Edit debt record" : "Add a debt record"}</h2>
        </div>
        <form key={editingId ?? "new-debt-record"} action={recordAction} className="domain-form">
          {editingId && <input name="id" type="hidden" value={editingId} />}
          <div className="form-grid">
            <label className="field-label">
              Person
              <input
                defaultValue={selectedRecord?.person_name ?? ""}
                maxLength={120}
                name="personName"
                placeholder="Alex Morgan"
                required
                type="text"
              />
            </label>
            <label className="field-label">
              Type
              <select defaultValue={selectedRecord?.direction ?? "lent"} name="direction">
                <option value="lent">Lent</option>
                <option value="borrowed">Borrowed</option>
              </select>
            </label>
            <label className="field-label">
              Amount
              <span className="money-input">
                <span>{new Intl.NumberFormat("en-GB", { style: "currency", currency: currencyCode }).formatToParts(0).find((part) => part.type === "currency")?.value ?? currencyCode}</span>
                <input
                  defaultValue={selectedRecord ? (selectedRecord.amount_minor / 100).toFixed(2) : ""}
                  min="0.01"
                  name="amount"
                  placeholder="0.00"
                  required
                  step="0.01"
                  type="number"
                />
              </span>
            </label>
            <label className="field-label">
              Date and time
              <input
                defaultValue={selectedRecord ? formatDateTimeLocal(new Date(selectedRecord.occurred_at), timezone) : defaults}
                name="occurredAt"
                required
                type="datetime-local"
              />
            </label>
            <label className="field-label field-wide">
              Notes
              <input defaultValue={selectedRecord?.note ?? ""} maxLength={2000} name="note" placeholder="Optional note" type="text" />
            </label>
          </div>
          <ActionMessage state={recordState} />
          <div className="form-actions-row">
            <button className="primary-button" disabled={recordPending} type="submit">
              {recordPending ? "Saving…" : editingId ? "Save changes" : "Add record"}
            </button>
            {editingId && (
              <button className="secondary-button" onClick={() => setEditingId(null)} type="button">
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="module-card">
        <div className="module-card-header">
          <h2>People and balances</h2>
        </div>
        {records.length === 0 ? (
          <p className="empty-copy">No lend or borrow records yet. Add the first one to get started.</p>
        ) : (
          <div className="debt-list">
            {records
              .slice()
              .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
              .map((record) => {
                const outstanding = getOutstanding(record);
                const status = getDebtStatus(record);
                return (
                  <div className="debt-card" key={record.id}>
                    <div className="debt-header">
                      <div>
                        <strong>{record.person_name}</strong>
                        <span className={`debt-pill debt-pill-${record.direction}`}>
                          {record.direction === "lent" ? "Lent" : "Borrowed"}
                        </span>
                      </div>
                      <span className={`status-badge status-${status}`}>{status.replace("_", " ")}</span>
                    </div>

                    <div className="debt-meta">
                      <span>Original: {formatMoney(record.amount_minor, currencyCode)}</span>
                      <span>Outstanding: {formatMoney(outstanding, currencyCode)}</span>
                    </div>

                    <div className="debt-date">{formatDisplayDateTime(record.occurred_at, timezone)}</div>
                    {record.note ? <p className="debt-note">{record.note}</p> : <p className="muted-copy">No note added.</p>}

                    {record.payments.length > 0 ? (
                      <div className="payment-list">
                        {record.payments
                          .slice()
                          .sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime())
                          .map((payment) => (
                            <div className="payment-row" key={payment.id}>
                              <div>
                                <strong>{formatMoney(payment.amount_minor, currencyCode)}</strong>
                                <small>{formatDisplayDateTime(payment.paid_at, timezone)}</small>
                              </div>
                              {payment.note ? <span>{payment.note}</span> : null}
                              <form action={deletePaymentAction} className="inline-form">
                                <input name="paymentId" type="hidden" value={payment.id} />
                                <button className="link-button danger-link" disabled={deletePaymentPending} type="submit">
                                  Remove
                                </button>
                              </form>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <p className="muted-copy">No repayments recorded yet.</p>
                    )}

                    <div className="debt-actions-row">
                      <button className="secondary-button" onClick={() => setEditingId(record.id)} type="button">
                        Edit
                      </button>
                      <form action={deleteRecordAction} className="inline-form">
                        <input name="id" type="hidden" value={record.id} />
                        <button className="link-button danger-link" disabled={deleteRecordPending} type="submit">
                          Delete
                        </button>
                      </form>
                    </div>

                    <form action={paymentAction} className="domain-form compact-form debt-payment-form">
                      <input name="debtId" type="hidden" value={record.id} />
                      <div className="form-grid compact-grid">
                        <label className="field-label">
                          Repayment
                          <span className="money-input">
                            <span>{new Intl.NumberFormat("en-GB", { style: "currency", currency: currencyCode }).formatToParts(0).find((part) => part.type === "currency")?.value ?? currencyCode}</span>
                            <input min="0.01" name="amount" placeholder="0.00" required step="0.01" type="number" />
                          </span>
                        </label>
                        <label className="field-label">
                          Date and time
                          <input defaultValue={defaults} name="paidAt" required type="datetime-local" />
                        </label>
                        <label className="field-label field-wide">
                          Payment note
                          <input maxLength={500} name="note" placeholder="Optional repayment note" type="text" />
                        </label>
                      </div>
                      <div className="form-actions-row compact-actions">
                        <button className="primary-button" disabled={paymentPending} type="submit">
                          {paymentPending ? "Saving…" : "Record repayment"}
                        </button>
                      </div>
                    </form>
                  </div>
                );
              })}
          </div>
        )}
        <ActionMessage state={deleteRecordState} />
        <ActionMessage state={paymentState} />
        <ActionMessage state={deletePaymentState} />
      </section>
    </div>
  );
}
