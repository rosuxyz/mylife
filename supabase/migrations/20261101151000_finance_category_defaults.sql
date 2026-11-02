create or replace function public.seed_additional_finance_categories()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.categories (user_id, name, kind, color, is_default)
  values
    (new.id, 'Groceries', 'expense', '#69C99A', true),
    (new.id, 'Personal', 'expense', '#B29BE4', true),
    (new.id, 'Household', 'expense', '#8993A5', true),
    (new.id, 'Travel', 'expense', '#D7AD72', true),
    (new.id, 'Clothing', 'expense', '#D68C9D', true),
    (new.id, 'Gifts', 'expense', '#89A9E3', true)
  on conflict (user_id, name, kind) do nothing;
  return new;
end;
$$;

create trigger profiles_seed_additional_finance_categories
  after insert on public.profiles
  for each row execute function public.seed_additional_finance_categories();

insert into public.categories (user_id, name, kind, color, is_default)
select profile.id, defaults.name, 'expense', defaults.color, true
from public.profiles as profile
cross join (values
  ('Groceries', '#69C99A'),
  ('Personal', '#B29BE4'),
  ('Household', '#8993A5'),
  ('Travel', '#D7AD72'),
  ('Clothing', '#D68C9D'),
  ('Gifts', '#89A9E3')
) as defaults(name, color)
on conflict (user_id, name, kind) do nothing;
