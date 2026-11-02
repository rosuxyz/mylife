"use client";

import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buildBalanceHistory, getMonthKeys, getMonthLabel } from "@/lib/chart-data";
import { formatMinorUnits } from "@/lib/money";
import { chartColors, ChartEmpty, HoursChartTooltip, MoneyChartTooltip, useChartAnimation, VisualizationCard } from "@/components/visualizations";

type Account = {
  id: string;
  name: string;
  account_type: string;
  currency_code: string;
  balance_minor: number;
};
type Transaction = {
  id: string;
  kind: "income" | "expense" | "transfer";
  description: string;
  amount_minor: number;
  currency_code: string;
  occurred_at: string;
};
type TrendTransaction = {
  kind: "income" | "expense" | "transfer";
  amount_minor: number;
  currency_code: string;
  occurred_at: string;
  account_id: string | null;
  from_account_id: string | null;
  to_account_id: string | null;
};
type FinancialPoint = {
  period_start: string;
  kind: "income" | "expense";
  currency_code: string;
  amount_minor: number;
};
type WorkPoint = { work_date: string; hours_worked: number };

function buildFinancialTrend(points: FinancialPoint[], periods: string[], currencyCode: string) {
  const values = new Map<string, { period_start: string; income: number; expenses: number }>();
  for (const period of periods) values.set(period, { period_start: period, income: 0, expenses: 0 });
  for (const point of points) {
    if (point.currency_code !== currencyCode) continue;
    const value = values.get(point.period_start);
    if (!value) continue;
    if (point.kind === "income") value.income += Number(point.amount_minor);
    if (point.kind === "expense") value.expenses += Number(point.amount_minor);
  }
  return [...values.values()].map((item) => ({ ...item, label: getMonthLabel(item.period_start) }));
}

function buildWeeklyWork(work: WorkPoint[], from: string, to: string, weekStartsOn: number) {
  const byWeek = new Map<string, number>();
  for (const point of work) {
    const date = new Date(`${point.work_date}T12:00:00Z`);
    const offset = (date.getUTCDay() - weekStartsOn + 7) % 7;
    date.setUTCDate(date.getUTCDate() - offset);
    const key = date.toISOString().slice(0, 10);
    byWeek.set(key, (byWeek.get(key) ?? 0) + Number(point.hours_worked));
  }

  const data: { week_start: string; label: string; hours: number }[] = [];
  for (let date = new Date(`${from}T12:00:00Z`), end = new Date(`${to}T12:00:00Z`); date <= end; date.setUTCDate(date.getUTCDate() + 7)) {
    const key = date.toISOString().slice(0, 10);
    data.push({
      week_start: key,
      label: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(date),
      hours: byWeek.get(key) ?? 0,
    });
  }
  return data;
}

function formatDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: timezone }).format(new Date(value));
}

