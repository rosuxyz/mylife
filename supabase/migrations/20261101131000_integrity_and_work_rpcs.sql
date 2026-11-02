alter table public.work_sessions
  add column overtime_multiplier numeric(5, 3) not null default 1.5
    check (overtime_multiplier >= 1 and overtime_multiplier <= 10);

create or replace function public.validate_transaction_links()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  selected_currency text;
  selected_kind public.transaction_kind;
begin
  if new.kind = 'transfer' then
    select currency_code into selected_currency
    from public.accounts
    where id = new.from_account_id and user_id = new.user_id;
    if selected_currency is null then raise exception 'Source account not found'; end if;
    if selected_currency <> new.currency_code then raise exception 'Transfer currency must match source account'; end if;
    if not exists (
      select 1 from public.accounts
      where id = new.to_account_id and user_id = new.user_id
        and currency_code = new.currency_code
    ) then raise exception 'Transfer destination must belong to this user and use the same currency'; end if;
  else
    select currency_code into selected_currency
    from public.accounts
    where id = new.account_id and user_id = new.user_id;
    if selected_currency is null or selected_currency <> new.currency_code then
      raise exception 'Transaction currency must match its account';
    end if;
    if new.category_id is not null then
      select kind into selected_kind
      from public.categories
      where id = new.category_id and user_id = new.user_id;
      if selected_kind is distinct from new.kind then
        raise exception 'Transaction category type must match transaction type';
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger transactions_validate_links
  before insert or update on public.transactions
  for each row execute function public.validate_transaction_links();

create or replace function public.validate_budget_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.category_id is not null and not exists (
    select 1 from public.categories
    where id = new.category_id and user_id = new.user_id and kind = 'expense'
  ) then
    raise exception 'Budget categories must be expense categories owned by the same user';
  end if;
  return new;
end;
$$;
create trigger budgets_validate_category
  before insert or update on public.budgets
  for each row execute function public.validate_budget_category();

create or replace function public.prevent_received_income_ledger_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.income_payment_id is not null then
    raise exception 'Received income ledger entries are immutable; use an adjustment transaction';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger transactions_protect_income_payments
  before update or delete on public.transactions
  for each row execute function public.prevent_received_income_ledger_mutation();

create or replace function public.derive_income_received_state()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  received_total bigint;
begin
  if tg_op = 'INSERT' then
    new.actual_received_minor := 0;
  else
    select coalesce(sum(amount_minor), 0) into received_total
    from public.income_payments
    where income_record_id = old.id and user_id = old.user_id;
    new.actual_received_minor := received_total;
  end if;

  if new.actual_received_minor >= new.net_expected_minor and new.actual_received_minor > 0 then
    new.status := 'received';
  elsif new.actual_received_minor > 0 then
    new.status := 'partially_received';
  elsif new.expected_date is not null and new.expected_date < current_date then
    new.status := 'overdue';
  elsif new.status in ('received', 'partially_received', 'overdue') then
    new.status := 'expected';
  end if;
  return new;
end;
$$;
create trigger income_records_derive_received_state
  before insert or update on public.income_records
  for each row execute function public.derive_income_received_state();

create or replace function public.validate_income_payment_account()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.income_records r
    join public.accounts a on a.id = new.account_id and a.user_id = new.user_id
    where r.id = new.income_record_id and r.user_id = new.user_id
      and r.currency_code = a.currency_code
  ) then
    raise exception 'Payment account and income record must belong to this user and use the same currency';
  end if;
  return new;
end;
$$;
create trigger income_payments_validate_account
  before insert on public.income_payments
  for each row execute function public.validate_income_payment_account();

create or replace function public.prevent_rate_overlap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.hourly_rates r
    where r.user_id = new.user_id
      and r.job_id = new.job_id
      and r.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and daterange(r.effective_from, coalesce(r.effective_to, 'infinity'::date), '[]')
        && daterange(new.effective_from, coalesce(new.effective_to, 'infinity'::date), '[]')
  ) then
    raise exception 'Hourly rate effective dates cannot overlap';
  end if;
  return new;
