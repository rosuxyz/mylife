create type public.transaction_kind as enum ('income', 'expense', 'transfer');
create type public.income_frequency as enum ('weekly', 'biweekly', 'monthly', 'irregular', 'custom');
create type public.income_status as enum ('expected', 'pending', 'received', 'partially_received', 'overdue');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 100),
  currency_code text not null default 'GBP' check (currency_code ~ '^[A-Z]{3}$'),
  timezone text not null default 'Europe/London',
  week_starts_on smallint not null default 1 check (week_starts_on between 0 and 6),
  theme text not null default 'dark' check (theme in ('dark', 'light', 'system')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  account_type text not null default 'checking' check (account_type in ('checking', 'savings', 'cash', 'other')),
  currency_code text not null default 'GBP' check (currency_code ~ '^[A-Z]{3}$'),
  opening_balance_minor bigint not null default 0,
  is_default boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id)
);

create unique index accounts_one_default_per_user
  on public.accounts(user_id) where is_default and archived_at is null;
create index accounts_user_created_idx on public.accounts(user_id, created_at desc);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  kind public.transaction_kind not null check (kind <> 'transfer'),
  color text not null default '#69C99A' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  is_default boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id),
  unique (user_id, name, kind)
);
create index categories_user_kind_idx on public.categories(user_id, kind);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  employer text not null check (char_length(trim(employer)) between 1 and 120),
  title text not null check (char_length(trim(title)) between 1 and 120),
  currency_code text not null default 'GBP' check (currency_code ~ '^[A-Z]{3}$'),
  overtime_threshold_minutes integer check (overtime_threshold_minutes is null or overtime_threshold_minutes >= 0),
  overtime_multiplier numeric(5, 3) not null default 1.5 check (overtime_multiplier >= 1 and overtime_multiplier <= 10),
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id)
);
create index jobs_user_idx on public.jobs(user_id, archived_at);

create table public.hourly_rates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null,
  hourly_rate_minor bigint not null check (hourly_rate_minor > 0),
  overtime_rate_minor bigint check (overtime_rate_minor is null or overtime_rate_minor > 0),
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (job_id, user_id) references public.jobs(id, user_id) on delete restrict,
  check (effective_to is null or effective_to >= effective_from),
  unique (id, user_id)
);
create index hourly_rates_job_effective_idx
  on public.hourly_rates(job_id, effective_from desc);

create table public.pay_periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  expected_payday date,
  frequency public.income_frequency not null default 'weekly',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (ends_on >= starts_on),
  unique (id, user_id),
  unique (user_id, starts_on, ends_on)
);
create index pay_periods_user_start_idx on public.pay_periods(user_id, starts_on desc);

create table public.work_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null,
  hourly_rate_id uuid,
  pay_period_id uuid,
  started_at timestamptz not null,
  ended_at timestamptz,
  local_work_date date not null,
  timezone text not null,
  hourly_rate_minor bigint not null check (hourly_rate_minor > 0),
  overtime_rate_minor bigint check (overtime_rate_minor is null or overtime_rate_minor > 0),
  overtime_threshold_minutes integer check (overtime_threshold_minutes is null or overtime_threshold_minutes >= 0),
  currency_code text not null default 'GBP' check (currency_code ~ '^[A-Z]{3}$'),
  regular_minutes integer not null default 0 check (regular_minutes >= 0),
  overtime_minutes integer not null default 0 check (overtime_minutes >= 0),
  estimated_gross_minor bigint not null default 0 check (estimated_gross_minor >= 0),
  notes text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (job_id, user_id) references public.jobs(id, user_id) on delete restrict,
  foreign key (hourly_rate_id, user_id) references public.hourly_rates(id, user_id) on delete restrict,
  foreign key (pay_period_id, user_id) references public.pay_periods(id, user_id) on delete set null (pay_period_id),
  check (ended_at is null or ended_at >= started_at),
  unique (id, user_id)
);
create unique index work_sessions_one_open_per_user
  on public.work_sessions(user_id) where ended_at is null;
