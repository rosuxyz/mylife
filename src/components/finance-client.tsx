"use client";

import { useActionState } from "react";
import { useState } from "react";
import {
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
import {
  createAccount,
  createBudget,
  createCategory,
  createTransaction,
  deleteBudget,
  deleteCategory,
  deleteTransaction,
  type FinanceActionState,
  updateBudget,
  updateCategory,
  updateTransaction,
} from "@/app/actions/finance";
import { currencySymbol, formatMinorUnits } from "@/lib/money";
import { buildBalanceHistory, getMonthKeys, getMonthLabel, type LedgerMovement } from "@/lib/chart-data";
import { chartColors, ChartEmpty, MoneyChartTooltip, useChartAnimation, VisualizationCard } from "@/components/visualizations";

type Account = { id: string; name: string; account_type: string; currency_code: string; balance_minor: number };
type Category = { id: string; name: string; kind: "income" | "expense"; color: string };
type Transaction = {
  id: string;
  kind: "income" | "expense" | "transfer";
  account_id: string | null;
  from_account_id: string | null;
  to_account_id: string | null;
  category_id: string | null;
  amount_minor: number;
  currency_code: string;
  occurred_at: string;
  description: string;
  payment_method: string;
  notes: string;
  income_payment_id: string | null;
  work_entry_id: string | null;
  category: { name: string } | null;
  account: { name: string } | null;
  from_account: { name: string } | null;
  to_account: { name: string } | null;
};
type Budget = {
  id: string;
  name: string;
  amount_minor: number;
  currency_code: string;
  period: string;
  category_id: string | null;
  starts_on: string;
  category: { name: string } | null;
};
type FinancialPoint = {
  period_start: string;
  kind: "income" | "expense";
  category_id: string | null;
  currency_code: string;
  amount_minor: number;
};

function buildMonthlyCashflow(points: FinancialPoint[], periods: string[], currencyCode: string) {
  const result = new Map(periods.map((period) => [period, {
    period_start: period,
    label: getMonthLabel(period),
    income: 0,
    expenses: 0,
  }]));
  for (const point of points) {
    if (point.currency_code !== currencyCode) continue;
    const period = result.get(point.period_start);
    if (!period) continue;
    if (point.kind === "income") period.income += Number(point.amount_minor);
    if (point.kind === "expense") period.expenses += Number(point.amount_minor);
  }
  return [...result.values()];
}

function ActionMessage({ state }: { state: FinanceActionState }) {
  if (state.error) return <p className="form-message form-error" role="alert">{state.error}</p>;
  if (state.success) return <p className="form-message form-success" role="status">{state.success}</p>;
  return null;
}

function dateTimeInTimezone(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function EditTransactionForm({
  transaction,
  accounts,
  categories,
  timezone,
}: {
  transaction: Transaction;
  accounts: Account[];
  categories: Category[];
  timezone: string;
}) {
  const [state, action, pending] = useActionState(updateTransaction, {});
  const availableCategories = categories.filter((category) => category.kind === transaction.kind);
  return (
    <details className="details-form">
      <summary>Edit details</summary>
      <form action={action} className="domain-form compact-form">
        <input name="id" type="hidden" value={transaction.id} />
        <input name="kind" type="hidden" value={transaction.kind} />
        <div className="form-grid">
          <label className="field-label field-wide">Description<input defaultValue={transaction.description} maxLength={160} name="description" required /></label>
          <label className="field-label">Amount<span className="money-input"><span>{currencySymbol(transaction.currency_code)}</span><input defaultValue={(transaction.amount_minor / 100).toFixed(2)} min="0.01" name="amount" required step="0.01" type="number" /></span></label>
          <label className="field-label">Date and time<input defaultValue={dateTimeInTimezone(transaction.occurred_at, timezone)} name="occurredAt" required type="datetime-local" /></label>
          {transaction.kind === "transfer" ? (
            <>
              <label className="field-label">From account<select defaultValue={transaction.from_account_id ?? ""} name="fromAccountId" required>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency_code}</option>)}</select></label>
              <label className="field-label">To account<select defaultValue={transaction.to_account_id ?? ""} name="toAccountId" required>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency_code}</option>)}</select></label>
            </>
          ) : (
            <>
              <label className="field-label">Account<select defaultValue={transaction.account_id ?? ""} name="accountId" required>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency_code}</option>)}</select></label>
              <label className="field-label">Category<select defaultValue={transaction.category_id ?? ""} name="categoryId"><option value="">No category</option>{availableCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            </>
          )}
          <label className="field-label">Payment method<select defaultValue={transaction.payment_method} name="paymentMethod"><option value="cash">Cash</option><option value="debit_card">Debit card</option><option value="credit_card">Credit card</option><option value="bank_transfer">Bank transfer</option><option value="direct_debit">Direct debit</option><option value="other">Other</option></select></label>
          <label className="field-label field-wide">Notes<input defaultValue={transaction.notes} maxLength={4000} name="notes" /></label>
        </div>
        <ActionMessage state={state} />
        <button className="secondary-button" disabled={pending} type="submit">{pending ? "Saving…" : "Save transaction"}</button>
      </form>
    </details>
  );
}