end;
$$;
create trigger hourly_rates_no_overlap
  before insert or update on public.hourly_rates
  for each row execute function public.prevent_rate_overlap();

  create or replace function public.create_job_with_rate(
    p_employer text,
    p_title text,
    p_currency_code text,
    p_hourly_rate_minor bigint,
    p_overtime_rate_minor bigint,
    p_overtime_threshold_minutes integer,
    p_overtime_multiplier numeric,
    p_effective_from date
  )
  returns uuid
  language plpgsql
  security definer
  set search_path = ''
  as $$
  declare
    owner_id uuid := auth.uid();
    job_id uuid;
  begin
    if owner_id is null then raise exception 'Authentication required'; end if;
    if char_length(trim(p_employer)) not between 1 and 120
      or char_length(trim(p_title)) not between 1 and 120
      or p_currency_code !~ '^[A-Z]{3}$'
      or p_hourly_rate_minor <= 0
      or (p_overtime_rate_minor is not null and p_overtime_rate_minor <= 0)
      or (p_overtime_threshold_minutes is not null and p_overtime_threshold_minutes < 0)
      or p_overtime_multiplier < 1 or p_overtime_multiplier > 10 then
      raise exception 'Invalid job or rate details';
    end if;
    insert into public.jobs(
      user_id, employer, title, currency_code,
      overtime_threshold_minutes, overtime_multiplier
    ) values (
      owner_id, trim(p_employer), trim(p_title), p_currency_code,
      p_overtime_threshold_minutes, p_overtime_multiplier
    ) returning id into job_id;
    insert into public.hourly_rates(
      user_id, job_id, hourly_rate_minor, overtime_rate_minor, effective_from
    ) values (
      owner_id, job_id, p_hourly_rate_minor, p_overtime_rate_minor, p_effective_from
    );
    return job_id;
  end;
  $$;

  create or replace function public.add_hourly_rate(
    p_job_id uuid,
    p_hourly_rate_minor bigint,
    p_overtime_rate_minor bigint,
    p_effective_from date
  )
  returns uuid
  language plpgsql
  security definer
  set search_path = ''
  as $$
  declare
    owner_id uuid := auth.uid();
    rate_id uuid;
  begin
    if owner_id is null then raise exception 'Authentication required'; end if;
    if p_hourly_rate_minor <= 0
      or (p_overtime_rate_minor is not null and p_overtime_rate_minor <= 0) then
      raise exception 'Hourly rates must be greater than zero';
    end if;
    perform 1 from public.jobs
    where id = p_job_id and user_id = owner_id and archived_at is null
    for update;
    if not found then raise exception 'Active job not found'; end if;
    update public.hourly_rates
    set effective_to = p_effective_from - 1
    where user_id = owner_id and job_id = p_job_id
      and effective_to is null and effective_from < p_effective_from;
    insert into public.hourly_rates(
      user_id, job_id, hourly_rate_minor, overtime_rate_minor, effective_from
    ) values (
      owner_id, p_job_id, p_hourly_rate_minor, p_overtime_rate_minor, p_effective_from
    ) returning id into rate_id;
    return rate_id;
  end;
  $$;

create or replace function public.protect_work_rate_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.hourly_rate_minor <> old.hourly_rate_minor
    or new.overtime_rate_minor is distinct from old.overtime_rate_minor
    or new.overtime_multiplier <> old.overtime_multiplier
    or new.currency_code <> old.currency_code then
    raise exception 'Historical work rate snapshots cannot be changed';
  end if;
  return new;
end;
$$;
create trigger work_sessions_protect_rate_snapshot
  before update on public.work_sessions
  for each row execute function public.protect_work_rate_snapshot();

