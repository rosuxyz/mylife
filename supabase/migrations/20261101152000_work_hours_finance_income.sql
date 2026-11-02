alter table public.daily_work_hours
  add column currency_code text not null default 'GBP'
    check (currency_code ~ '^[A-Z]{3}$'),
  add column post_earnings_to_finance boolean not null default false,
  add constraint daily_work_hours_id_user_key unique (id, user_id);

update public.daily_work_hours as work
set currency_code = coalesce(
  (select job.currency_code from public.jobs as job where job.id = work.job_id and job.user_id = work.user_id),
  (select profile.currency_code from public.profiles as profile where profile.id = work.user_id),
  'GBP'
);

alter table public.transactions
  add column work_entry_id uuid unique,
  add constraint transactions_work_entry_owner_fk
    foreign key (work_entry_id, user_id)
    references public.daily_work_hours(id, user_id)
    on delete cascade;

drop policy transactions_insert_own on public.transactions;
create policy transactions_insert_own on public.transactions
  for insert to authenticated
  with check (user_id = (select auth.uid()) and work_entry_id is null);

drop policy transactions_update_own on public.transactions;
create policy transactions_update_own on public.transactions
  for update to authenticated
  using (user_id = (select auth.uid()) and income_payment_id is null and work_entry_id is null)
  with check (user_id = (select auth.uid()) and income_payment_id is null and work_entry_id is null);

drop policy transactions_delete_own on public.transactions;
create policy transactions_delete_own on public.transactions
  for delete to authenticated
  using (user_id = (select auth.uid()) and income_payment_id is null and work_entry_id is null);

create or replace function public.post_daily_work_earnings_to_finance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_timezone text;
  default_account_id uuid;
  salary_category_id uuid;
  earnings_at timestamptz;
  earnings_description text;
begin
  if not new.post_earnings_to_finance then
    delete from public.transactions
    where work_entry_id = new.id and user_id = new.user_id;
    return new;
  end if;

  if new.calculated_earnings_minor is null or new.calculated_earnings_minor = 0 then
    delete from public.transactions
    where work_entry_id = new.id and user_id = new.user_id;
    return new;
  end if;

  select timezone
    into profile_timezone
  from public.profiles
  where id = new.user_id;

  if profile_timezone is null then
    raise exception 'Finance profile could not be found';
  end if;

  select id into default_account_id
  from public.accounts
  where user_id = new.user_id
    and is_default
    and archived_at is null
    and currency_code = new.currency_code;

  if default_account_id is null then
    raise exception 'Add an active default Finance account in the work record currency before saving work';
  end if;

  select id into salary_category_id
  from public.categories
  where user_id = new.user_id
    and kind = 'income'
    and name = 'Salary'
  limit 1;

  earnings_at := (new.work_date::timestamp + time '12:00')
    at time zone coalesce(profile_timezone, 'Europe/London');
  earnings_description := 'Work earnings'
    || case when char_length(trim(new.employer_snapshot)) > 0
      then ' · ' || trim(new.employer_snapshot) else '' end
    || ' · ' || new.work_date::text;

  insert into public.transactions (
    user_id,
    kind,
    category_id,
    account_id,
    work_entry_id,
    amount_minor,
    currency_code,
    occurred_at,
    description,
    payment_method,
    notes
  ) values (
    new.user_id,
    'income',
    salary_category_id,
    default_account_id,
    new.id,
    new.calculated_earnings_minor,
    new.currency_code,
    earnings_at,
    earnings_description,
    'bank_transfer',
    'Automatically calculated from a daily work record.'
  )
  on conflict (work_entry_id) do update set
    category_id = excluded.category_id,
    account_id = excluded.account_id,
    amount_minor = excluded.amount_minor,
    currency_code = excluded.currency_code,
    occurred_at = excluded.occurred_at,
    description = excluded.description,
    payment_method = excluded.payment_method,
    notes = excluded.notes;

  return new;
end;
$$;

create trigger daily_work_hours_post_finance_income
  after insert or update on public.daily_work_hours
  for each row execute function public.post_daily_work_earnings_to_finance();