create index work_sessions_user_started_idx
  on public.work_sessions(user_id, started_at desc);
create index work_sessions_user_period_idx
  on public.work_sessions(user_id, pay_period_id);

create table public.work_breaks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  work_session_id uuid not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  is_paid boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (work_session_id, user_id) references public.work_sessions(id, user_id) on delete cascade,
  check (ended_at is null or ended_at >= started_at),
  unique (id, user_id)
);
create unique index work_breaks_one_open_per_session
  on public.work_breaks(work_session_id) where ended_at is null;
create index work_breaks_session_idx on public.work_breaks(work_session_id, started_at);

create table public.income_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid,
  pay_period_id uuid,
  source text not null check (char_length(trim(source)) between 1 and 120),
  frequency public.income_frequency not null default 'weekly',
  expected_date date,
  actual_date date,
  status public.income_status not null default 'expected',
  currency_code text not null default 'GBP' check (currency_code ~ '^[A-Z]{3}$'),
  hours_worked_minutes integer not null default 0 check (hours_worked_minutes >= 0),
  hourly_rate_minor bigint check (hourly_rate_minor is null or hourly_rate_minor >= 0),
  regular_earnings_minor bigint not null default 0 check (regular_earnings_minor >= 0),
  overtime_earnings_minor bigint not null default 0 check (overtime_earnings_minor >= 0),
  additional_payments_minor bigint not null default 0 check (additional_payments_minor >= 0),
  deductions_minor bigint not null default 0 check (deductions_minor >= 0),
  gross_minor bigint not null default 0 check (gross_minor >= 0),
  net_expected_minor bigint not null default 0 check (net_expected_minor >= 0),
  actual_received_minor bigint not null default 0 check (actual_received_minor >= 0),
  notes text not null default '' check (char_length(notes) <= 4000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (job_id, user_id) references public.jobs(id, user_id) on delete restrict,
  foreign key (pay_period_id, user_id) references public.pay_periods(id, user_id) on delete set null (pay_period_id),
  unique (id, user_id)
);
create index income_records_user_date_idx
  on public.income_records(user_id, expected_date desc);
create index income_records_user_status_idx
  on public.income_records(user_id, status);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind public.transaction_kind not null,
  category_id uuid,
  account_id uuid,
  from_account_id uuid,
  to_account_id uuid,
  income_payment_id uuid unique,
  amount_minor bigint not null check (amount_minor > 0),
  currency_code text not null default 'GBP' check (currency_code ~ '^[A-Z]{3}$'),
  occurred_at timestamptz not null default timezone('utc', now()),
  description text not null check (char_length(trim(description)) between 1 and 160),
  payment_method text not null default 'other'
    check (payment_method in ('cash', 'debit_card', 'credit_card', 'bank_transfer', 'direct_debit', 'other')),
  notes text not null default '' check (char_length(notes) <= 4000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (category_id, user_id) references public.categories(id, user_id) on delete restrict,
  foreign key (account_id, user_id) references public.accounts(id, user_id) on delete restrict,
  foreign key (from_account_id, user_id) references public.accounts(id, user_id) on delete restrict,
  foreign key (to_account_id, user_id) references public.accounts(id, user_id) on delete restrict,
  check (
    (kind = 'transfer' and account_id is null and from_account_id is not null
      and to_account_id is not null and from_account_id <> to_account_id and category_id is null)
    or (kind in ('income', 'expense') and account_id is not null
      and from_account_id is null and to_account_id is null)
  ),
  unique (id, user_id)
);
create index transactions_user_occurred_idx
  on public.transactions(user_id, occurred_at desc);
create index transactions_user_kind_idx on public.transactions(user_id, kind);
create index transactions_category_idx on public.transactions(category_id);

