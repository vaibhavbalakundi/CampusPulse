-- Remaining opportunity-map: retention, auto-busy, ask patterns,
-- faculty follow-ups, abuse signals, server-side people search.

alter table public.profiles
  add column if not exists auto_busy_outside_hours boolean not null default false;

alter table public.institution_settings
  add column if not exists retention_days integer not null default 45
    check (retention_days between 7 and 365);

drop function if exists public.get_institution_settings();

create or replace function public.get_institution_settings()
returns table (waiting_cap integer, retention_days integer)
language plpgsql security definer set search_path = public as $$
declare campus uuid := public.current_institution();
begin
  if campus is null then raise exception 'Active account required'; end if;
  insert into public.institution_settings(institution_id) values (campus) on conflict do nothing;
  return query
    select s.waiting_cap, s.retention_days
    from public.institution_settings s
    where s.institution_id = campus;
end $$;

drop function if exists public.admin_update_institution_settings(integer);

create or replace function public.admin_update_institution_settings(
  p_waiting_cap integer,
  p_retention_days integer default null
) returns void language plpgsql security definer set search_path = public as $$
declare campus uuid;
  next_cap integer;
  next_days integer;
begin
  select institution_id into campus from public.profiles where id = auth.uid() and active and role = 'admin';
  if campus is null then raise exception 'Administrator access required'; end if;
  insert into public.institution_settings(institution_id) values (campus) on conflict do nothing;
  select waiting_cap, retention_days into next_cap, next_days
    from public.institution_settings where institution_id = campus;
  if p_waiting_cap is not null then
    if p_waiting_cap < 1 or p_waiting_cap > 50 then raise exception 'Waiting cap must be 1 to 50'; end if;
    next_cap := p_waiting_cap;
  end if;
  if p_retention_days is not null then
    if p_retention_days < 7 or p_retention_days > 365 then raise exception 'Retention must be 7 to 365 days'; end if;
    next_days := p_retention_days;
  end if;
  update public.institution_settings
    set waiting_cap = next_cap,
        retention_days = next_days,
        updated_at = now(),
        updated_by = auth.uid()
    where institution_id = campus;
end $$;

drop function if exists public.set_faculty_inbox_prefs(boolean, time, time, text[]);

create or replace function public.set_faculty_inbox_prefs(
  p_pause boolean,
  p_quiet_start time,
  p_quiet_end time,
  p_snippets text[],
  p_auto_busy boolean default null
) returns void language plpgsql security definer set search_path = public as $$
declare clean text[] := '{}';
  item text;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and active and role = 'faculty') then
    raise exception 'Faculty access required';
  end if;
  if p_snippets is not null then
    foreach item in array p_snippets loop
      item := btrim(coalesce(item, ''));
      if item <> '' and char_length(item) <= 120 then
        clean := array_append(clean, item);
      end if;
      if cardinality(clean) >= 12 then exit; end if;
    end loop;
  end if;
  update public.profiles set
    pause_requests = coalesce(p_pause, false),
    quiet_start = p_quiet_start,
    quiet_end = p_quiet_end,
    reply_snippets = clean,
    auto_busy_outside_hours = coalesce(p_auto_busy, auto_busy_outside_hours)
  where id = auth.uid();
end $$;

