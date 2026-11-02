export type BalanceAccount = {
  id: string;
  account_type: string;
  currency_code: string;
  balance_minor: number;
};

export type LedgerMovement = {
  kind: "income" | "expense" | "transfer";
  amount_minor: number;
  currency_code: string;
  occurred_at: string;
  account_id: string | null;
  from_account_id: string | null;
  to_account_id: string | null;
};

export function getMonthKeys(from: string, to: string) {
  const start = new Date(`${from.slice(0, 7)}-01T12:00:00Z`);
  const end = new Date(`${to.slice(0, 7)}-01T12:00:00Z`);
  const keys: string[] = [];
  for (const date = new Date(start); date <= end; date.setUTCMonth(date.getUTCMonth() + 1)) {
    keys.push(`${date.toISOString().slice(0, 7)}-01`);
  }
  return keys;
}

export function getMonthLabel(value: string) {
  return new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" })
    .format(new Date(`${value}T12:00:00Z`));
}

function localDate(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function buildBalanceHistory({
  accounts,
  transactions,
  periods,
  currencyCode,
  timezone,
  accountType,
  asOf,
}: {
  accounts: BalanceAccount[];
  transactions: LedgerMovement[];
  periods: string[];
  currencyCode: string;
  timezone: string;
  accountType?: string;
  asOf: string;
}) {
  const includedAccounts = new Set(accounts
    .filter((account) => account.currency_code === currencyCode
      && (!accountType || account.account_type === accountType))
    .map((account) => account.id));
  if (!includedAccounts.size) return [];

  const movementByMonth = new Map<string, number>();
  let futureMovement = 0;
  const now = new Date(asOf).getTime();
  for (const transaction of transactions) {
    if (transaction.currency_code !== currencyCode) continue;
    let movement = 0;
    if (transaction.kind === "income" && transaction.account_id && includedAccounts.has(transaction.account_id)) {
      movement = Number(transaction.amount_minor);
    } else if (transaction.kind === "expense" && transaction.account_id && includedAccounts.has(transaction.account_id)) {
      movement = -Number(transaction.amount_minor);
    } else if (transaction.kind === "transfer") {
      if (transaction.from_account_id && includedAccounts.has(transaction.from_account_id)) {
        movement -= Number(transaction.amount_minor);
      }
      if (transaction.to_account_id && includedAccounts.has(transaction.to_account_id)) {
        movement += Number(transaction.amount_minor);
      }
    }
    if (!movement) continue;
    if (new Date(transaction.occurred_at).getTime() > now) futureMovement += movement;
    const key = `${localDate(transaction.occurred_at, timezone).slice(0, 7)}-01`;
    movementByMonth.set(key, (movementByMonth.get(key) ?? 0) + movement);
  }

  let balance = accounts
    .filter((account) => includedAccounts.has(account.id))
    .reduce((sum, account) => sum + Number(account.balance_minor), 0) - futureMovement;
  const history = new Array<{ period_start: string; balance: number; label: string }>(periods.length);
  for (let index = periods.length - 1; index >= 0; index -= 1) {
    const period = periods[index];
    history[index] = { period_start: period, balance, label: getMonthLabel(period) };
    balance -= movementByMonth.get(period) ?? 0;
  }
  return history;
}