create table public.income_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  income_record_id uuid not null,
  account_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  paid_at timestamptz not null default timezone('utc', now()),
  payment_method text not null default 'bank_transfer'
    check (payment_method in ('cash', 'debit_card', 'credit_card', 'bank_transfer', 'direct_debit', 'other')),
  notes text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (income_record_id, user_id) references public.income_records(id, user_id) on delete restrict,
  foreign key (account_id, user_id) references public.accounts(id, user_id) on delete restrict,
  unique (id, user_id)
);
create index income_payments_record_idx
  on public.income_payments(income_record_id, paid_at);

alter table public.transactions
  add constraint transactions_income_payment_fk
  foreign key (income_payment_id, user_id)
  references public.income_payments(id, user_id) on delete restrict;

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid,
  name text not null check (char_length(trim(name)) between 1 and 100),
  amount_minor bigint not null check (amount_minor > 0),
  currency_code text not null default 'GBP' check (currency_code ~ '^[A-Z]{3}$'),
  period text not null check (period in ('weekly', 'monthly')),
  starts_on date not null,
  ends_on date,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (category_id, user_id) references public.categories(id, user_id) on delete restrict,
  check (ends_on is null or ends_on >= starts_on),
  unique (id, user_id)
);
create index budgets_user_period_idx on public.budgets(user_id, starts_on desc);

create table public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  target_amount_minor bigint not null check (target_amount_minor > 0),
  currency_code text not null default 'GBP' check (currency_code ~ '^[A-Z]{3}$'),
  starts_on date not null default current_date,
  deadline date,
  description text not null default '' check (char_length(description) <= 2000),
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (deadline is null or deadline >= starts_on),
  unique (id, user_id)
);
create index savings_goals_user_idx on public.savings_goals(user_id, created_at desc);

create table public.goal_contributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  contributed_at timestamptz not null default timezone('utc', now()),
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (goal_id, user_id) references public.savings_goals(id, user_id) on delete cascade,
  unique (id, user_id)
);
create index goal_contributions_goal_idx
  on public.goal_contributions(goal_id, contributed_at desc);

create table public.audit_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  table_name text not null,
  record_id uuid not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  occurred_at timestamptz not null default timezone('utc', now())
);
create index audit_events_user_time_idx on public.audit_events(user_id, occurred_at desc);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

create or replace function public.audit_financial_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb;
  new_row jsonb;
  owner_id uuid;
  row_id uuid;
begin
  if tg_op <> 'INSERT' then old_row := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then new_row := to_jsonb(new); end if;
  if tg_table_name = 'profiles' then
    owner_id := coalesce((new_row ->> 'id')::uuid, (old_row ->> 'id')::uuid);
  else
    owner_id := coalesce((new_row ->> 'user_id')::uuid, (old_row ->> 'user_id')::uuid);
  end if;
  row_id := coalesce((new_row ->> 'id')::uuid, (old_row ->> 'id')::uuid);
  insert into public.audit_events(user_id, table_name, record_id, action, old_data, new_data)
  values (owner_id, tg_table_name, row_id, tg_op, old_row, new_row);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.post_income_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  income_row public.income_records%rowtype;
  received_total bigint;
  income_timezone text;
begin
  select * into income_row
  from public.income_records
  where id = new.income_record_id and user_id = new.user_id
  for update;
  if not found then raise exception 'Income record not found'; end if;

  insert into public.transactions (
    user_id, kind, account_id, income_payment_id, amount_minor, currency_code,
    occurred_at, description, payment_method, notes
  ) values (
    new.user_id, 'income', new.account_id, new.id, new.amount_minor,
    income_row.currency_code, new.paid_at,
    'Income payment · ' || income_row.source, new.payment_method, new.notes
  );

  select coalesce(sum(amount_minor), 0) into received_total
  from public.income_payments
  where income_record_id = new.income_record_id and user_id = new.user_id;
  select timezone into income_timezone
  from public.profiles where id = new.user_id;
  update public.income_records
  set actual_received_minor = received_total,
      actual_date = (new.paid_at at time zone income_timezone)::date,
      status = case
        when received_total >= net_expected_minor then 'received'::public.income_status
        else 'partially_received'::public.income_status
      end
  where id = new.income_record_id and user_id = new.user_id;
  return new;
