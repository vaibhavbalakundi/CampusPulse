-- Student waiting place (no peer names) + faculty view of open follow-ups they assigned.

create or replace function public.student_waiting_places()
returns table (
  faculty_id uuid,
  waiting integer,
  my_place integer,
  cap integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  campus uuid;
  next_cap integer := 5;
begin
  select institution_id into campus
  from public.profiles
  where id = auth.uid() and active and role = 'student';
  if campus is null then
    return;
  end if;

  insert into public.institution_settings(institution_id) values (campus) on conflict do nothing;
  select coalesce(s.waiting_cap, 5) into next_cap
  from public.institution_settings s
  where s.institution_id = campus;

  return query
  with pending as (
    select mr.faculty_id, mr.student_id, mr.created_at
    from public.meeting_requests mr
    where mr.institution_id = campus
      and mr.status = 'pending'
  ),
  counts as (
    select p.faculty_id, count(*)::integer as waiting
    from pending p
    group by p.faculty_id
  ),
  mine as (
    select distinct on (p.faculty_id) p.faculty_id, p.created_at
    from pending p
    where p.student_id = auth.uid()
    order by p.faculty_id, p.created_at
  )
  select
    c.faculty_id,
    c.waiting,
    case
      when m.faculty_id is null then null
      else (
        select count(*)::integer + 1
        from pending p
        where p.faculty_id = c.faculty_id
          and p.created_at < m.created_at
      )
    end as my_place,
    next_cap as cap
  from counts c
  left join mine m on m.faculty_id = c.faculty_id;
end;
$$;

revoke all on function public.student_waiting_places() from public, anon;
grant execute on function public.student_waiting_places() to authenticated;

-- Faculty may see open personal deadlines they can reasonably follow (same campus students
-- they have a recent meeting request with). Title + due only; no other student private notes.
create or replace function public.faculty_open_followups()
returns table (
  student_id uuid,
  title text,
  due_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  campus uuid;
begin
  select institution_id into campus
  from public.profiles
  where id = auth.uid() and active and role = 'faculty';
  if campus is null then
    return;
  end if;

  return query
  select d.owner_id, d.title, d.due_at
  from public.personal_deadlines d
  where d.institution_id = campus
    and d.done = false
    and d.due_at >= now() - interval '1 day'
    and exists (
      select 1
      from public.meeting_requests mr
      where mr.faculty_id = auth.uid()
        and mr.student_id = d.owner_id
        and mr.institution_id = campus
        and mr.created_at >= now() - interval '90 days'
    )
  order by d.due_at
  limit 100;
end;
$$;

revoke all on function public.faculty_open_followups() from public, anon;
grant execute on function public.faculty_open_followups() to authenticated;
