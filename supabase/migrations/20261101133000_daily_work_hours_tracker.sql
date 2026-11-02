create table public.daily_work_hours (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  work_date date not null,
  hours_worked numeric(5, 2) not null default 0 check (hours_worked >= 0 and hours_worked <= 24),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, work_date)
);

create index daily_work_hours_user_date_idx
  on public.daily_work_hours(user_id, work_date desc);

create trigger daily_work_hours_set_updated_at
  before update on public.daily_work_hours
  for each row execute function public.set_updated_at();

alter table public.daily_work_hours enable row level security;

create policy daily_work_hours_select_own
  on public.daily_work_hours for select
  to authenticated using (user_id = auth.uid());

create policy daily_work_hours_insert_own
  on public.daily_work_hours for insert
  to authenticated with check (user_id = auth.uid());

create policy daily_work_hours_update_own
  on public.daily_work_hours for update
  to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy daily_work_hours_delete_own
  on public.daily_work_hours for delete
  to authenticated using (user_id = auth.uid());
