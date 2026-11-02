alter table public.profiles
  add column default_break_minutes integer not null default 0
    check (default_break_minutes between 0 and 1440),
  add column default_job_id uuid;

alter table public.profiles
  add constraint profiles_default_job_owner_fk
  foreign key (default_job_id, id)
  references public.jobs(id, user_id)
  on delete set null (default_job_id);