function AmountInput({ name = "amount", label = "Amount", currencyCode = "GBP" }: { name?: string; label?: string; currencyCode?: string }) {
  return (
    <label className="field-label">
      {label}
      <span className="money-input">
        <span>{currencySymbol(currencyCode)}</span>
        <input min="0.01" name={name} placeholder="0.00" required step="0.01" type="number" />
      </span>
    </label>
  );
}

function TransactionForm({
  accounts,
  categories,
}: {
  accounts: Account[];
  categories: Category[];
}) {
  const [state, action, pending] = useActionState(createTransaction, {});
  const [kind, setKind] = useState<"income" | "expense" | "transfer">("expense");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [fromAccountId, setFromAccountId] = useState(accounts[0]?.id ?? "");
  const [toAccountId, setToAccountId] = useState(
    accounts.find((account) => account.id !== accounts[0]?.id
      && account.currency_code === accounts[0]?.currency_code)?.id ?? "",
  );
  const incomeCategories = categories.filter((category) => category.kind === "income");
  const expenseCategories = categories.filter((category) => category.kind === "expense");
  const selectedAccount = accounts.find((account) => account.id === accountId);
  const sourceAccount = accounts.find((account) => account.id === fromAccountId);
  const destinationAccounts = accounts.filter((account) =>
    account.id !== fromAccountId && account.currency_code === sourceAccount?.currency_code,
  );

  return (
    <form action={action} className="domain-form">
      <div className="form-grid">
        <label className="field-label">
          Type
          <select onChange={(event) => setKind(event.target.value as typeof kind)} value={kind} name="kind">
            <option value="expense">Expense</option>
            <option value="income">Income received</option>
            <option value="transfer">Transfer between accounts</option>
          </select>
        </label>
        {kind !== "transfer" ? (
          <>
            <label className="field-label">
              Category
              <select defaultValue="" name="categoryId">
                <option value="">No category</option>
                {(kind === "income" ? incomeCategories : expenseCategories).map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Account
              <select onChange={(event) => setAccountId(event.target.value)} value={accountId} name="accountId" required>
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency_code}</option>)}
              </select>
            </label>
          </>
        ) : (
          <>
            <label className="field-label">
              From account
              <select onChange={(event) => {
                const nextId = event.target.value;
                const nextSource = accounts.find((account) => account.id === nextId);
                setFromAccountId(nextId);
                if (!destinationAccounts.some((account) => account.id === toAccountId
                  && account.currency_code === nextSource?.currency_code)) {
                  setToAccountId(accounts.find((account) => account.id !== nextId
                    && account.currency_code === nextSource?.currency_code)?.id ?? "");
                }
              }} value={fromAccountId} name="fromAccountId" required>
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency_code}</option>)}
              </select>
            </label>
            <label className="field-label">
              To account
              <select onChange={(event) => setToAccountId(event.target.value)} value={toAccountId} name="toAccountId" required>
                <option value="">Choose account</option>
                {destinationAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency_code}</option>)}
              </select>
            </label>
          </>
        )}
        <AmountInput currencyCode={(kind === "transfer" ? sourceAccount : selectedAccount)?.currency_code ?? "GBP"} />
        <label className="field-label">
          Description
          <input maxLength={160} name="description" placeholder="What was this for?" required />
        </label>
        <label className="field-label">
          Date and time
          <input name="occurredAt" required type="datetime-local" />
        </label>
        <label className="field-label">
          Payment method
          <select defaultValue="debit_card" name="paymentMethod">
            <option value="cash">Cash</option>
            <option value="debit_card">Debit card</option>
            <option value="credit_card">Credit card</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="direct_debit">Direct debit</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="field-label field-wide">
          Notes
          <input maxLength={4000} name="notes" placeholder="Optional notes" />
        </label>
      </div>
      <ActionMessage state={state} />
      <button className="primary-button" disabled={pending || accounts.length === 0} type="submit">
        {pending ? "Saving…" : "Add transaction"}
      </button>
      {accounts.length === 0 && <p className="form-hint">Add an account before recording transactions.</p>}
      {kind === "transfer" && accounts.length > 1 && destinationAccounts.length === 0
        && <p className="form-hint">Add another account in {sourceAccount?.currency_code ?? "the same currency"} to transfer money.</p>}
    </form>
  );
}

