import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = process.cwd();
const migrationsDirectory = join(root, "supabase", "migrations");
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const database = new PGlite();
const userA = "10000000-0000-4000-8000-000000000001";
const userB = "20000000-0000-4000-8000-000000000002";

async function setAuthenticatedUser(userId) {
  await database.exec("reset role; set role authenticated;");
  await database.query(
    "select set_config('request.jwt.claim.sub', $1, false)",
    [userId],
  );
}

async function assertFails(query, parameters, message) {
  await assert.rejects(() => database.query(query, parameters), undefined, message);
}

try {
  await database.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    grant usage on schema auth to anon, authenticated;
    create table auth.users (
      id uuid primary key,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create function auth.uid() returns uuid
      language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);

  for (const migration of migrationFiles) {
    const sql = await readFile(join(migrationsDirectory, migration), "utf8");
    await database.exec(sql);
    console.log(`Applied ${migration}`);
  }

  await database.query(
    "insert into auth.users(id, raw_user_meta_data) values ($1, '{\"display_name\":\"A\"}'), ($2, '{\"display_name\":\"B\"}')",
    [userA, userB],
  );
  await setAuthenticatedUser(userA);

  const ownAccounts = await database.query(
    "select id, name from public.accounts where user_id = $1",
    [userA],
  );
  assert.equal(ownAccounts.rows.length, 1, "signup should create one private default account");
  await setAuthenticatedUser(userB);
  await database.query(
    "insert into public.accounts(user_id, name, account_type, currency_code) values ($1, 'Dollar account', 'checking', 'USD')",
    [userB],
  );
  const currencyDefaults = await database.query(
    "select currency_code, is_default from public.accounts where user_id = $1 order by currency_code",
    [userB],
  );
  assert.deepEqual(
    currencyDefaults.rows,
    [
      { currency_code: "GBP", is_default: true },
      { currency_code: "USD", is_default: true },
    ],
    "each currency should receive an active default account",
  );
  await setAuthenticatedUser(userA);
  const defaultCategories = await database.query(
    "select name from public.categories where user_id = $1 and kind = 'expense' and is_default order by name",
    [userA],
  );
  assert.ok(defaultCategories.rows.some((category) => category.name === "Groceries"), "new users should receive a Groceries category");
  assert.ok(defaultCategories.rows.some((category) => category.name === "Personal"), "new users should receive a Personal category");
  const defaultPayday = await database.query(
    "select default_payday_weekday from public.profiles where id = $1",
    [userA],
  );
  assert.equal(Number(defaultPayday.rows[0].default_payday_weekday), 5, "new profiles should default to Friday payday");
  await database.query(
    "update public.profiles set default_payday_weekday = 3 where id = $1",
    [userA],
  );
  const updatedPayday = await database.query(
    "select default_payday_weekday from public.profiles where id = $1",
    [userA],
  );
  assert.equal(Number(updatedPayday.rows[0].default_payday_weekday), 3, "users should be able to save a different payday weekday");

  const otherAccounts = await database.query(
    "select id from public.accounts where user_id = $1",
    [userB],
  );
  assert.equal(otherAccounts.rows.length, 0, "RLS must hide another user's accounts");

  await database.query(
    "update public.profiles set default_hourly_rate_minor = 1500 where id = $1",
    [userA],
  );
  const legacyWorkDate = (await database.query(
    "select (current_date - 2)::text as day",
  )).rows[0].day;
  const timedWorkDate = (await database.query(
    "select (current_date - 1)::text as day",
  )).rows[0].day;
  await database.query(
    "insert into public.daily_work_hours(user_id, work_date, hours_worked) values ($1, $2, 8.25)",
    [userA, legacyWorkDate],
  );
  await database.query(
    "insert into public.daily_work_hours(user_id, work_date, hours_worked, start_time, end_time, break_minutes, net_working_minutes, hourly_rate_snapshot_minor, calculated_earnings_minor) values ($1, $2, 7.5, '09:00', '17:00', 30, 450, 1500, 11250)",
    [userA, timedWorkDate],
  );
  const timedWork = await database.query(
    "select net_working_minutes, hourly_rate_snapshot_minor, calculated_earnings_minor from public.daily_work_hours where user_id = $1 and work_date = $2",
    [userA, timedWorkDate],
  );
  assert.deepEqual(
    timedWork.rows[0],
    { net_working_minutes: 450, hourly_rate_snapshot_minor: 1500, calculated_earnings_minor: 11250 },
    "timed work records must persist calculated minutes, rate snapshots, and exact-pence earnings",
  );
  const ledgerWorkDate = (await database.query(
    "select (current_date - 4)::text as day",
  )).rows[0].day;
  const financeLinkedWork = await database.query(
    "insert into public.daily_work_hours(user_id, work_date, hours_worked, start_time, end_time, break_minutes, net_working_minutes, hourly_rate_snapshot_minor, calculated_earnings_minor, currency_code, post_earnings_to_finance) values ($1, $2, 7.5, '09:00', '17:00', 30, 450, 1271, 9533, 'GBP', true) returning id",
    [userA, ledgerWorkDate],
  );
  const workLedgerRows = await database.query(
    "select id, kind, amount_minor, currency_code, work_entry_id from public.transactions where work_entry_id = $1",
    [financeLinkedWork.rows[0].id],
  );
  assert.equal(workLedgerRows.rows.length, 1, "new work records should create exactly one linked Finance income");
  assert.deepEqual(
    { kind: workLedgerRows.rows[0].kind, amount_minor: Number(workLedgerRows.rows[0].amount_minor), currency_code: workLedgerRows.rows[0].currency_code },
    { kind: "income", amount_minor: 9533, currency_code: "GBP" },
    "work income must use the exact calculated earnings and saved currency",
  );
  const blockedWorkLedgerUpdate = await database.query(
    "update public.transactions set amount_minor = 1 where work_entry_id = $1 returning id",
    [financeLinkedWork.rows[0].id],
  );
  assert.equal(blockedWorkLedgerUpdate.rows.length, 0, "work-linked Finance income must not be directly edited");
  await database.query(
    "update public.daily_work_hours set hourly_rate_snapshot_minor = 1400, calculated_earnings_minor = 10500 where id = $1",
    [financeLinkedWork.rows[0].id],
  );
  const updatedWorkLedger = await database.query(
    "select amount_minor from public.transactions where work_entry_id = $1",
    [financeLinkedWork.rows[0].id],
  );
  assert.equal(Number(updatedWorkLedger.rows[0].amount_minor), 10500, "editing work earnings should update the linked Finance transaction");
  await database.query(
    "delete from public.daily_work_hours where id = $1",
    [financeLinkedWork.rows[0].id],
  );
  const deletedWorkLedger = await database.query(
    "select id from public.transactions where work_entry_id = $1",
    [financeLinkedWork.rows[0].id],
  );
  assert.equal(deletedWorkLedger.rows.length, 0, "deleting a work record should remove its linked Finance income");
  const historicalWork = await database.query(
    "insert into public.daily_work_hours(user_id, work_date, hours_worked, start_time, end_time, break_minutes, net_working_minutes, hourly_rate_snapshot_minor, calculated_earnings_minor) values ($1, current_date - 5, 7.5, '09:00', '17:00', 30, 450, 1271, 9533) returning id",
    [userA],
  );
  const historicalWorkLedger = await database.query(
    "select id from public.transactions where work_entry_id = $1",
    [historicalWork.rows[0].id],
  );
  assert.equal(historicalWorkLedger.rows.length, 0, "historical work records must not be backfilled into Finance");
  const zeroEarningsWork = await database.query(
    "insert into public.daily_work_hours(user_id, work_date, hours_worked, start_time, end_time, break_minutes, net_working_minutes, hourly_rate_snapshot_minor, calculated_earnings_minor, currency_code, post_earnings_to_finance) values ($1, current_date - 6, 0, '09:00', '10:00', 60, 0, 1271, 0, 'GBP', true) returning id",
    [userA],
  );
  const zeroEarningsLedger = await database.query(
    "select id from public.transactions where work_entry_id = $1",
    [zeroEarningsWork.rows[0].id],
  );
  assert.equal(zeroEarningsLedger.rows.length, 0, "zero-earnings work records must not create invalid zero-value Finance transactions");
  await assertFails(
    "insert into public.daily_work_hours(user_id, work_date, hours_worked, start_time) values ($1, current_date, 8, '09:00')",
    [userA],
    "timed work records must include all calculation inputs",
  );
  await assertFails(
    "insert into public.daily_work_hours(user_id, work_date, hours_worked) values ($1, current_date, 8)",
    [userB],
    "work record RLS must reject another user's records",
  );
  await assertFails(
    "insert into public.daily_work_hours(user_id, work_date, hours_worked) values ($1, $2, 8)",
    [userA, timedWorkDate],
    "daily work entries must remain unique per user and date",
  );
  const profile = await database.query(
    "select public.create_work_job_profile('Profile employer', '', 'GBP', 1800) as id",
  );
  const profileId = profile.rows[0].id;
  await setAuthenticatedUser(userB);
  await assertFails(
    "select public.update_work_job_profile($1, 'Other user edit', '', 2000, true)",
    [profileId],
    "Job Profile RPCs must not allow users to modify another user's profile",
  );
  await setAuthenticatedUser(userA);
  await database.query(
    "insert into public.daily_work_hours(user_id, work_date, hours_worked, job_id, employer_snapshot, start_time, end_time, break_minutes, net_working_minutes, hourly_rate_snapshot_minor, calculated_earnings_minor) values ($1, current_date, 7.5, $2, 'Profile employer', '09:00', '17:00', 30, 450, 1800, 13500)",
    [userA, profileId],
  );
  await database.query(
    "select public.update_work_job_profile($1, 'Updated employer', 'Role', 2200, true)",
    [profileId],
  );
  let savedProfileWork = await database.query(
    "select employer_snapshot, hourly_rate_snapshot_minor, calculated_earnings_minor from public.daily_work_hours where user_id = $1 and work_date = current_date",
    [userA],
  );
  assert.deepEqual(
    savedProfileWork.rows[0],
    { employer_snapshot: "Profile employer", hourly_rate_snapshot_minor: 1800, calculated_earnings_minor: 13500 },
    "changing a Job Profile must not alter historical employer, rate, or earnings snapshots",
  );
  await database.query(
    "select public.delete_work_job_profile($1)",
    [profileId],
  );
  savedProfileWork = await database.query(
    "select job_id, employer_snapshot, hourly_rate_snapshot_minor from public.daily_work_hours where user_id = $1 and work_date = current_date",
    [userA],
  );
  assert.deepEqual(
    savedProfileWork.rows[0],
    { job_id: null, employer_snapshot: "Profile employer", hourly_rate_snapshot_minor: 1800 },
    "deleting a Job Profile must preserve work snapshots and remove only the optional link",
  );

  await assertFails(
    "insert into public.accounts(user_id, name) values ($1, 'forbidden')",
    [userB],
    "RLS must reject inserting a row for another user",
  );

  const defaultAccountId = ownAccounts.rows[0].id;
  await database.query(
    "insert into public.accounts(user_id, name, opening_balance_minor) values ($1, 'Savings', 500)",
    [userA],
  );
  const accountRows = await database.query(
    "select account_id, balance_minor from public.account_balances where user_id = $1 order by name",
    [userA],
  );
  const savingsAccount = accountRows.rows[1];

  await database.query(
    "insert into public.transactions(user_id, kind, account_id, amount_minor, currency_code, description) values ($1, 'income', $2, 2000, 'GBP', 'Received pay'), ($1, 'expense', $2, 200, 'GBP', 'Groceries')",
    [userA, defaultAccountId],
  );
  await database.query(
    "insert into public.transactions(user_id, kind, from_account_id, to_account_id, amount_minor, currency_code, description) values ($1, 'transfer', $2, $3, 300, 'GBP', 'Move to savings')",
    [userA, defaultAccountId, savingsAccount.account_id],
  );
  let balances = await database.query(
    "select account_id, balance_minor from public.account_balances where user_id = $1 order by name",
    [userA],
  );
  assert.deepEqual(
    balances.rows.map((row) => Number(row.balance_minor)),
    [1500, 800],
    "transfers must move account balances without affecting income or expense categories",
  );

  const transactionsBeforeExpectedIncome = await database.query(
    "select count(*)::integer as count from public.transactions where user_id = $1",
    [userA],
  );
  const blankOptionalIncome = await database.query(
    "insert into public.income_records(user_id, source, expected_date, currency_code, hours_worked_minutes, hourly_rate_minor, regular_earnings_minor, overtime_earnings_minor, additional_payments_minor, deductions_minor, gross_minor, net_expected_minor) values ($1, 'Expected weekly pay', current_date + 7, 'GBP', 2400, 1271, 50840, 0, 0, 0, 50840, 50840) returning id, hourly_rate_minor, regular_earnings_minor, overtime_earnings_minor, additional_payments_minor, deductions_minor, actual_received_minor, status",
    [userA],
  );
  assert.deepEqual(
    blankOptionalIncome.rows[0],
    {
      id: blankOptionalIncome.rows[0].id,
      hourly_rate_minor: 1271,
      regular_earnings_minor: 50840,
      overtime_earnings_minor: 0,
      additional_payments_minor: 0,
      deductions_minor: 0,
      actual_received_minor: 0,
      status: "expected",
    },
    "blank optional income amounts should persist as zero without creating a received payment",
  );
  const transactionsAfterExpectedIncome = await database.query(
    "select count(*)::integer as count from public.transactions where user_id = $1",
    [userA],
  );
  assert.equal(
    transactionsAfterExpectedIncome.rows[0].count,
    transactionsBeforeExpectedIncome.rows[0].count,
    "expected income must not create Finance transactions before actual payment",
  );

  const income = await database.query(
    "insert into public.income_records(user_id, source, expected_date, net_expected_minor) values ($1, 'Weekly work', current_date + 3, 5000) returning id, actual_received_minor, status",
    [userA],
  );
  assert.equal(Number(income.rows[0].actual_received_minor), 0, "expected income must not post to the ledger");
  assert.equal(income.rows[0].status, "expected");
  await database.query(
    "insert into public.income_payments(user_id, income_record_id, account_id, amount_minor) values ($1, $2, $3, 3000)",
    [userA, income.rows[0].id, defaultAccountId],
  );
  let reconciled = await database.query(
    "select actual_received_minor, status from public.income_records where id = $1",
    [income.rows[0].id],
  );
  assert.equal(Number(reconciled.rows[0].actual_received_minor), 3000);
  assert.equal(reconciled.rows[0].status, "partially_received");
  const blockedReconciledDelete = await database.query(
    "delete from public.transactions where income_payment_id is not null returning id",
  );
  assert.equal(blockedReconciledDelete.rows.length, 0, "reconciled income transactions must be immutable");
  await database.query(
    "insert into public.income_payments(user_id, income_record_id, account_id, amount_minor) values ($1, $2, $3, 2500)",
    [userA, income.rows[0].id, defaultAccountId],
  );
  reconciled = await database.query(
    "select actual_received_minor, status from public.income_records where id = $1",
    [income.rows[0].id],
  );
  assert.equal(Number(reconciled.rows[0].actual_received_minor), 5500);
  assert.equal(reconciled.rows[0].status, "received");

  const job = await database.query(
    "insert into public.jobs(user_id, employer, title, overtime_threshold_minutes) values ($1, 'Test employer', 'Test role', 2400) returning id",
    [userA],
  );
  await database.query(
    "insert into public.hourly_rates(user_id, job_id, hourly_rate_minor, effective_from) values ($1, $2, 1500, current_date - 30)",
    [userA, job.rows[0].id],
  );
  const started = await database.query(
    "select public.start_work_session($1, 'Europe/London') as id",
    [job.rows[0].id],
  );
  await assertFails(
    "select public.start_work_session($1, 'Europe/London')",
    [job.rows[0].id],
    "database must prevent duplicate active clock-ins",
  );
  await assertFails(
    "insert into public.work_sessions(user_id, job_id, started_at, local_work_date, timezone, hourly_rate_minor) values ($1, $2, now(), current_date, 'Europe/London', 1)",
    [userA, job.rows[0].id],
    "work sessions can only be opened through the protected clock-in function",
  );
  const active = await database.query(
    "select ended_at, hourly_rate_minor from public.work_sessions where id = $1",
    [started.rows[0].id],
  );
  assert.equal(active.rows[0].ended_at, null, "active sessions persist in the database");
  assert.equal(Number(active.rows[0].hourly_rate_minor), 1500, "hourly rate is snapshotted at clock-in");
  const activeBreak = await database.query(
    "select public.start_work_break($1, false) as id",
    [started.rows[0].id],
  );
  await assertFails(
    "select public.finish_work_session($1, '')",
    [started.rows[0].id],
    "clock-out must require ending the active break",
  );
  await database.query(
    "select public.end_work_break($1)",
    [activeBreak.rows[0].id],
  );
  await database.query(
    "select public.finish_work_session($1, 'Test shift')",
    [started.rows[0].id],
  );
  const finished = await database.query(
    "select ended_at, regular_minutes, overtime_minutes from public.work_sessions where id = $1",
    [started.rows[0].id],
  );
  assert.ok(finished.rows[0].ended_at, "clock-out should finish the work session");

  const financeAnalytics = await database.query(
    "select kind, sum(amount_minor)::bigint as amount_minor from public.get_financial_analytics(current_date - 2, current_date + 2, 'month') group by kind",
  );
  assert.equal(
    financeAnalytics.rows.reduce((sum, row) => sum + Number(row.amount_minor), 0),
    7700,
    "financial analytics include income and expense transactions but exclude transfers",
  );
  const workAnalytics = await database.query(
    "select count(*)::integer as count from public.get_work_analytics(current_date - 2, current_date + 2, 'week')",
  );
  assert.equal(workAnalytics.rows[0].count, 1, "work analytics should include the completed local-date shift");

  const manualStartDate = (await database.query(
    "select (current_date - 2)::text as day",
  )).rows[0].day;
  const firstShiftStart = new Date(`${manualStartDate}T08:00:00Z`);
  const secondShiftStart = new Date(firstShiftStart);
  secondShiftStart.setUTCDate(secondShiftStart.getUTCDate() + 1);
  for (const shiftStart of [firstShiftStart, secondShiftStart]) {
    const shiftEnd = new Date(shiftStart);
    shiftEnd.setUTCHours(shiftEnd.getUTCHours() + 24);
    await database.query(
      "select public.record_manual_work_session($1, $2::timestamptz, $3::timestamptz, 30, 'Europe/London', 'Overtime test')",
      [job.rows[0].id, shiftStart.toISOString(), shiftEnd.toISOString()],
    );
  }
  const overtime = await database.query(
    "select sum(regular_minutes)::integer as regular_minutes, sum(overtime_minutes)::integer as overtime_minutes, sum(estimated_gross_minor)::bigint as earnings_minor from public.work_sessions where job_id = $1 and local_work_date >= $2::date and local_work_date < $2::date + 7",
    [job.rows[0].id, manualStartDate],
  );
  assert.equal(overtime.rows[0].regular_minutes, 2400, "weekly overtime threshold should allocate regular minutes first");
  assert.equal(overtime.rows[0].overtime_minutes, 420, "unpaid breaks should be excluded before overtime is calculated");
  assert.equal(Number(overtime.rows[0].earnings_minor), 75750, "weekly earnings should apply the captured overtime multiplier");

  const auditCount = await database.query(
    "select count(*)::integer as count from public.audit_events where user_id = $1",
    [userA],
  );
  assert.ok(auditCount.rows[0].count > 0, "financial changes should create audit events");

  await database.exec("reset role;");
  await database.query(
    "select set_config('request.jwt.claim.sub', $1, false)",
    [userA],
  );
  await database.query("select public.delete_my_account()");
  await database.exec("reset role;");
  const deletedUserRows = await database.query(
    "select (select count(*) from public.accounts where user_id = $1)::integer as accounts, (select count(*) from public.transactions where user_id = $1)::integer as transactions, (select count(*) from auth.users where id = $1)::integer as auth_users",
    [userA],
  );
  assert.deepEqual(
    deletedUserRows.rows[0],
    { accounts: 0, transactions: 0, auth_users: 0 },
    "account deletion must remove the user's auth record and financial records",
  );
  const remainingUser = await database.query(
    "select count(*)::integer as count from public.profiles where id = $1",
    [userB],
  );
  assert.equal(remainingUser.rows[0].count, 1, "account deletion must not affect another user's profile");
  console.log("Migration, RLS, ledger, reconciliation, analytics, break/overtime, audit, and account-deletion checks passed.");
} finally {
  await database.close();
}
