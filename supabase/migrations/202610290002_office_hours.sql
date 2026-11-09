-- Adds faculty-defined recurring office hours. Apply after the initial migration.
create table public.office_hours (
  id uuid primary key default gen_random_uuid(),
  faculty_id uuid not null references public.profiles(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- Sunday = 0
  start_time time not null,
  end_time time not null,
  timezone text not null check (char_length(timezone) between 1 and 100),
  created_at timestamptz not null default now(),
  check (start_time < end_time),
  unique (faculty_id, weekday, start_time, end_time)
);
create index office_hours_faculty on public.office_hours(faculty_id, weekday, start_time);
alter table public.office_hours enable row level security;
create policy office_hours_read on public.office_hours for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = faculty_id
    and p.institution_id = public.current_institution() and p.role = 'faculty' and p.active)
);
grant select on public.office_hours to authenticated;

create function public.add_office_hour(p_weekday integer, p_start time, p_end time, p_timezone text)
returns uuid language plpgsql security definer set search_path = public as $$
declare result uuid;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and active and role = 'faculty') then
    raise exception 'Faculty access required';
  end if;
  if p_weekday is null or p_weekday not between 0 and 6 or p_start is null or p_end is null or p_start >= p_end
     or p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Invalid office hours';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 1));
  if (select count(*) from public.office_hours where faculty_id = auth.uid()) >= 35 then
    raise exception 'Too many office-hour entries';
  end if;
  insert into public.office_hours(faculty_id,weekday,start_time,end_time,timezone)
    values(auth.uid(),p_weekday,p_start,p_end,p_timezone) returning id into result;
  return result;
end $$;

create function public.remove_office_hour(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id=auth.uid() and active and role='faculty') then
    raise exception 'Faculty access required';
  end if;
  delete from public.office_hours where id=p_id and faculty_id=auth.uid();
  if not found then raise exception 'Office hours unavailable'; end if;
end $$;
revoke all on function public.add_office_hour(integer,time,time,text), public.remove_office_hour(uuid) from public;
grant execute on function public.add_office_hour(integer,time,time,text), public.remove_office_hour(uuid) to authenticated;
