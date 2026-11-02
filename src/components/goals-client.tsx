"use client";

import { useActionState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  addGoalContribution,
  createGoal,
  deleteGoal,
  updateGoal,
  type GoalActionState,
} from "@/app/actions/goals";
import { formatMinorUnits } from "@/lib/money";
import { chartColors, ChartEmpty, MoneyChartTooltip, useChartAnimation, VisualizationCard } from "@/components/visualizations";

type Contribution = { id: string; goal_id: string; amount_minor: number; contributed_at: string; note: string };
type Goal = {
  id: string;
  name: string;
  target_amount_minor: number;
  currency_code: string;
  starts_on: string;
  deadline: string | null;
  description: string;
  contributions: Contribution[];
};

function ActionMessage({ state }: { state: GoalActionState }) {
  if (state.error) return <p className="form-message form-error" role="alert">{state.error}</p>;
  if (state.success) return <p className="form-message form-success" role="status">{state.success}</p>;
  return null;
}

function currencySymbol(currencyCode: string) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: currencyCode })
    .formatToParts(0)
    .find((part) => part.type === "currency")?.value ?? currencyCode;
}

function contributionHistory(contributions: Contribution[], timezone: string) {
  const sorted = contributions
    .slice()
    .sort((left, right) => left.contributed_at.localeCompare(right.contributed_at));
  let saved = 0;
  return sorted.map((item) => {
    saved += Number(item.amount_minor);
    return {
      date: item.contributed_at,
      label: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: timezone })
        .format(new Date(item.contributed_at)),
      saved,
    };
  });
}

function AmountField({ name, currencyCode }: { name: string; currencyCode: string }) {
  return <label className="field-label">Target amount<span className="money-input"><span>{currencySymbol(currencyCode)}</span><input min="0.01" name={name} required step="0.01" type="number" /></span></label>;
}

function CreateGoalForm({ currencyCode }: { currencyCode: string }) {
  const [state, action, pending] = useActionState(createGoal, {});
  return (
    <form action={action} className="domain-form">
      <div className="form-grid">
        <label className="field-label field-wide">Goal name<input maxLength={100} name="name" placeholder="e.g. Emergency fund" required /></label>
        <AmountField currencyCode={currencyCode} name="target" />
        <label className="field-label">Start date<input name="startsOn" required type="date" /></label>
        <label className="field-label">Deadline (optional)<input name="deadline" type="date" /></label>
        <label className="field-label field-wide">Description<input maxLength={2000} name="description" placeholder="What are you saving for?" /></label>
      </div>
      <ActionMessage state={state} />
      <button className="primary-button" disabled={pending} type="submit">{pending ? "Saving…" : "Create goal"}</button>
    </form>
  );
}

