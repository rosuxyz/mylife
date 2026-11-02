create table public.debt_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  person_name text not null check (char_length(trim(person_name)) between 1 and 120),
  direction text not null check (direction in ('lent', 'borrowed')),
  amount_minor bigint not null check (amount_minor > 0),
  occurred_at timestamptz not null default timezone('utc', now()),
  note text not null default '' check (char_length(note) <= 2000),
  status text not null default 'outstanding' check (status in ('outstanding', 'partially_repaid', 'repaid')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id)
);
create index debt_records_user_occurred_idx on public.debt_records(user_id, occurred_at desc);

create table public.debt_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  debt_id uuid not null references public.debt_records(id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0),
  paid_at timestamptz not null default timezone('utc', now()),
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id)
);
create index debt_payments_debt_paid_idx on public.debt_payments(debt_id, paid_at desc);

create trigger debt_records_set_updated_at
  before update on public.debt_records
  for each row execute function public.set_updated_at();

create trigger debt_payments_set_updated_at
  before update on public.debt_payments
  for each row execute function public.set_updated_at();

alter table public.debt_records enable row level security;
alter table public.debt_payments enable row level security;

create policy debt_records_select_own on public.debt_records
  for select to authenticated
  using (user_id = auth.uid());

create policy debt_records_insert_own on public.debt_records
  for insert to authenticated
  with check (user_id = auth.uid());

create policy debt_records_update_own on public.debt_records
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy debt_records_delete_own on public.debt_records
  for delete to authenticated
  using (user_id = auth.uid());

create policy debt_payments_select_own on public.debt_payments
  for select to authenticated
  using (user_id = auth.uid());

create policy debt_payments_insert_own on public.debt_payments
  for insert to authenticated
  with check (user_id = auth.uid());

create policy debt_payments_update_own on public.debt_payments
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy debt_payments_delete_own on public.debt_payments
  for delete to authenticated
  using (user_id = auth.uid());