create or replace function public.create_timed_meeting_request(
  p_faculty uuid,
  p_reason text,
  p_meeting_at timestamptz,
  p_voice_path text default null,
  p_submission_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  campus uuid;
  clean_reason text := btrim(coalesce(p_reason, ''));
  result uuid;
  retain integer := 45;
  waiting integer;
  cap integer := 5;
  paused boolean;
  on_leave boolean;
begin
  select institution_id into campus from public.profiles where id = auth.uid() and active and role = 'student';
  if campus is null then raise exception 'Student access required'; end if;
  if p_meeting_at is null or p_meeting_at <= now() then raise exception 'Choose a future meeting time'; end if;
  if char_length(clean_reason) < 3 or char_length(clean_reason) > 500 then raise exception 'Add a short reason'; end if;
  if not exists (
    select 1 from public.profiles
    where id = p_faculty and institution_id = campus and active and role = 'faculty'
  ) then raise exception 'Faculty not found'; end if;

  select coalesce(pause_requests, false) into paused from public.profiles where id = p_faculty;
  if paused then raise exception 'This faculty member is not taking new requests right now'; end if;

  select exists (
    select 1 from public.faculty_leave_days
    where faculty_id = p_faculty and leave_on = (p_meeting_at at time zone 'UTC')::date
  ) into on_leave;
  -- leave check is advisory only for UTC day; client also checks local leave days

  insert into public.institution_settings(institution_id) values (campus) on conflict do nothing;
  select waiting_cap, retention_days into cap, retain
    from public.institution_settings where institution_id = campus;

  select count(*) into waiting
    from public.meeting_requests
    where faculty_id = p_faculty and status = 'pending';
  if waiting >= cap then raise exception 'This faculty member already has too many waiting requests'; end if;

  if (select count(*) from public.meeting_requests
      where student_id = auth.uid() and status = 'pending') >= 8 then
    raise exception 'Finish or cancel an open request first';
  end if;

  insert into public.meeting_requests(
    institution_id, student_id, faculty_id, reason, preferred_time,
    requested_for, meeting_at, purge_after, request_voice_path, submission_id
  ) values (
    campus, auth.uid(), p_faculty, clean_reason, p_meeting_at::text,
    p_meeting_at, p_meeting_at, p_meeting_at + make_interval(days => retain),
    p_voice_path, p_submission_id
  ) returning id into result;

  insert into public.notifications(recipient_id, request_id, message)
    values (p_faculty, result, 'You have a new meeting request.');
  return result;
end $$;

create or replace function public.faculty_ask_weekday_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare campus uuid;
begin
  select institution_id into campus from public.profiles where id = auth.uid() and active and role = 'faculty';
  if campus is null then raise exception 'Faculty access required'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'weekday', weekday,
      'label', case weekday
        when 0 then 'Sun' when 1 then 'Mon' when 2 then 'Tue' when 3 then 'Wed'
        when 4 then 'Thu' when 5 then 'Fri' else 'Sat' end,
      'count', cnt
      ) order by weekday)
    from (
      select extract(dow from created_at at time zone 'UTC')::integer as weekday,
             count(*)::integer as cnt
      from public.meeting_requests
      where faculty_id = auth.uid()
        and institution_id = campus
        and created_at >= now() - interval '56 days'
      group by 1
    ) t
  ), '[]'::jsonb);
end $$;