function GoalCard({ goal, timezone, animateCharts }: { goal: Goal; timezone: string; animateCharts: boolean }) {
  const [contributionState, contributionAction, contributionPending] = useActionState(addGoalContribution, {});
  const [updateState, updateAction, updatePending] = useActionState(updateGoal, {});
  const [deleteState, deleteAction, deletePending] = useActionState(deleteGoal, {});
  const current = goal.contributions.reduce((sum, item) => sum + Number(item.amount_minor), 0);
  const percentage = goal.target_amount_minor > 0
    ? Math.min((current / goal.target_amount_minor) * 100, 100)
    : 0;
  const remaining = Math.max(0, goal.target_amount_minor - current);
  const progressHistory = contributionHistory(goal.contributions, timezone);

  return (
    <article className="goal-card">
      <div className="goal-card-heading">
        <div><h2>{goal.name}</h2><p>{goal.deadline ? `Target date · ${goal.deadline}` : "No target date"}</p></div>
        <span className="goal-percent">{Math.round(percentage)}%</span>
      </div>
      <p className="goal-description">{goal.description || "A goal worth working towards."}</p>
      <div className="goal-amounts"><strong>{formatMinorUnits(current, goal.currency_code)}</strong><span>of {formatMinorUnits(goal.target_amount_minor, goal.currency_code)}</span></div>
      <div aria-label={`${Math.round(percentage)} percent complete`} className="goal-track" role="meter" aria-valuenow={Math.round(percentage)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${percentage}%` }} />
      </div>
      <p className="goal-remaining">{remaining ? `${formatMinorUnits(remaining, goal.currency_code)} remaining` : "Target reached"}</p>
      {progressHistory.length > 0 && (
        <div>
          <p className="module-card-subtitle">Contribution progress</p>
          <div className="goal-history-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={progressHistory} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="var(--border-soft)" strokeDasharray="3 5" vertical={false} />
                <XAxis axisLine={false} dataKey="label" tick={{ fill: "var(--muted)", fontSize: 8 }} tickLine={false} />
                <YAxis axisLine={false} tickFormatter={(value) => formatMinorUnits(Number(value), goal.currency_code)} tick={{ fill: "var(--muted)", fontSize: 8 }} tickLine={false} width={52} />
                <Tooltip content={<MoneyChartTooltip currencyCode={goal.currency_code} />} />
                <Area animationDuration={450} dataKey="saved" fill={chartColors.income} fillOpacity={0.12} isAnimationActive={animateCharts} name="Saved" stroke={chartColors.income} strokeWidth={2} type="monotone" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <details className="details-form goal-action-details">
        <summary>Add contribution</summary>
        <form action={contributionAction} className="domain-form compact-form">
          <input name="goalId" type="hidden" value={goal.id} />
          <div className="form-grid">
            <label className="field-label">Amount<span className="money-input"><span>{currencySymbol(goal.currency_code)}</span><input min="0.01" name="amount" required step="0.01" type="number" /></span></label>
            <label className="field-label">Date<input name="contributedAt" required type="date" /></label>
            <label className="field-label field-wide">Note<input maxLength={500} name="note" /></label>
          </div>
          <ActionMessage state={contributionState} />
          <button className="secondary-button" disabled={contributionPending} type="submit">{contributionPending ? "Saving…" : "Record contribution"}</button>
        </form>
      </details>
      <details className="details-form goal-action-details">
        <summary>Edit goal details</summary>
        <form action={updateAction} className="domain-form compact-form">
          <input name="id" type="hidden" value={goal.id} />
          <div className="form-grid">
            <label className="field-label field-wide">Goal name<input defaultValue={goal.name} maxLength={100} name="name" required /></label>
            <label className="field-label">Target amount<span className="money-input"><span>{currencySymbol(goal.currency_code)}</span><input defaultValue={(goal.target_amount_minor / 100).toFixed(2)} min="0.01" name="target" required step="0.01" type="number" /></span></label>
            <label className="field-label">Start date<input defaultValue={goal.starts_on} name="startsOn" required type="date" /></label>
            <label className="field-label">Deadline<input defaultValue={goal.deadline ?? ""} name="deadline" type="date" /></label>
            <label className="field-label field-wide">Description<input defaultValue={goal.description} maxLength={2000} name="description" /></label>
          </div>
          <ActionMessage state={updateState} />
          <button className="secondary-button" disabled={updatePending} type="submit">{updatePending ? "Saving…" : "Save changes"}</button>
        </form>
      </details>
      <form action={deleteAction} className="goal-delete-form" onSubmit={(event) => {
        if (!window.confirm("Delete this goal and its contribution history? This does not change account balances.")) event.preventDefault();
      }}>
        <input name="id" type="hidden" value={goal.id} />
        <button className="delete-button" disabled={deletePending} type="submit">{deletePending ? "Deleting…" : "Delete goal"}</button>
        <ActionMessage state={deleteState} />
      </form>
      {goal.contributions.length > 0 && (
        <details className="goal-history">
          <summary>{goal.contributions.length} contribution{goal.contributions.length === 1 ? "" : "s"}</summary>
          <ul>
            {goal.contributions.map((contribution) => (
              <li key={contribution.id}>
                <span>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(contribution.contributed_at))}{contribution.note ? ` · ${contribution.note}` : ""}</span>
                <strong>{formatMinorUnits(contribution.amount_minor, goal.currency_code)}</strong>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

export function GoalsClient({ goals, currencyCode, timezone }: { goals: Goal[]; currencyCode: string; timezone: string }) {
  const animateCharts = useChartAnimation();
  const chartGoals = goals
    .filter((goal) => goal.currency_code === currencyCode)
    .map((goal) => ({
      name: goal.name,
      saved: goal.contributions.reduce((sum, item) => sum + Number(item.amount_minor), 0),
      target: Number(goal.target_amount_minor),
    }));
  const currencyTotals = goals.reduce<Record<string, { target: number; saved: number }>>((totals, goal) => {
    const current = totals[goal.currency_code] ?? { target: 0, saved: 0 };
    current.target += Number(goal.target_amount_minor);
    current.saved += goal.contributions.reduce((sum, contribution) => sum + Number(contribution.amount_minor), 0);
    totals[goal.currency_code] = current;
    return totals;
  }, {});
  return (
    <div className="module-page">
      <div className="module-heading">
        <div><div className="eyebrow">SMALL STEPS, BIGGER PLANS</div><h1>Savings goals</h1><p>Track progress independently of account balances. Contributions are goal records, not transactions.</p></div>
        <span className="connected-badge"><span /> Your goals</span>
      </div>
      <div className="finance-summary-grid">
        <article className="finance-summary-card"><span>Goals</span><strong>{goals.length}</strong><small>Active goals</small></article>
        {Object.entries(currencyTotals).map(([code, totals]) => (
          <article className="finance-summary-card" key={code}>
            <span>Saved · {code}</span>
            <strong>{formatMinorUnits(totals.saved, code)}</strong>
            <small>Of {formatMinorUnits(totals.target, code)} target</small>
          </article>
        ))}
      </div>
      <VisualizationCard title="Goal progress" subtitle={`Saved against target · ${currencyCode}`}>
        {chartGoals.length ? (
          <div className="goal-progress-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartGoals} layout="vertical" margin={{ top: 4, right: 8, left: 12, bottom: 0 }}>
                <CartesianGrid stroke="var(--border-soft)" strokeDasharray="3 5" horizontal={false} />
                <XAxis axisLine={false} tickFormatter={(value) => formatMinorUnits(Number(value), currencyCode)} tick={{ fill: "var(--muted)", fontSize: 9 }} tickLine={false} type="number" />
                <YAxis axisLine={false} dataKey="name" tick={{ fill: "var(--secondary)", fontSize: 9 }} tickLine={false} type="category" width={90} />
                <Tooltip content={<MoneyChartTooltip currencyCode={currencyCode} />} />
                <Bar animationDuration={500} isAnimationActive={animateCharts} dataKey="saved" fill={chartColors.income} name="Saved" radius={[0, 4, 4, 0]} />
                <Bar animationDuration={500} isAnimationActive={animateCharts} dataKey="target" fill={chartColors.target} name="Target" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <ChartEmpty message="Create a goal in your selected currency to compare saved amounts with targets." />}
        {chartGoals.length > 0 && (
        <div className="visualization-legend">
          <span className="visualization-legend-item"><i style={{ backgroundColor: chartColors.income }} />Saved</span>
          <span className="visualization-legend-item"><i style={{ backgroundColor: chartColors.target }} />Target</span>
        </div>
        )}
      </VisualizationCard>
      <section className="module-card goal-create-card">
        <h2>Create a savings goal</h2>
        <CreateGoalForm currencyCode={currencyCode} />
      </section>
      <div className="goals-grid">
        {goals.map((goal) => <GoalCard animateCharts={animateCharts} goal={goal} key={goal.id} timezone={timezone} />)}
        {goals.length === 0 && <p className="empty-copy">No savings goals yet. Create your first goal above.</p>}
      </div>
    </div>
  );
}
