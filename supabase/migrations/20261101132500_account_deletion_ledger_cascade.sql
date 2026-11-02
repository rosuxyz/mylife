create or replace function public.prevent_received_income_ledger_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.income_payment_id is not null
    and exists (select 1 from auth.users where id = old.user_id) then
    raise exception 'Received income ledger entries are immutable; use an adjustment transaction';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.prevent_paid_income_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from auth.users where id = old.user_id) then
    raise exception 'Received income payments cannot be edited or deleted; add a correcting transaction instead';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

alter table public.transactions
  drop constraint transactions_income_payment_fk;
alter table public.transactions
  add constraint transactions_income_payment_fk
  foreign key (income_payment_id, user_id)
  references public.income_payments(id, user_id) on delete cascade;

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

  if not exists (select 1 from auth.users where id = owner_id) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  insert into public.audit_events(user_id, table_name, record_id, action, old_data, new_data)
  values (owner_id, tg_table_name, row_id, tg_op, old_row, new_row);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