create or replace function public.recalculate_work_week(p_user_id uuid, p_job_id uuid, p_work_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  week_day integer;
  week_start date;
  overtime_threshold integer;
  remaining_regular integer;
  shift record;
  shift_minutes integer;
  regular_for_shift integer;
  overtime_for_shift integer;
  overtime_rate bigint;
  earnings bigint;
begin
  select week_starts_on into week_day
  from public.profiles where id = p_user_id;
  if week_day is null then raise exception 'Profile not found'; end if;
  week_start := p_work_date - ((extract(dow from p_work_date)::integer - week_day + 7) % 7);
  select s.overtime_threshold_minutes into overtime_threshold
  from public.work_sessions s
  where s.user_id = p_user_id and s.job_id = p_job_id
    and s.local_work_date >= week_start and s.local_work_date < week_start + 7
    and s.ended_at is not null
  order by s.started_at, s.id limit 1;
  remaining_regular := coalesce(overtime_threshold, 2147483647);

  for shift in
    select s.id, s.started_at, s.ended_at, s.hourly_rate_minor,
      s.overtime_rate_minor, s.overtime_multiplier
    from public.work_sessions s
    where s.user_id = p_user_id and s.job_id = p_job_id
      and s.local_work_date >= week_start and s.local_work_date < week_start + 7
      and s.ended_at is not null
    order by s.started_at, s.id
    for update
  loop
    select greatest(
      0,
      floor(extract(epoch from (shift.ended_at - shift.started_at)) / 60)::integer
        - coalesce(sum(
            floor(extract(epoch from (b.ended_at - b.started_at)) / 60)::integer
          ) filter (where not b.is_paid and b.ended_at is not null), 0)
    ) into shift_minutes
    from public.work_breaks b
    where b.work_session_id = shift.id and b.user_id = p_user_id;

    regular_for_shift := least(shift_minutes, remaining_regular);
    overtime_for_shift := shift_minutes - regular_for_shift;
    remaining_regular := greatest(0, remaining_regular - regular_for_shift);
    overtime_rate := coalesce(
      shift.overtime_rate_minor,
      round(shift.hourly_rate_minor * shift.overtime_multiplier)::bigint
    );
    earnings := round(
      (regular_for_shift::numeric * shift.hourly_rate_minor
        + overtime_for_shift::numeric * overtime_rate) / 60
    )::bigint;
    update public.work_sessions
    set regular_minutes = regular_for_shift,
        overtime_minutes = overtime_for_shift,
        estimated_gross_minor = earnings
    where id = shift.id and user_id = p_user_id;
  end loop;
end;
$$;

create or replace function public.start_work_session(p_job_id uuid, p_timezone text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  local_date date;
  job_row public.jobs%rowtype;
  rate_row public.hourly_rates%rowtype;
  new_session_id uuid;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if p_timezone is null or char_length(p_timezone) > 100 then
    raise exception 'A valid timezone is required';
  end if;
  perform now() at time zone p_timezone;
  local_date := (now() at time zone p_timezone)::date;
  select * into job_row from public.jobs
  where id = p_job_id and user_id = owner_id and archived_at is null;
  if not found then raise exception 'Active job not found'; end if;
  select * into rate_row from public.hourly_rates
  where job_id = p_job_id and user_id = owner_id
    and effective_from <= local_date
    and (effective_to is null or effective_to >= local_date)
  order by effective_from desc limit 1;
  if not found then raise exception 'No hourly rate applies to this work date'; end if;

  insert into public.work_sessions (
    user_id, job_id, hourly_rate_id, started_at, local_work_date, timezone,
    hourly_rate_minor, overtime_rate_minor, overtime_multiplier,
    overtime_threshold_minutes, currency_code
  ) values (
    owner_id, p_job_id, rate_row.id, now(), local_date, p_timezone,
    rate_row.hourly_rate_minor, rate_row.overtime_rate_minor,
    job_row.overtime_multiplier, job_row.overtime_threshold_minutes,
    job_row.currency_code
  ) returning id into new_session_id;
  return new_session_id;
end;
$$;

create or replace function public.record_manual_work_session(
  p_job_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_unpaid_break_minutes integer,
  p_timezone text,
  p_notes text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  local_date date;
  duration_minutes integer;
  rate_row public.hourly_rates%rowtype;
  job_row public.jobs%rowtype;
  new_session_id uuid;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if p_started_at is null or p_ended_at is null or p_ended_at <= p_started_at
    or p_timezone is null or char_length(p_timezone) > 100
    or p_unpaid_break_minutes < 0 or char_length(p_notes) > 2000 then
    raise exception 'Invalid manual shift details';
  end if;
  perform p_started_at at time zone p_timezone;
  local_date := (p_started_at at time zone p_timezone)::date;
  duration_minutes := floor(extract(epoch from (p_ended_at - p_started_at)) / 60)::integer;
  if duration_minutes > 1440 or p_unpaid_break_minutes > duration_minutes then
    raise exception 'Shift duration or break is invalid';
  end if;
  select * into job_row from public.jobs
  where id = p_job_id and user_id = owner_id and archived_at is null;
  if not found then raise exception 'Active job not found'; end if;
  select * into rate_row from public.hourly_rates
  where job_id = p_job_id and user_id = owner_id
    and effective_from <= local_date
    and (effective_to is null or effective_to >= local_date)
  order by effective_from desc limit 1;
  if not found then raise exception 'No hourly rate applies to this work date'; end if;

  insert into public.work_sessions(
    user_id, job_id, hourly_rate_id, started_at, ended_at, local_work_date, timezone,
    hourly_rate_minor, overtime_rate_minor, overtime_multiplier,
    overtime_threshold_minutes, currency_code, notes
  ) values (
    owner_id, p_job_id, rate_row.id, p_started_at, p_ended_at, local_date, p_timezone,
    rate_row.hourly_rate_minor, rate_row.overtime_rate_minor,
    job_row.overtime_multiplier, job_row.overtime_threshold_minutes,
    job_row.currency_code, p_notes
  ) returning id into new_session_id;

  if p_unpaid_break_minutes > 0 then
    insert into public.work_breaks(
      user_id, work_session_id, started_at, ended_at, is_paid
    ) values (
      owner_id, new_session_id,
      p_ended_at - make_interval(mins => p_unpaid_break_minutes),
      p_ended_at, false
    );
  end if;
  perform public.recalculate_work_week(owner_id, p_job_id, local_date);
  return new_session_id;
end;
$$;

create or replace function public.correct_work_session(
  p_session_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_unpaid_break_minutes integer,
  p_timezone text,
  p_notes text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  shift_row public.work_sessions%rowtype;
  old_date date;
  new_date date;
  duration_minutes integer;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  select * into shift_row from public.work_sessions
  where id = p_session_id and user_id = owner_id
  for update;
  if not found or shift_row.ended_at is null then
    raise exception 'Completed work session not found';
  end if;
  if p_started_at is null or p_ended_at is null or p_ended_at <= p_started_at
    or p_timezone is null or char_length(p_timezone) > 100
    or p_unpaid_break_minutes < 0 or char_length(p_notes) > 2000 then
    raise exception 'Invalid correction details';
  end if;
  perform p_started_at at time zone p_timezone;
  duration_minutes := floor(extract(epoch from (p_ended_at - p_started_at)) / 60)::integer;
  if duration_minutes > 1440 or p_unpaid_break_minutes > duration_minutes then
    raise exception 'Shift duration or break is invalid';
  end if;
  old_date := shift_row.local_work_date;
  new_date := (p_started_at at time zone p_timezone)::date;
  delete from public.work_breaks
  where work_session_id = p_session_id and user_id = owner_id;
  if p_unpaid_break_minutes > 0 then
    insert into public.work_breaks(
      user_id, work_session_id, started_at, ended_at, is_paid
    ) values (
      owner_id, p_session_id,
      p_ended_at - make_interval(mins => p_unpaid_break_minutes),
      p_ended_at, false
    );
  end if;
  update public.work_sessions
  set started_at = p_started_at,
      ended_at = p_ended_at,
      local_work_date = new_date,
      timezone = p_timezone,
      notes = p_notes
  where id = p_session_id and user_id = owner_id;
  perform public.recalculate_work_week(owner_id, shift_row.job_id, old_date);
  if new_date <> old_date then
    perform public.recalculate_work_week(owner_id, shift_row.job_id, new_date);
  end if;
end;
$$;

create or replace function public.delete_work_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  shift_row public.work_sessions%rowtype;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  select * into shift_row from public.work_sessions
  where id = p_session_id and user_id = owner_id for update;
  if not found or shift_row.ended_at is null then
    raise exception 'Completed work session not found';
  end if;
  delete from public.work_sessions where id = p_session_id and user_id = owner_id;
  perform public.recalculate_work_week(owner_id, shift_row.job_id, shift_row.local_work_date);
end;
$$;

create or replace function public.start_work_break(p_session_id uuid, p_is_paid boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  break_id uuid;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  perform 1 from public.work_sessions
  where id = p_session_id and user_id = owner_id and ended_at is null
  for update;
  if not found then raise exception 'No active work session found'; end if;
  insert into public.work_breaks(user_id, work_session_id, started_at, is_paid)
  values(owner_id, p_session_id, now(), p_is_paid)
  returning id into break_id;
  return break_id;
end;
$$;

create or replace function public.end_work_break(p_break_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  update public.work_breaks b
  set ended_at = now()
  where b.id = p_break_id and b.user_id = owner_id and b.ended_at is null
    and exists (
      select 1 from public.work_sessions s
      where s.id = b.work_session_id and s.user_id = owner_id and s.ended_at is null
    );
  if not found then raise exception 'No active break found'; end if;
end;
$$;

create or replace function public.finish_work_session(p_session_id uuid, p_notes text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  shift_row public.work_sessions%rowtype;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if char_length(p_notes) > 2000 then raise exception 'Notes are too long'; end if;
  select * into shift_row from public.work_sessions
  where id = p_session_id and user_id = owner_id
  for update;
  if not found or shift_row.ended_at is not null then
    raise exception 'No active work session found';
  end if;
  if exists (
    select 1 from public.work_breaks
    where work_session_id = p_session_id and user_id = owner_id and ended_at is null
  ) then raise exception 'End the active break before clocking out'; end if;
  update public.work_sessions
  set ended_at = now(), notes = p_notes
  where id = p_session_id and user_id = owner_id;
  perform public.recalculate_work_week(owner_id, shift_row.job_id, shift_row.local_work_date);
end;
$$;

drop policy work_sessions_insert_own on public.work_sessions;
drop policy work_sessions_update_own on public.work_sessions;
drop policy work_sessions_delete_own on public.work_sessions;
drop policy work_breaks_insert_own on public.work_breaks;
drop policy work_breaks_update_own on public.work_breaks;
drop policy work_breaks_delete_own on public.work_breaks;

revoke all on function public.recalculate_work_week(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.start_work_session(uuid, text) from public, anon;
revoke all on function public.create_job_with_rate(text, text, text, bigint, bigint, integer, numeric, date) from public, anon;
revoke all on function public.add_hourly_rate(uuid, bigint, bigint, date) from public, anon;
revoke all on function public.record_manual_work_session(uuid, timestamptz, timestamptz, integer, text, text) from public, anon;
revoke all on function public.correct_work_session(uuid, timestamptz, timestamptz, integer, text, text) from public, anon;
revoke all on function public.delete_work_session(uuid) from public, anon;
revoke all on function public.start_work_break(uuid, boolean) from public, anon;
revoke all on function public.end_work_break(uuid) from public, anon;
revoke all on function public.finish_work_session(uuid, text) from public, anon;
grant execute on function public.start_work_session(uuid, text) to authenticated;
grant execute on function public.create_job_with_rate(text, text, text, bigint, bigint, integer, numeric, date) to authenticated;
grant execute on function public.add_hourly_rate(uuid, bigint, bigint, date) to authenticated;
grant execute on function public.record_manual_work_session(uuid, timestamptz, timestamptz, integer, text, text) to authenticated;
grant execute on function public.correct_work_session(uuid, timestamptz, timestamptz, integer, text, text) to authenticated;
grant execute on function public.delete_work_session(uuid) to authenticated;
grant execute on function public.start_work_break(uuid, boolean) to authenticated;
grant execute on function public.end_work_break(uuid) to authenticated;
grant execute on function public.finish_work_session(uuid, text) to authenticated;
