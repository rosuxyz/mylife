import { fromZonedTime } from "date-fns-tz";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { DatabaseError, DatabaseSetup } from "@/components/database-state";
import { FinanceClient } from "@/components/finance-client";
import { getProfileForUser } from "@/lib/supabase/profile";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { isSupabaseSchemaMissing } from "@/lib/supabase/schema-status";

export const instant = false;

type Props = {
  searchParams: Promise<{ q?: string; kind?: string }>;
};

function localDate(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export default async function FinancePage({ searchParams }: Props) {
  await connection();
  const { supabase, user } = await getAuthenticatedUser();
  if (!supabase) return <DatabaseSetup />;
  if (!user) redirect("/login");

  const filters = await searchParams;
  const query = filters.q?.trim().slice(0, 100) ?? "";
  const kindFilter = ["income", "expense", "transfer"].includes(filters.kind ?? "")
    ? filters.kind ?? ""
    : "";
  const profile = await getProfileForUser(supabase, user, "currency_code,timezone");
  if (!profile) {
    return <DatabaseError message="Your personal profile is missing. Refresh or contact support before recording transactions." />;
  }

  const currencyCode = profile.currency_code ?? "GBP";
  const timezone = profile.timezone ?? "Europe/London";
  const asOf = new Date();
  const today = localDate(asOf, timezone);
  const monthStart = `${today.slice(0, 7)}-01`;
  const firstMonth = new Date(`${monthStart}T12:00:00Z`);
  firstMonth.setUTCMonth(firstMonth.getUTCMonth() - 11);
  const trendFrom = `${firstMonth.toISOString().slice(0, 7)}-01`;

  const loadTrendTransactions = async () => {
    const rows: {
      kind: "income" | "expense" | "transfer";
      amount_minor: number;
      currency_code: string;
      occurred_at: string;
      account_id: string | null;
      from_account_id: string | null;
      to_account_id: string | null;
    }[] = [];
    const pageSize = 1000;
    let offset = 0;
    while (true) {
      const result = await supabase
        .from("transactions")
        .select("kind,amount_minor,currency_code,occurred_at,account_id,from_account_id,to_account_id")
        .gte("occurred_at", fromZonedTime(`${trendFrom}T00:00:00`, timezone).toISOString())
        .order("occurred_at", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (result.error) return { data: null, error: result.error };
      const page = result.data ?? [];
      rows.push(...page.map((row) => ({ ...row, amount_minor: Number(row.amount_minor) })));
      if (page.length < pageSize) return { data: rows, error: null };
      offset += pageSize;
    }
  };

  const [
    accountsResult,
    cashflowResult,
    categoriesResult,
    transactionsResult,
    budgetsResult,
    analyticsResult,
    trendTransactionsResult,
  ] = await Promise.all([
    supabase.from("account_balances").select("*").order("name"),
    supabase.from("current_month_cashflow").select("currency_code,income_minor,expense_minor"),
    supabase.from("categories").select("id,name,kind,color").order("name"),
    (() => {
      let transactionQuery = supabase
        .from("transactions")
        .select("id,kind,amount_minor,currency_code,occurred_at,description,notes,payment_method,income_payment_id,work_entry_id,account_id,from_account_id,to_account_id,category_id")
        .order("occurred_at", { ascending: false })
        .limit(100);
      if (kindFilter) transactionQuery = transactionQuery.eq("kind", kindFilter);
      if (query) transactionQuery = transactionQuery.ilike("description", `%${query}%`);
      return transactionQuery;
    })(),
    supabase
      .from("budgets")
      .select("id,name,amount_minor,currency_code,period,category_id,starts_on")
      .order("created_at", { ascending: false }),
    supabase.rpc("get_financial_analytics", {
      p_from: trendFrom,
      p_to: today,
      p_granularity: "month",
    }),
    loadTrendTransactions(),
  ]);

  const failure = accountsResult.error ?? cashflowResult.error ?? categoriesResult.error
    ?? transactionsResult.error ?? budgetsResult.error ?? analyticsResult.error
    ?? trendTransactionsResult.error;
  if (failure) {
    console.error("Finance page data load failed:", failure.message);
    return <DatabaseError message="Your finance data could not be loaded." schemaMissing={isSupabaseSchemaMissing(failure)} />;
  }

  const currentMonth = (cashflowResult.data ?? []).find((row) => row.currency_code === currencyCode);
  const accounts = (accountsResult.data ?? []).map((account) => ({
    id: account.account_id,
    name: account.name,
    account_type: account.account_type,
    currency_code: account.currency_code,
    balance_minor: Number(account.balance_minor),
  }));
  const categories = categoriesResult.data ?? [];
  const transactions = (transactionsResult.data ?? []).map((transaction) => {
    const account = accounts.find((item) => item.id === transaction.account_id) ?? null;
    const fromAccount = accounts.find((item) => item.id === transaction.from_account_id) ?? null;
    const toAccount = accounts.find((item) => item.id === transaction.to_account_id) ?? null;
    const category = categories.find((item) => item.id === transaction.category_id) ?? null;
    return {
      ...transaction,
      amount_minor: Number(transaction.amount_minor),
      account,
      from_account: fromAccount,
      to_account: toAccount,
      category,
    };
  });
  const budgets = (budgetsResult.data ?? []).map((budget) => ({
    ...budget,
    amount_minor: Number(budget.amount_minor),
    category: categories.find((item) => item.id === budget.category_id) ?? null,
  }));

  return (
    <FinanceClient
      accounts={accounts}
      asOf={asOf.toISOString()}
      budgets={budgets}
      categories={categories}
      cashflow={(analyticsResult.data ?? []).map((item: {
        period_start: string;
        kind: "income" | "expense";
        category_id: string | null;
        currency_code: string;
        amount_minor: number | string;
      }) => ({
        ...item,
        amount_minor: Number(item.amount_minor),
      }))}
      currencyCode={currencyCode}
      currentMonthExpenses={Number(currentMonth?.expense_minor ?? 0)}
      currentMonthIncome={Number(currentMonth?.income_minor ?? 0)}
      from={trendFrom}
      kindFilter={kindFilter}
      query={query}
      timezone={timezone}
      to={today}
      transactions={transactions}
      trendTransactions={trendTransactionsResult.data ?? []}
    />
  );
}
