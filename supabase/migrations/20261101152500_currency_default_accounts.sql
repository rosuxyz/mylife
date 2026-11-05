drop index if exists public.accounts_one_default_per_user;

create unique index accounts_one_default_per_currency
  on public.accounts(user_id, currency_code)
  where is_default and archived_at is null;

create or replace function public.ensure_currency_default_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.archived_at is null and not exists (
    select 1
    from public.accounts
    where user_id = new.user_id
      and currency_code = new.currency_code
      and is_default
      and archived_at is null
      and id <> new.id
  ) then
    new.is_default := true;
  end if;
  return new;
end;
$$;

create trigger accounts_ensure_currency_default
  before insert or update of currency_code, archived_at, is_default
  on public.accounts
  for each row execute function public.ensure_currency_default_account();

update public.accounts as account
set is_default = true
where account.archived_at is null
  and not exists (
    select 1
    from public.accounts as existing
    where existing.user_id = account.user_id
      and existing.currency_code = account.currency_code
      and existing.is_default
      and existing.archived_at is null
  )
  and account.id = (
    select candidate.id
    from public.accounts as candidate
    where candidate.user_id = account.user_id
      and candidate.currency_code = account.currency_code
      and candidate.archived_at is null
    order by candidate.created_at, candidate.id
    limit 1
  );
