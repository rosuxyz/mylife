"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getMonthLabel } from "@/lib/chart-data";
import { formatMinorUnits } from "@/lib/money";
import { chartColors, ChartEmpty, HoursChartTooltip, MoneyChartTooltip, useChartAnimation, VisualizationCard } from "@/components/visualizations";

type FinancialPoint = {
  period_start: string;
  kind: "income" | "expense";
  category_id: string | null;
  currency_code: string;
  amount_minor: number;
};
type WorkPoint = { work_date: string; hours_worked: number };
type Granularity = "week" | "month" | "quarter" | "year";

function getGranularity(range: string): Granularity {
  if (range === "weekly") return "week";
  if (range === "quarterly") return "quarter";
  if (range === "yearly") return "year";
  return "month";
}

function periodStart(value: string, granularity: Granularity, weekStartsOn: number) {
  const date = new Date(`${value}T12:00:00Z`);
  if (granularity === "week") {
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() - weekStartsOn + 7) % 7));
  } else if (granularity === "month") {
    date.setUTCDate(1);
  } else if (granularity === "quarter") {
    date.setUTCDate(1);
    date.setUTCMonth(Math.floor(date.getUTCMonth() / 3) * 3);
  } else {
    date.setUTCMonth(0, 1);
  }
  return date.toISOString().slice(0, 10);
}

function periodKeys(from: string, to: string, granularity: Granularity, weekStartsOn: number) {
  const start = new Date(`${periodStart(from, granularity, weekStartsOn)}T12:00:00Z`);
  const end = new Date(`${periodStart(to, granularity, weekStartsOn)}T12:00:00Z`);
  const result: string[] = [];
  for (const date = new Date(start); date <= end;) {
    result.push(date.toISOString().slice(0, 10));
    if (granularity === "week") date.setUTCDate(date.getUTCDate() + 7);
    else if (granularity === "month") date.setUTCMonth(date.getUTCMonth() + 1);
    else if (granularity === "quarter") date.setUTCMonth(date.getUTCMonth() + 3);
    else date.setUTCFullYear(date.getUTCFullYear() + 1);
  }
  return result;
}

