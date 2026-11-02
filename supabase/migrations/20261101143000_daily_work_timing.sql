alter table public.profiles
  add column default_hourly_rate_minor bigint not null default 0
    check (default_hourly_rate_minor between 0 and 100000000);

alter table public.daily_work_hours
  add column start_time time,
  add column end_time time,
  add column break_minutes integer,
  add column net_working_minutes integer,
  add column hourly_rate_snapshot_minor bigint,
  add column calculated_earnings_minor bigint;

alter table public.daily_work_hours
  add constraint daily_work_hours_timed_entry_check
  check (
    (
      start_time is null
      and end_time is null
      and break_minutes is null
      and net_working_minutes is null
      and hourly_rate_snapshot_minor is null
      and calculated_earnings_minor is null
    )
    or (
      start_time is not null
      and end_time is not null
      and break_minutes is not null
      and net_working_minutes is not null
      and hourly_rate_snapshot_minor is not null
      and calculated_earnings_minor is not null
      and break_minutes between 0 and 1440
      and net_working_minutes between 0 and 1440
      and hourly_rate_snapshot_minor > 0
      and calculated_earnings_minor >= 0
      and break_minutes <= case
        when end_time > start_time
          then (extract(epoch from (end_time - start_time)) / 60)::integer
        else (extract(epoch from (end_time - start_time)) / 60)::integer + 1440
      end
      and net_working_minutes = case
        when end_time > start_time
          then (extract(epoch from (end_time - start_time)) / 60)::integer
        else (extract(epoch from (end_time - start_time)) / 60)::integer + 1440
      end - break_minutes
      and hours_worked = round(net_working_minutes::numeric / 60, 2)
      and calculated_earnings_minor = round(
        net_working_minutes::numeric * hourly_rate_snapshot_minor / 60
      )::bigint
    )
  );

grant select, insert, update, delete on public.daily_work_hours to authenticated;