function AccountForm({ currencyCode }: { currencyCode: string }) {
  const [state, action, pending] = useActionState(createAccount, {});
  return (
    <form action={action} className="domain-form compact-form">
      <div className="form-grid">
        <label className="field-label">
          Account name
          <input list="finance-account-name-suggestions" maxLength={80} name="name" placeholder="e.g. Lloyds or Monzo" required />
          <datalist id="finance-account-name-suggestions">
            <option value="Lloyds" />
            <option value="Monzo" />
          </datalist>
        </label>
        <label className="field-label">
          Type
          <select defaultValue="checking" name="accountType">
            <option value="checking">Current account</option>
            <option value="savings">Savings</option>
            <option value="cash">Cash</option>
            <option value="other">Other</option>
          </select>
        </label>
        <AmountInput currencyCode={currencyCode} label="Opening balance" name="openingBalance" />
      </div>
      <ActionMessage state={state} />
      <button className="secondary-button" disabled={pending} type="submit">{pending ? "Saving…" : "Add account"}</button>
    </form>
  );
}

function CategoryForm() {
  const [state, action, pending] = useActionState(createCategory, {});
  return (
    <form action={action} className="domain-form compact-form">
      <div className="form-grid">
        <label className="field-label">
          Name
          <input list="finance-category-name-suggestions" maxLength={60} name="name" placeholder="e.g. Groceries or Personal" required />
          <datalist id="finance-category-name-suggestions">
            <option value="Groceries" />
            <option value="Personal" />
            <option value="Household" />
            <option value="Travel" />
            <option value="Clothing" />
            <option value="Gifts" />
            <option value="Pet care" />
          </datalist>
        </label>
        <label className="field-label">
          Type
          <select defaultValue="expense" name="kind">
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </label>
        <label className="field-label">
          Colour
          <input defaultValue="#69C99A" name="color" type="color" />
        </label>
      </div>
      <ActionMessage state={state} />
      <button className="secondary-button" disabled={pending} type="submit">{pending ? "Saving…" : "Add category"}</button>
    </form>
  );
}