function periodLabel(value: string, granularity: Granularity) {
  if (granularity === "month") return getMonthLabel(value);
  if (granularity === "quarter") {
    const date = new Date(`${value}T12:00:00Z`);
    return `Q${Math.floor(date.getUTCMonth() / 3) + 1} '${value.slice(2, 4)}`;
  }
  if (granularity === "year") return value.slice(0, 4);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${value}T12:00:00Z`));
}

function PercentageTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { color?: string; name?: string; value?: number | null }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      {payload.map((point) => (
        <span className="chart-tooltip-row" key={point.name}>
          <i style={{ backgroundColor: point.color }} />
          {point.name}: {point.value == null ? "—" : `${Number(point.value).toFixed(1)}%`}
        </span>
      ))}
    </div>
  );
}

export function AnalyticsClient({
  financial,
  work,
  currencyCode,
  range,
  from,
  to,
  categoryNames,
  categoryColors,
  weekStartsOn,
}: {
  financial: FinancialPoint[];
  work: WorkPoint[];
  currencyCode: string;
  range: string;
  from: string;
  to: string;
  categoryNames: Record<string, string>;
  categoryColors: Record<string, string>;
  weekStartsOn: number;
}) {
  const animateCharts = useChartAnimation();
  const granularity = getGranularity(range);
  const periods = periodKeys(from, to, granularity, weekStartsOn);
  const cashflowByPeriod = new Map(periods.map((period) => [period, {
    period_start: period,
    label: periodLabel(period, granularity),
    income: 0,
    expenses: 0,
  }]));
  const categoryTotals = new Map<string, number>();
  for (const point of financial) {
    if (point.currency_code !== currencyCode) continue;
    const period = cashflowByPeriod.get(point.period_start);
    if (!period) continue;
    if (point.kind === "income") period.income += Number(point.amount_minor);
    if (point.kind === "expense") {
      period.expenses += Number(point.amount_minor);
      const key = point.category_id ?? "uncategorised";
      categoryTotals.set(key, (categoryTotals.get(key) ?? 0) + Number(point.amount_minor));
    }
  }
  const cashflow = [...cashflowByPeriod.values()].map((period) => ({
    ...period,
    savings: period.income - period.expenses,
    savings_rate: period.income > 0 ? ((period.income - period.expenses) / period.income) * 100 : null,
  }));
  const workByPeriod = new Map(periods.map((period) => [period, {
    period_start: period,
    label: periodLabel(period, granularity),
    hours: 0,
  }]));
  for (const point of work) {
    const key = periodStart(point.work_date, granularity, weekStartsOn);
    const period = workByPeriod.get(key);
    if (period) period.hours += Number(point.hours_worked);
  }
  const workTrend = [...workByPeriod.values()];
  const totalIncome = cashflow.reduce((sum, item) => sum + item.income, 0);
  const totalExpenses = cashflow.reduce((sum, item) => sum + item.expenses, 0);
  const totalSavings = totalIncome - totalExpenses;
  const totalHours = workTrend.reduce((sum, item) => sum + item.hours, 0);
  const categories = [...categoryTotals.entries()]
    .map(([id, value]) => ({
      id,
      name: id === "uncategorised" ? "Uncategorised" : categoryNames[id] ?? "Category",
      value,
      color: id === "uncategorised" ? chartColors.muted : categoryColors[id] ?? chartColors.expense,
    }))
    .sort((left, right) => right.value - left.value);
  const hasFinancialData = financial.some((point) => point.currency_code === currencyCode);

  return (
    <div className="module-page">
      <div className="module-heading">
        <div><div className="eyebrow">MEANINGFUL PATTERNS, NOT MORE NOISE</div><h1>Analytics</h1><p>Charts are calculated from your saved records, not estimates or sample figures.</p></div>
        <span className="connected-badge"><span /> {currencyCode}</span>
      </div>
      <form action="/analytics" className="analytics-filter">
        <label className="field-label">Period<select defaultValue={range} name="range"><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option><option value="custom">Custom dates</option></select></label>
        <label className="field-label">From<input defaultValue={from} name="from" required type="date" /></label>
        <label className="field-label">To<input defaultValue={to} name="to" required type="date" /></label>
        <button className="secondary-button" type="submit">Update</button>
      </form>

      <div className="finance-summary-grid analytics-summary-grid">
        <article className="finance-summary-card"><span>Income received</span><strong>{formatMinorUnits(totalIncome, currencyCode)}</strong><small>Posted ledger transactions</small></article>
        <article className="finance-summary-card"><span>Expenses</span><strong>{formatMinorUnits(totalExpenses, currencyCode)}</strong><small>Transfers excluded</small></article>
        <article className="finance-summary-card"><span>Net savings</span><strong>{formatMinorUnits(totalSavings, currencyCode)}</strong><small>Income received minus expenses</small></article>
        <article className="finance-summary-card"><span>Hours worked</span><strong>{totalHours.toFixed(1)}</strong><small>Recorded daily hours</small></article>
      </div>

      <div className="visualization-grid">
        <VisualizationCard title="Income, expenses & savings" subtitle={`${from} to ${to} · received cash only`}>
          {hasFinancialData ? (
            <div className="visualization-plot">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cashflow} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border-soft)" strokeDasharray="3 5" vertical={false} />
                  <XAxis axisLine={false} dataKey="label" tick={{ fill: "var(--muted)", fontSize: 9 }} tickLine={false} />
                  <YAxis axisLine={false} tickFormatter={(value) => formatMinorUnits(Number(value), currencyCode)} tick={{ fill: "var(--muted)", fontSize: 8 }} tickLine={false} width={58} />
                  <Tooltip content={<MoneyChartTooltip currencyCode={currencyCode} />} />
                  <Bar animationDuration={500} isAnimationActive={animateCharts} dataKey="income" fill={chartColors.income} name="Income received" radius={[4, 4, 0, 0]} />
                  <Bar animationDuration={500} isAnimationActive={animateCharts} dataKey="expenses" fill={chartColors.expense} name="Expenses" radius={[4, 4, 0, 0]} />
                  <Bar animationDuration={500} isAnimationActive={animateCharts} dataKey="savings" fill={chartColors.savings} name="Net savings" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <ChartEmpty message="No income or expenses recorded for this date range." />}
          {hasFinancialData && (
            <div className="visualization-legend">
              <span className="visualization-legend-item"><i style={{ backgroundColor: chartColors.income }} />Income</span>
              <span className="visualization-legend-item"><i style={{ backgroundColor: chartColors.expense }} />Expenses</span>
              <span className="visualization-legend-item"><i style={{ backgroundColor: chartColors.savings }} />Net savings</span>
            </div>
          )}
        </VisualizationCard>

        <VisualizationCard title="Savings rate" subtitle="Net savings as a share of income received">
          {hasFinancialData ? (
            <div className="visualization-plot">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={cashflow} margin={{ top: 8, right: 10, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border-soft)" strokeDasharray="3 5" vertical={false} />
                  <XAxis axisLine={false} dataKey="label" tick={{ fill: "var(--muted)", fontSize: 9 }} tickLine={false} />
                  <YAxis axisLine={false} tickFormatter={(value) => `${Number(value)}%`} tick={{ fill: "var(--muted)", fontSize: 9 }} tickLine={false} width={42} />
                  <Tooltip content={<PercentageTooltip />} />
                  <Line animationDuration={550} connectNulls={false} dataKey="savings_rate" dot={{ r: 2 }} isAnimationActive={animateCharts} name="Savings rate" stroke={chartColors.savings} strokeWidth={2.2} type="monotone" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <ChartEmpty message="Savings rate appears after income or expense transactions are recorded." />}
        </VisualizationCard>

        <VisualizationCard title="Spending by category" subtitle={`${from} to ${to}`}>
          {categories.length ? (
            <>
              <div className="visualization-plot visualization-plot-short">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      animationDuration={500}
                      data={categories}
                      dataKey="value"
                      innerRadius="57%"
                      nameKey="name"
                      outerRadius="82%"
                      paddingAngle={2}
                      isAnimationActive={animateCharts}
                      stroke="var(--card)"
                      strokeWidth={2}
                    >
                      {categories.map((category) => <Cell fill={category.color} key={category.id} />)}
                    </Pie>
                    <Tooltip content={<MoneyChartTooltip currencyCode={currencyCode} />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="visualization-legend">
                {categories.slice(0, 6).map((category) => (
                  <span className="visualization-legend-item" key={category.id}>
                    <i style={{ backgroundColor: category.color }} />
                    {category.name}: {formatMinorUnits(category.value, currencyCode)}
                  </span>
                ))}
              </div>
            </>
          ) : <ChartEmpty message="No expenses in this date range." />}
        </VisualizationCard>

        <VisualizationCard title="Work-hour trends" subtitle="Recorded daily hours by selected period">
          {work.length ? (
            <div className="visualization-plot">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={workTrend} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border-soft)" strokeDasharray="3 5" vertical={false} />
                  <XAxis axisLine={false} dataKey="label" tick={{ fill: "var(--muted)", fontSize: 9 }} tickLine={false} />
                  <YAxis axisLine={false} tickFormatter={(value) => `${Number(value).toFixed(0)}h`} tick={{ fill: "var(--muted)", fontSize: 8 }} tickLine={false} width={36} />
                  <Tooltip content={<HoursChartTooltip />} />
                  <Area animationDuration={500} dataKey="hours" fill={chartColors.hours} fillOpacity={0.14} isAnimationActive={animateCharts} name="Hours worked" stroke={chartColors.hours} strokeWidth={2} type="monotone" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : <ChartEmpty message="No work hours recorded in this date range." />}
        </VisualizationCard>
      </div>
    </div>
  );
}
