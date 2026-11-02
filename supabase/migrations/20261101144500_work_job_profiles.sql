alter table public.jobs
  drop constraint jobs_title_check,
  add constraint jobs_title_check
    check (title = '' or char_length(trim(title)) between 1 and 120);

alter table public.daily_work_hours
  add column job_id uuid,
  add column employer_snapshot text not null default ''
    check (char_length(employer_snapshot) <= 120),
  add constraint daily_work_hours_job_owner_fk
    foreign key (job_id, user_id)
    references public.jobs(id, user_id)
    on delete set null (job_id);

create index daily_work_hours_user_job_idx
  on public.daily_work_hours(user_id, job_id)
  where job_id is not null;

create or replace function public.create_work_job_profile(
  p_employer text,
  p_title text,
  p_currency_code text,
  p_hourly_rate_minor bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  profile_id uuid;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if char_length(trim(p_employer)) not between 1 and 120
    or char_length(trim(p_title)) > 120
    or p_currency_code !~ '^[A-Z]{3}$'
    or p_hourly_rate_minor <= 0
    or p_hourly_rate_minor > 100000000 then
    raise exception 'Invalid job profile details';
  end if;

  insert into public.jobs(user_id, employer, title, currency_code)
  values (owner_id, trim(p_employer), trim(p_title), p_currency_code)
  returning id into profile_id;

  insert into public.hourly_rates(user_id, job_id, hourly_rate_minor, effective_from)
  values (owner_id, profile_id, p_hourly_rate_minor, current_date);

  return profile_id;
end;
$$;

create or replace function public.update_work_job_profile(
  p_job_id uuid,
  p_employer text,
  p_title text,
  p_hourly_rate_minor bigint,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  current_rate public.hourly_rates%rowtype;
  next_rate_date date;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if char_length(trim(p_employer)) not between 1 and 120
    or char_length(trim(p_title)) > 120
    or p_hourly_rate_minor <= 0
    or p_hourly_rate_minor > 100000000 then
    raise exception 'Invalid job profile details';
  end if;

  update public.jobs
  set employer = trim(p_employer),
      title = trim(p_title),
      archived_at = case when p_is_active then null else coalesce(archived_at, timezone('utc', now())) end
  where id = p_job_id and user_id = owner_id;
  if not found then raise exception 'Job profile not found'; end if;

  select * into current_rate
  from public.hourly_rates
  where job_id = p_job_id
    and user_id = owner_id
    and effective_from <= current_date
    and (effective_to is null or effective_to >= current_date)
  order by effective_from desc
  limit 1
  for update;

  if current_rate.id is not null
    and current_rate.hourly_rate_minor = p_hourly_rate_minor then
    return;
  end if;

  select min(effective_from) into next_rate_date
  from public.hourly_rates
  where job_id = p_job_id
    and user_id = owner_id
    and effective_from > current_date;

  if current_rate.id is not null then
    if current_rate.effective_from = current_date then
      update public.hourly_rates
      set hourly_rate_minor = p_hourly_rate_minor
      where id = current_rate.id and user_id = owner_id;
      return;
    end if;
    update public.hourly_rates
    set effective_to = current_date - 1
    where id = current_rate.id and user_id = owner_id;
  end if;

  insert into public.hourly_rates(
    user_id, job_id, hourly_rate_minor, effective_from, effective_to
  )
  values (
    owner_id,
    p_job_id,
    p_hourly_rate_minor,
    current_date,
    case when next_rate_date is null then null else next_rate_date - 1 end
  );
end;
$$;

create or replace function public.delete_work_job_profile(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
begin
  if owner_id is null then raise exception 'Authentication required'; end if;

  if exists (
    select 1 from public.work_sessions
    where job_id = p_job_id and user_id = owner_id
  ) or exists (
    select 1 from public.income_records
    where job_id = p_job_id and user_id = owner_id
  ) then
    raise exception 'This profile is linked to existing income or work history; deactivate it to preserve those records';
  end if;

  delete from public.hourly_rates
  where job_id = p_job_id and user_id = owner_id;

  delete from public.jobs
  where id = p_job_id and user_id = owner_id;
  if not found then raise exception 'Job profile not found'; end if;
end;
$$;

grant execute on function public.create_work_job_profile(text, text, text, bigint) to authenticated;
grant execute on function public.update_work_job_profile(uuid, text, text, bigint, boolean) to authenticated;
grant execute on function public.delete_work_job_profile(uuid) to authenticated;
