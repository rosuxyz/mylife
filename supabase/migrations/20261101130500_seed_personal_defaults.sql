create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''));

  insert into public.accounts (user_id, name, account_type, currency_code, is_default)
  values (new.id, 'Main account', 'checking', 'GBP', true);

  insert into public.categories (user_id, name, kind, color, is_default)
  values
    (new.id, 'Salary', 'income', '#69C99A', true),
    (new.id, 'Other income', 'income', '#89A9E3', true),
    (new.id, 'Rent', 'expense', '#89A9E3', true),
    (new.id, 'Food', 'expense', '#69C99A', true),
    (new.id, 'Transport', 'expense', '#D7AD72', true),
    (new.id, 'Shopping', 'expense', '#B29BE4', true),
    (new.id, 'Bills', 'expense', '#8993A5', true),
    (new.id, 'Entertainment', 'expense', '#D68C9D', true),
    (new.id, 'Health', 'expense', '#82B8B3', true),
    (new.id, 'Education', 'expense', '#B6A477', true),
    (new.id, 'Subscriptions', 'expense', '#A78BB7', true),
    (new.id, 'Other', 'expense', '#626773', true);

  return new;
end;
$$;