export function ConnectedDashboard({
  accounts,
  recentTransactions,
  trendTransactions,
  financial,
  work,
  currencyCode,
  timezone,
  from,
  to,
  monthStart,
  workFrom,
  weekStartsOn,
  weekHours,
  monthHours,
  asOf,
}: {
  accounts: Account[];
  recentTransactions: Transaction[];
  trendTransactions: TrendTransaction[];
  financial: FinancialPoint[];
  work: WorkPoint[];
  currencyCode: string;
  timezone: string;
  from: string;
  to: string;
  monthStart: string;
  workFrom: string;
  weekStartsOn: number;
  weekHours: number;
  monthHours: number;
  asOf: string;
}) {
  const animateCharts = useChartAnimation();
  const periods = getMonthKeys(from, to);
  const cashflow = buildFinancialTrend(financial, periods, currencyCode);
  const balanceTrend = buildBalanceHistory({ accounts, transactions: trendTransactions, periods, currencyCode, timezone, asOf });
  const workTrend = buildWeeklyWork(work, workFrom, to, weekStartsOn);
  const monthFinancial = cashflow.find((item) => item.period_start === monthStart);
  const balance = accounts
    .filter((account) => account.currency_code === currencyCode)
    .reduce((sum, account) => sum + Number(account.balance_minor), 0);
  const savings = accounts
    .filter((account) => account.currency_code === currencyCode && account.account_type === "savings")
    .reduce((sum, account) => sum + Number(account.balance_minor), 0);
  const hasFinancialData = financial.some((item) => item.currency_code === currencyCode);
  const hasWorkData = work.length > 0;

  return (
    <div className="dashboard-page connected-dashboard">
      <div className="dashboard-heading">
        <div>
          <div className="eyebrow">YOUR PERSONAL SPACE</div>
          <h1>Overview</h1>
          <p className="page-subtitle">A current snapshot of your private records.</p>
        </div>
        <span className="connected-badge"><span /> Live account data</span>
      </div>

      <div className="finance-summary-grid">
        <article className="finance-summary-card"><span>Available balance · {currencyCode}</span><strong>{formatMinorUnits(balance, currencyCode)}</strong><small>Across accounts in your currency</small></article>
        <article className="finance-summary-card"><span>Income received this month</span><strong>{formatMinorUnits(monthFinancial?.income ?? 0, currencyCode)}</strong><small>Posted transactions only</small></article>
        <article className="finance-summary-card"><span>Expenses this month</span><strong>{formatMinorUnits(monthFinancial?.expenses ?? 0, currencyCode)}</strong><small>Transfers are excluded</small></article>
        <article className="finance-summary-card"><span>Savings account balance</span><strong>{formatMinorUnits(savings, currencyCode)}</strong><small>Current balance across savings accounts</small></article>
      </div>

      <div className="visualization-grid">
        <VisualizationCard title="Income vs expenses" subtitle="Monthly totals · last 12 months">
          {hasFinancialData ? (
            <div className="visualization-plot">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cashflow} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border-soft)" strokeDasharray="3 5" vertical={false} />
                  <XAxis axisLine={false} dataKey="label" tick={{ fill: "var(--muted)", fontSize: 10 }} tickLine={false} />
                  <YAxis axisLine={false} tickFormatter={(value) => formatMinorUnits(Number(value), currencyCode)} tick={{ fill: "var(--muted)", fontSize: 9 }} tickLine={false} width={58} />
                  <Tooltip content={<MoneyChartTooltip currencyCode={currencyCode} />} />
                  <Bar animationDuration={500} isAnimationActive={animateCharts} dataKey="income" fill={chartColors.income} name="Income received" radius={[4, 4, 0, 0]} />
                  <Bar animationDuration={500} isAnimationActive={animateCharts} dataKey="expenses" fill={chartColors.expense} name="Expenses" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <ChartEmpty message="No income or expenses recorded yet. Add a transaction to see your monthly trend." />}
          {hasFinancialData && (
            <div className="visualization-legend">
              <span className="visualization-legend-item"><i style={{ backgroundColor: chartColors.income }} />Income received</span>
              <span className="visualization-legend-item"><i style={{ backgroundColor: chartColors.expense }} />Expenses</span>
            </div>
          )}
        </VisualizationCard>

        <VisualizationCard title="Account balance" subtitle="Reconstructed from your account balances and transaction history">
          {balanceTrend.length ? (
            <div className="visualization-plot">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={balanceTrend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border-soft)" strokeDasharray="3 5" vertical={false} />
                  <XAxis axisLine={false} dataKey="label" tick={{ fill: "var(--muted)", fontSize: 10 }} tickLine={false} />
                  <YAxis axisLine={false} tickFormatter={(value) => formatMinorUnits(Number(value), currencyCode)} tick={{ fill: "var(--muted)", fontSize: 9 }} tickLine={false} width={58} />
                  <Tooltip content={<MoneyChartTooltip currencyCode={currencyCode} />} />
                  <Line animationDuration={550} isAnimationActive={animateCharts} dataKey="balance" dot={false} name="Available balance" stroke={chartColors.balance} strokeWidth={2.2} type="monotone" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <ChartEmpty message="Add an account to see your balance history." />}
        </VisualizationCard>

        <VisualizationCard title="Weekly work hours" subtitle={`Last 12 weeks · ${weekHours.toFixed(1)} hours this week`}>
          {hasWorkData ? (
            <div className="visualization-plot visualization-plot-short">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={workTrend} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border-soft)" strokeDasharray="3 5" vertical={false} />
                  <XAxis axisLine={false} dataKey="label" tick={{ fill: "var(--muted)", fontSize: 9 }} tickLine={false} />
                  <YAxis axisLine={false} tickFormatter={(value) => `${Number(value)}h`} tick={{ fill: "var(--muted)", fontSize: 9 }} tickLine={false} width={35} />
                  <Tooltip content={<HoursChartTooltip />} />
                  <Bar animationDuration={500} isAnimationActive={animateCharts} dataKey="hours" fill={chartColors.hours} name="Hours worked" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <ChartEmpty message="No work hours logged yet. Add your first day in Work Tracker." />}
          <div className="visualization-legend">
            <span className="visualization-legend-item"><i style={{ backgroundColor: chartColors.hours }} />{monthHours.toFixed(1)} hrs this month</span>
          </div>
        </VisualizationCard>
      </div>

      <section className="connected-dashboard-section">
        <div className="connected-dashboard-title"><h2>Account balances</h2><Link href="/finance">Open finance</Link></div>
        {accounts.length ? (
          <div className="connected-account-grid">
            {accounts.map((account) => (
              <article className="connected-account-card" key={account.id}>
                <span>{account.name}</span>
                <strong>{formatMinorUnits(account.balance_minor, account.currency_code)}</strong>
                <small>Available balance · {account.currency_code}</small>
              </article>
            ))}
          </div>
        ) : <p className="connected-empty">Add an account to see its balance here.</p>}
      </section>

      <div className="connected-dashboard-grid">
        <section className="module-card connected-dashboard-section">
          <div className="connected-dashboard-title"><h2>Recent transactions</h2><Link href="/finance">View all</Link></div>
          {recentTransactions.length ? (
            <div className="connected-record-list">
              {recentTransactions.map((transaction) => (
                <div className="connected-record" key={transaction.id}>
                  <div><strong>{transaction.description}</strong><span>{transaction.kind} · {formatDate(transaction.occurred_at, timezone)}</span></div>
                  <strong>{formatMinorUnits(transaction.amount_minor, transaction.currency_code)}</strong>
                </div>
              ))}
            </div>
          ) : <p className="connected-empty">No transactions yet. Add your first transaction in Finance.</p>}
        </section>

        <section className="module-card connected-dashboard-section">
          <div className="connected-dashboard-title"><h2>Work this week</h2><Link href="/work">View tracker</Link></div>
          <div className="connected-hours">
            <div><strong>{weekHours.toFixed(1)} hrs</strong><span>This week</span></div>
            <div><strong>{monthHours.toFixed(1)} hrs</strong><span>This month</span></div>
          </div>
          <p className="connected-empty">Work totals include daily hours only.</p>
        </section>
      </div>
    </div>
  );
}