function BudgetForm({ categories, currencyCode }: { categories: Category[]; currencyCode: string }) {
  const [state, action, pending] = useActionState(createBudget, {});
  return (
    <form action={action} className="domain-form compact-form">
      <div className="form-grid">
        <label className="field-label">
          Budget name
          <input maxLength={100} name="name" placeholder="e.g. Groceries" required />
        </label>
        <AmountInput currencyCode={currencyCode} />
        <label className="field-label">
          Period
          <select defaultValue="monthly" name="period">
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
        <label className="field-label">
          Category
          <select defaultValue="" name="categoryId">
            <option value="">Overall budget</option>
            {categories.filter((item) => item.kind === "expense").map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
        </label>
        <label className="field-label">
          Starts on
          <input name="startsOn" required type="date" />
        </label>
      </div>
      <ActionMessage state={state} />
      <button className="secondary-button" disabled={pending} type="submit">{pending ? "Saving…" : "Create budget"}</button>
    </form>
  );
}

function DeleteTransactionForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(deleteTransaction, {});
  return (
    <form action={action} className="delete-row-form" onSubmit={(event) => {
      if (!window.confirm("Delete this transaction? This action is recorded in your audit history.")) event.preventDefault();
    }}>
      <input name="id" type="hidden" value={id} />
      <button aria-label="Delete transaction" className="delete-button" disabled={pending} title="Delete transaction" type="submit">
        {pending ? "…" : "Delete"}
      </button>
      <ActionMessage state={state} />
    </form>
  );
}

function EditCategoryForm({ category }: { category: Category }) {
  const [state, action, pending] = useActionState(updateCategory, {});
  return (
    <details className="details-form">
      <summary>Edit</summary>
      <form action={action} className="domain-form compact-form">
        <input name="id" type="hidden" value={category.id} />
        <div className="form-grid">
          <label className="field-label">Name<input defaultValue={category.name} maxLength={60} name="name" required /></label>
          <label className="field-label">Colour<input defaultValue={category.color} name="color" type="color" /></label>
        </div>
        <ActionMessage state={state} />
        <button className="secondary-button" disabled={pending} type="submit">{pending ? "Saving…" : "Save category"}</button>
      </form>
    </details>
  );
}

function DeleteCategoryForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(deleteCategory, {});
  return (
    <form action={action} className="delete-row-form" onSubmit={(event) => {
      if (!window.confirm("Delete this category? Categories used by records cannot be deleted.")) event.preventDefault();
    }}>
      <input name="id" type="hidden" value={id} />
      <button className="delete-button" disabled={pending} type="submit">{pending ? "…" : "Delete"}</button>
      <ActionMessage state={state} />
    </form>
  );
}

function EditBudgetForm({ budget, categories }: { budget: Budget; categories: Category[] }) {
  const [state, action, pending] = useActionState(updateBudget, {});
  return (
    <details className="details-form">
      <summary>Edit</summary>
      <form action={action} className="domain-form compact-form">
        <input name="id" type="hidden" value={budget.id} />
        <div className="form-grid">
          <label className="field-label field-wide">Budget name<input defaultValue={budget.name} maxLength={100} name="name" required /></label>
          <AmountInput currencyCode={budget.currency_code} label="Amount" name="amount" />
          <label className="field-label">Period<select defaultValue={budget.period} name="period"><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
          <label className="field-label">Category<select defaultValue={budget.category_id ?? ""} name="categoryId"><option value="">Overall budget</option>{categories.filter((item) => item.kind === "expense").map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label className="field-label">Starts on<input defaultValue={budget.starts_on} name="startsOn" required type="date" /></label>
        </div>
        <ActionMessage state={state} />
        <button className="secondary-button" disabled={pending} type="submit">{pending ? "Saving…" : "Save budget"}</button>
      </form>
    </details>
  );
}

function DeleteBudgetForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(deleteBudget, {});
  return (
    <form action={action} className="delete-row-form" onSubmit={(event) => {
      if (!window.confirm("Delete this budget?")) event.preventDefault();
    }}>
      <input name="id" type="hidden" value={id} />
      <button className="delete-button" disabled={pending} type="submit">{pending ? "…" : "Delete"}</button>
      <ActionMessage state={state} />
    </form>
  );
}

