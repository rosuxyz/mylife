create or replace function public.get_financial_analytics(
  p_from date,
  p_to date,
  p_granularity text
)
returns table (
  period_start date,
  kind public.transaction_kind,
  category_id uuid,
  currency_code text,
  amount_minor bigint
)
language plpgsql
stable
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3660 then
    raise exception 'Invalid analytics date range';
  end if;
  if p_granularity not in ('week', 'month', 'quarter', 'year') then
    raise exception 'Unsupported analytics granularity';
  end if;
  return query
  select
    (case p_granularity
      when 'week' then date_trunc('day', t.occurred_at at time zone p.timezone)
        - ((extract(dow from t.occurred_at at time zone p.timezone)::integer - p.week_starts_on + 7) % 7) * interval '1 day'
      when 'month' then date_trunc('month', t.occurred_at at time zone p.timezone)
      when 'quarter' then date_trunc('quarter', t.occurred_at at time zone p.timezone)
      else date_trunc('year', t.occurred_at at time zone p.timezone)
    end)::date,
    t.kind,
    t.category_id,
    t.currency_code,
    sum(t.amount_minor)::bigint
  from public.transactions t
  join public.profiles p on p.id = t.user_id
  where t.user_id = auth.uid()
    and t.kind in ('income', 'expense')
    and (t.occurred_at at time zone p.timezone)::date between p_from and p_to
  group by 1, 2, 3, 4
  order by 1, 2;
end;
$$;

create or replace function public.get_work_analytics(
  p_from date,
  p_to date,
  p_granularity text
)
returns table (
  period_start date,
  job_id uuid,
  currency_code text,
  regular_minutes bigint,
  overtime_minutes bigint,
  estimated_gross_minor bigint
)
language plpgsql
stable
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3660 then
    raise exception 'Invalid analytics date range';
  end if;
  if p_granularity not in ('week', 'month', 'quarter', 'year') then
    raise exception 'Unsupported analytics granularity';
  end if;
  return query
  select
    (case p_granularity
      when 'week' then date_trunc('day', s.local_work_date::timestamp)
        - ((extract(dow from s.local_work_date)::integer - p.week_starts_on + 7) % 7) * interval '1 day'
      when 'month' then date_trunc('month', s.local_work_date::timestamp)
      when 'quarter' then date_trunc('quarter', s.local_work_date::timestamp)
      else date_trunc('year', s.local_work_date::timestamp)
    end)::date,
    s.job_id,
    s.currency_code,
    sum(s.regular_minutes)::bigint,
    sum(s.overtime_minutes)::bigint,
    sum(s.estimated_gross_minor)::bigint
  from public.work_sessions s
  join public.profiles p on p.id = s.user_id
  where s.user_id = auth.uid()
    and s.ended_at is not null
    and s.local_work_date between p_from and p_to
  group by 1, 2, 3
  order by 1, 2;
end;
$$;

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  delete from auth.users where id = owner_id;
  if not found then raise exception 'Account not found'; end if;
end;
$$;

revoke all on function public.get_financial_analytics(date, date, text) from public, anon;
revoke all on function public.get_work_analytics(date, date, text) from public, anon;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.get_financial_analytics(date, date, text) to authenticated;
grant execute on function public.get_work_analytics(date, date, text) to authenticated;
grant execute on function public.delete_my_account() to authenticated;