end;
$$;
create trigger income_payment_posts_transaction
  after insert on public.income_payments
  for each row execute function public.post_income_payment();

create or replace function public.prevent_paid_income_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Received income payments cannot be edited or deleted; add a correcting transaction instead';
end;
$$;
create trigger income_payments_immutable
  before update or delete on public.income_payments
  for each row execute function public.prevent_paid_income_mutation();

create or replace view public.account_balances
with (security_invoker = true)
as
select
  a.id as account_id,
  a.user_id,
  a.name,
  a.account_type,
  a.currency_code,
  a.opening_balance_minor
    + coalesce(sum(case
        when t.kind = 'income' and t.account_id = a.id then t.amount_minor
        when t.kind = 'expense' and t.account_id = a.id then -t.amount_minor
        when t.kind = 'transfer' and t.to_account_id = a.id then t.amount_minor
        when t.kind = 'transfer' and t.from_account_id = a.id then -t.amount_minor
        else 0
      end), 0) as balance_minor
from public.accounts a
left join public.transactions t on t.user_id = a.user_id
  and (t.account_id = a.id or t.from_account_id = a.id or t.to_account_id = a.id)
where a.archived_at is null
group by a.id, a.user_id, a.name, a.account_type, a.currency_code, a.opening_balance_minor;

create or replace view public.current_month_cashflow
with (security_invoker = true)
as
select
  t.user_id,
  t.currency_code,
  coalesce(sum(t.amount_minor) filter (where t.kind = 'income'), 0)::bigint as income_minor,
  coalesce(sum(t.amount_minor) filter (where t.kind = 'expense'), 0)::bigint as expense_minor
from public.transactions t
join public.profiles p on p.id = t.user_id
where t.kind in ('income', 'expense')
  and (t.occurred_at at time zone p.timezone)::date
    >= date_trunc('month', now() at time zone p.timezone)::date
group by t.user_id, t.currency_code;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'accounts', 'categories', 'jobs', 'hourly_rates', 'pay_periods',
    'work_sessions', 'work_breaks', 'income_records', 'income_payments',
    'transactions', 'budgets', 'savings_goals', 'goal_contributions'
  ] loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
    execute format('alter table public.%I enable row level security', table_name);
    if table_name = 'profiles' then
      execute 'create policy profiles_select_own on public.profiles for select to authenticated using (id = (select auth.uid()))';
      execute 'create policy profiles_insert_own on public.profiles for insert to authenticated with check (id = (select auth.uid()))';
      execute 'create policy profiles_update_own on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()))';
      execute 'create policy profiles_delete_own on public.profiles for delete to authenticated using (id = (select auth.uid()))';
    else
      execute format(
        'create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))',
        table_name || '_select_own', table_name
      );
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))',
        table_name || '_insert_own', table_name
      );
      execute format(
        'create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
        table_name || '_update_own', table_name
      );
      execute format(
        'create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))',
        table_name || '_delete_own', table_name
      );
    end if;
    execute format(
      'create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_financial_change()',
      table_name, table_name
    );
  end loop;
end;
$$;

alter table public.audit_events enable row level security;
create policy audit_events_select_own on public.audit_events
  for select to authenticated using (user_id = (select auth.uid()));

grant select, insert, update, delete on
  public.profiles, public.accounts, public.categories, public.jobs, public.hourly_rates,
  public.pay_periods, public.work_sessions, public.work_breaks, public.income_records,
  public.income_payments, public.transactions, public.budgets, public.savings_goals,
  public.goal_contributions to authenticated;
grant select on public.audit_events, public.account_balances to authenticated;
grant select on public.current_month_cashflow to authenticated;
revoke all on public.audit_events from anon, authenticated;
grant select on public.audit_events to authenticated;