export function FinanceClient({
  accounts,
  categories,
  transactions,
  budgets,
  query,
  kindFilter,
  currencyCode,
  currentMonthIncome,
  currentMonthExpenses,
  timezone,
  cashflow,
  from,
  to,
  trendTransactions,
  asOf,
}: {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  query: string;
  kindFilter: string;
  currencyCode: string;
  currentMonthIncome: number;
  currentMonthExpenses: number;
  timezone: string;
  cashflow: FinancialPoint[];
  from: string;
  to: string;
  trendTransactions: LedgerMovement[];
  asOf: string;
}) {
  const animateCharts = useChartAnimation();
  const balance = accounts
    .filter((account) => account.currency_code === currencyCode)
    .reduce((total, account) => total + Number(account.balance_minor), 0);
  const periods = getMonthKeys(from, to);
  const monthlyCashflow = buildMonthlyCashflow(cashflow, periods, currencyCode);
  const balanceHistory = buildBalanceHistory({
    accounts,
    transactions: trendTransactions,
    periods,
    currencyCode,
    timezone,
    asOf,
  });
  const savingsHistory = buildBalanceHistory({
    accounts,
    transactions: trendTransactions,
    periods,
    currencyCode,
    timezone,
    accountType: "savings",
    asOf,
  });
  const spendingByCategory = new Map<string, number>();
  for (const point of cashflow) {
    if (point.currency_code !== currencyCode || point.kind !== "expense") continue;
    const categoryId = point.category_id ?? "uncategorised";
    spendingByCategory.set(categoryId, (spendingByCategory.get(categoryId) ?? 0) + Number(point.amount_minor));
  }
  const categoryChart = [...spendingByCategory.entries()]
    .map(([id, amount]) => {
      const category = categories.find((item) => item.id === id);
      return {
        id,
        name: category?.name ?? "Uncategorised",
        amount,
        color: category?.color ?? chartColors.muted,
      };
    })
    .sort((a, b) => b.amount - a.amount);
  const hasCashflow = cashflow.some((item) => item.currency_code === currencyCode);

  return (
    <div className="module-page">
      <div className="module-heading">
        <div>
          <div className="eyebrow">MONEY, MADE CLEAR</div>
          <h1>Finance</h1>
          <p>Track real transactions, accounts, and budgets. Transfers never count as income or spending.</p>
        </div>
        <span className="connected-badge"><span /> Private records</span>
      </div>

      <div className="finance-summary-grid">
        <article className="finance-summary-card"><span>Available balance · {currencyCode}</span><strong>{formatMinorUnits(balance, currencyCode)}</strong><small>Matching-currency accounts; other currencies shown separately</small></article>
        <article className="finance-summary-card"><span>Income received this month</span><strong>{formatMinorUnits(currentMonthIncome, currencyCode)}</strong><small>Posted transactions only · current month in your timezone</small></article>
        <article className="finance-summary-card"><span>Expenses this month</span><strong>{formatMinorUnits(currentMonthExpenses, currencyCode)}</strong><small>Transfers are excluded · current month in your timezone</small></article>
      </div>

      <div className="visualization-grid">
        <VisualizationCard title="Income vs expenses" subtitle="Monthly totals · last 12 months">
          {hasCashflow ? (
            <div className="visualization-plot">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyCashflow} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border-soft)" strokeDasharray="3 5" vertical={false} />
                  <XAxis axisLine={false} dataKey="label" tick={{ fill: "var(--muted)", fontSize: 10 }} tickLine={false} />
                  <YAxis axisLine={false} tickFormatter={(value) => formatMinorUnits(Number(value), currencyCode)} tick={{ fill: "var(--muted)", fontSize: 9 }} tickLine={false} width={58} />
                  <Tooltip content={<MoneyChartTooltip currencyCode={currencyCode} />} />
                  <Bar animationDuration={500} isAnimationActive={animateCharts} dataKey="income" fill={chartColors.income} name="Income received" radius={[4, 4, 0, 0]} />
                  <Bar animationDuration={500} isAnimationActive={animateCharts} dataKey="expenses" fill={chartColors.expense} name="Expenses" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <ChartEmpty message="No income or expenses recorded yet. Add a transaction to see your monthly comparison." />}
          {hasCashflow && (
            <div className="visualization-legend">
              <span className="visualization-legend-item"><i style={{ backgroundColor: chartColors.income }} />Income received</span>
              <span className="visualization-legend-item"><i style={{ backgroundColor: chartColors.expense }} />Expenses</span>
            </div>
          )}
        </VisualizationCard>

        <VisualizationCard title="Spending by category" subtitle="Expense transactions · last 12 months">
          {categoryChart.length ? (
            <>
              <div className="visualization-plot visualization-plot-short">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      animationDuration={500}
                      data={categoryChart}
                      dataKey="amount"
                      innerRadius="57%"
                      nameKey="name"
                      outerRadius="82%"
                      paddingAngle={2}
                      isAnimationActive={animateCharts}
                      stroke="var(--card)"
                      strokeWidth={2}
                    >
                      {categoryChart.map((entry) => <Cell fill={entry.color} key={entry.id} />)}
                    </Pie>
                    <Tooltip content={<MoneyChartTooltip currencyCode={currencyCode} />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="visualization-legend">
                {categoryChart.slice(0, 5).map((category) => (
                  <span className="visualization-legend-item" key={category.id}>
                    <i style={{ backgroundColor: category.color }} />
                    {category.name}: {formatMinorUnits(category.amount, currencyCode)}
                  </span>
                ))}
              </div>
            </>
          ) : <ChartEmpty message="No categorised spending in this period yet." />}
        </VisualizationCard>

        <VisualizationCard title="Available balance history" subtitle="Based on account balances and recorded transactions">
          {balanceHistory.length ? (
            <div className="visualization-plot">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={balanceHistory} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border-soft)" strokeDasharray="3 5" vertical={false} />
                  <XAxis axisLine={false} dataKey="label" tick={{ fill: "var(--muted)", fontSize: 10 }} tickLine={false} />
                  <YAxis axisLine={false} tickFormatter={(value) => formatMinorUnits(Number(value), currencyCode)} tick={{ fill: "var(--muted)", fontSize: 9 }} tickLine={false} width={58} />
                  <Tooltip content={<MoneyChartTooltip currencyCode={currencyCode} />} />
                  <Line animationDuration={550} isAnimationActive={animateCharts} dataKey="balance" dot={false} name="Available balance" stroke={chartColors.balance} strokeWidth={2.2} type="monotone" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <ChartEmpty message="Add an account to see its balance history." />}
        </VisualizationCard>

        <VisualizationCard title="Savings account trend" subtitle="Balance held in savings accounts · last 12 months">
          {savingsHistory.length ? (
            <div className="visualization-plot">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={savingsHistory} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border-soft)" strokeDasharray="3 5" vertical={false} />
                  <XAxis axisLine={false} dataKey="label" tick={{ fill: "var(--muted)", fontSize: 10 }} tickLine={false} />
                  <YAxis axisLine={false} tickFormatter={(value) => formatMinorUnits(Number(value), currencyCode)} tick={{ fill: "var(--muted)", fontSize: 9 }} tickLine={false} width={58} />
                  <Tooltip content={<MoneyChartTooltip currencyCode={currencyCode} />} />
                  <Line animationDuration={550} isAnimationActive={animateCharts} dataKey="balance" dot={false} name="Savings balance" stroke={chartColors.savings} strokeWidth={2.2} type="monotone" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <ChartEmpty message="Add a savings account to track its balance over time." />}
        </VisualizationCard>
      </div>

      <div className="module-columns">
        <section className="module-card">
          <h2>Add a transaction</h2>
          <p className="module-card-subtitle">Amounts are saved as integer minor units in the selected account&apos;s currency.</p>
          <TransactionForm accounts={accounts} categories={categories} />
        </section>
        <section className="module-card">
          <h2>Accounts</h2>
          <p className="module-card-subtitle">Balances are calculated from the transaction ledger.</p>
          <div className="account-list">
            {accounts.map((account) => (
              <div className="account-row" key={account.id}>
                <span className="account-symbol">{currencySymbol(account.currency_code)}</span>
                <span><strong>{account.name}</strong><small>{account.account_type}</small></span>
                <b>{formatMinorUnits(Number(account.balance_minor), account.currency_code)}</b>
              </div>
            ))}
            {accounts.length === 0 && <p className="empty-copy">No accounts yet. Add one with your current opening balance.</p>}
          </div>
          <details className="details-form">
            <summary>Add account</summary>
            <AccountForm currencyCode={currencyCode} />
          </details>
        </section>
      </div>

      <div className="module-columns">
        <section className="module-card">
          <div className="module-card-heading">
            <div><h2>Transactions</h2><p className="module-card-subtitle">Posted money movements for this account.</p></div>
          </div>
          <form action="/finance" className="filter-form" method="get">
            <input aria-label="Search description" defaultValue={query} maxLength={100} name="q" placeholder="Search descriptions" />
            <select aria-label="Filter by transaction type" defaultValue={kindFilter} name="kind">
              <option value="">All types</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
              <option value="transfer">Transfer</option>
            </select>
            <button className="secondary-button" type="submit">Filter</button>
          </form>
          <div className="finance-table-wrap">
            <table className="finance-table">
              <thead><tr><th>Date</th><th>Description</th><th>Type</th><th>Account</th><th>Amount</th><th /></tr></thead>
              <tbody>
                {transactions.map((transaction) => {
                  const amountPrefix = transaction.kind === "income" ? "+" : transaction.kind === "expense" ? "−" : "";
                  const accountLabel = transaction.kind === "transfer"
                    ? `${transaction.from_account?.name ?? "Account"} → ${transaction.to_account?.name ?? "Account"}`
                    : transaction.account?.name ?? "Account";
                  return (
                    <tr key={transaction.id}>
                      <td>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(transaction.occurred_at))}</td>
                      <td><strong>{transaction.description}</strong><small>{transaction.category?.name ?? (transaction.kind === "transfer" ? "Transfer" : "Uncategorised")}</small></td>
                      <td><span className={`transaction-kind kind-${transaction.kind}`}>{transaction.kind}</span></td>
                      <td>{accountLabel}</td>
                      <td className={transaction.kind === "income" ? "amount-in" : transaction.kind === "expense" ? "amount-out" : ""}>{amountPrefix}{formatMinorUnits(Number(transaction.amount_minor), transaction.currency_code)}</td>
                      <td>
                        {transaction.income_payment_id || transaction.work_entry_id ? (
                          <span className="locked-label">{transaction.work_entry_id ? "From work tracker" : "Reconciled"}</span>
                        ) : (
                          <>
                            <EditTransactionForm accounts={accounts} categories={categories} timezone={timezone} transaction={transaction} />
                            <DeleteTransactionForm id={transaction.id} />
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {transactions.length === 0 && <tr><td className="empty-cell" colSpan={6}>No transactions match yet. Record one above to get started.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
        <section className="module-card">
          <h2>Budgets</h2>
          <p className="module-card-subtitle">Budget tracking is based on expenses in the active period.</p>
          <div className="budget-record-list">
            {budgets.map((budget) => (
              <div className="budget-record" key={budget.id}>
                <div><strong>{budget.name}</strong><span>{budget.category?.name ?? "All categories"} · {budget.period}</span></div>
                <b>{formatMinorUnits(Number(budget.amount_minor), budget.currency_code)}</b>
                <EditBudgetForm budget={budget} categories={categories} />
                <DeleteBudgetForm id={budget.id} />
              </div>
            ))}
            {budgets.length === 0 && <p className="empty-copy">No budgets created yet.</p>}
          </div>
          <details className="details-form">
            <summary>Create budget</summary>
            <BudgetForm categories={categories} currencyCode={currencyCode} />
          </details>
        </section>
      </div>

      <details className="module-card category-card">
        <summary className="category-summary">
          <span><strong>Categories</strong><small>{categories.length} categories</small></span>
          <span>Manage</span>
        </summary>
        <div className="category-list">
          {categories.map((category) => (
            <div className="category-chip" key={category.id}>
              <i style={{ backgroundColor: category.color }} />{category.name}<small>{category.kind}</small>
              <EditCategoryForm category={category} />
              <DeleteCategoryForm id={category.id} />
            </div>
          ))}
        </div>
        <CategoryForm />
      </details>
    </div>
  );
}
