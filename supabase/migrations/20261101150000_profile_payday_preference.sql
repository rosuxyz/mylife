alter table public.profiles
  add column default_payday_weekday smallint not null default 5
    check (default_payday_weekday between 0 and 6);