create or replace function public.assign_student_followup(
  p_student uuid,
  p_title text,
  p_due timestamptz
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  campus uuid;
  clean text := btrim(coalesce(p_title, ''));
  result uuid;
begin
  select institution_id into campus from public.profiles where id = auth.uid() and active and role = 'faculty';
  if campus is null then raise exception 'Faculty access required'; end if;
  if p_student is null then raise exception 'Choose a student'; end if;
  if p_due is null or p_due <= now() then raise exception 'Choose a future due time'; end if;
  if char_length(clean) < 3 or char_length(clean) > 200 then raise exception 'Title must be 3 to 200 characters'; end if;
  if not exists (
    select 1 from public.profiles
    where id = p_student and institution_id = campus and active and role = 'student'
  ) then raise exception 'Student not found'; end if;
  if not exists (
    select 1 from public.meeting_requests
    where faculty_id = auth.uid()
      and student_id = p_student
      and institution_id = campus
      and status in ('accepted', 'alternative', 'pending', 'expired')
      and created_at >= now() - interval '90 days'
  ) then raise exception 'You can only assign a follow-up after a recent meeting request with this student'; end if;
  if (select count(*) from public.personal_deadlines
      where owner_id = p_student and done = false) >= 50 then
    raise exception 'This student already has too many open deadlines';
  end if;
  insert into public.personal_deadlines(institution_id, owner_id, title, due_at)
    values (campus, p_student, clean, p_due)
    returning id into result;
  insert into public.notifications(recipient_id, message)
    values (p_student, 'A faculty member added a follow-up for you: ' || left(clean, 80));
  return result;
end $$;

create or replace function public.admin_people_search(
  p_query text default '',
  p_role text default null,
  p_active boolean default null,
  p_limit integer default 50,
  p_offset integer default 0
) returns table (
  id uuid,
  name text,
  role text,
  department text,
  email text,
  active boolean,
  total_count bigint
) language plpgsql stable security definer set search_path = public as $$
declare campus uuid;
  q text := lower(btrim(coalesce(p_query, '')));
  lim integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  off integer := greatest(coalesce(p_offset, 0), 0);
begin
  select institution_id into campus from public.profiles where id = auth.uid() and active and role = 'admin';
  if campus is null then raise exception 'Administrator access required'; end if;
  if p_role is not null and p_role not in ('student', 'faculty', 'admin') then
    raise exception 'Invalid role filter';
  end if;
  return query
  with matched as (
    select p.id, p.name, p.role::text as role, p.department, coalesce(u.email, '') as email, p.active
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.institution_id = campus
      and (p_role is null or p.role::text = p_role)
      and (p_active is null or p.active = p_active)
      and (
        q = '' or
        lower(p.name) like '%' || q || '%' or
        lower(coalesce(p.department, '')) like '%' || q || '%' or
        lower(coalesce(u.email, '')) like '%' || q || '%'
      )
  ), counted as (
    select count(*)::bigint as total_count from matched
  )
  select m.id, m.name, m.role, m.department, m.email, m.active, c.total_count
  from matched m
  cross join counted c
  order by m.name
  limit lim offset off;
end $$;

create or replace function public.admin_usage_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare campus uuid;
begin
  select institution_id into campus from public.profiles where id = auth.uid() and active and role = 'admin';
  if campus is null then raise exception 'Administrator access required'; end if;
  return jsonb_build_object(
    'active_students', (select count(*) from public.profiles where institution_id = campus and role = 'student' and active),
    'active_faculty', (select count(*) from public.profiles where institution_id = campus and role = 'faculty' and active),
    'inactive_profiles', (select count(*) from public.profiles where institution_id = campus and not active),
    'requests_last_7_days', (select count(*) from public.meeting_requests where institution_id = campus and created_at >= now() - interval '7 days'),
    'requests_last_24_hours', (select count(*) from public.meeting_requests where institution_id = campus and created_at >= now() - interval '24 hours'),
    'pending_requests', (select count(*) from public.meeting_requests where institution_id = campus and status = 'pending'),
    'accepted_last_7_days', (select count(*) from public.meeting_requests where institution_id = campus and status = 'accepted' and updated_at >= now() - interval '7 days'),
    'declined_last_7_days', (select count(*) from public.meeting_requests where institution_id = campus and status = 'declined' and updated_at >= now() - interval '7 days'),
    'alternative_last_7_days', (select count(*) from public.meeting_requests where institution_id = campus and status = 'alternative' and updated_at >= now() - interval '7 days'),
    'students_with_many_pending', (
      select count(*) from (
        select student_id from public.meeting_requests
        where institution_id = campus and status = 'pending'
        group by student_id having count(*) >= 4
      ) t
    ),
    'faculty_paused', (select count(*) from public.profiles where institution_id = campus and role = 'faculty' and active and pause_requests),
    'open_privacy_requests', (select count(*) from public.privacy_requests where institution_id = campus and status = 'open'),
    'median_response_hours', (
      select round((percentile_cont(0.5) within group (
        order by extract(epoch from (updated_at - created_at)) / 3600.0
      ))::numeric, 1)
      from public.meeting_requests
      where institution_id = campus
        and status in ('accepted', 'declined', 'alternative')
        and updated_at >= now() - interval '7 days'
        and updated_at > created_at
    )
  );
end $$;

revoke all on function public.get_institution_settings(),
  public.admin_update_institution_settings(integer, integer),
  public.set_faculty_inbox_prefs(boolean, time, time, text[], boolean),
  public.create_timed_meeting_request(uuid, text, timestamptz, text, uuid),
  public.faculty_ask_weekday_summary(),
  public.assign_student_followup(uuid, text, timestamptz),
  public.admin_people_search(text, text, boolean, integer, integer),
  public.admin_usage_summary()
  from public, anon;

grant execute on function public.get_institution_settings(),
  public.admin_update_institution_settings(integer, integer),
  public.set_faculty_inbox_prefs(boolean, time, time, text[], boolean),
  public.create_timed_meeting_request(uuid, text, timestamptz, text, uuid),
  public.faculty_ask_weekday_summary(),
  public.assign_student_followup(uuid, text, timestamptz),
  public.admin_people_search(text, text, boolean, integer, integer),
  public.admin_usage_summary()
  to authenticated;
