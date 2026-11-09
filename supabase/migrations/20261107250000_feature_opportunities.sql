-- Feature opportunities: pause inbox, leave days, snippets, quiet hours,
-- institution policy, privacy requests, accept-alternative, waiting cap.

alter table public.profiles
  add column if not exists pause_requests boolean not null default false,
  add column if not exists quiet_start time,
  add column if not exists quiet_end time,
  add column if not exists reply_snippets text[] not null default '{}'::text[];

do $$ begin
  alter table public.profiles
    add constraint profiles_reply_snippets_len check (coalesce(cardinality(reply_snippets), 0) <= 12);
exception when duplicate_object then null;
end $$;

create table if not exists public.faculty_leave_days (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  faculty_id uuid not null references public.profiles(id) on delete cascade,
  leave_on date not null,
  note text not null default '' check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  unique (faculty_id, leave_on)
);
create index if not exists faculty_leave_days_faculty on public.faculty_leave_days(faculty_id, leave_on);

alter table public.faculty_leave_days enable row level security;
drop policy if exists leave_read on public.faculty_leave_days;
create policy leave_read on public.faculty_leave_days for select to authenticated
  using (institution_id = public.current_institution());

create table if not exists public.institution_settings (
  institution_id uuid primary key references public.institutions(id) on delete cascade,
  waiting_cap integer not null default 5 check (waiting_cap between 1 and 50),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

alter table public.institution_settings enable row level security;
drop policy if exists institution_settings_read on public.institution_settings;
create policy institution_settings_read on public.institution_settings for select to authenticated
  using (institution_id = public.current_institution());

create table if not exists public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('export', 'delete')),
  note text not null default '' check (char_length(note) <= 500),
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id)
);
create index if not exists privacy_requests_campus on public.privacy_requests(institution_id, status, created_at desc);

alter table public.privacy_requests enable row level security;
drop policy if exists privacy_requests_own on public.privacy_requests;
create policy privacy_requests_own on public.privacy_requests for select to authenticated
  using (user_id = auth.uid() or public.is_institution_admin());

create or replace function public.get_institution_settings()
returns table (waiting_cap integer)
language plpgsql security definer set search_path = public as $$
declare campus uuid := public.current_institution();
begin
  if campus is null then raise exception 'Active account required'; end if;
  insert into public.institution_settings(institution_id) values (campus) on conflict do nothing;
  return query select s.waiting_cap from public.institution_settings s where s.institution_id = campus;
end $$;

create or replace function public.admin_update_institution_settings(p_waiting_cap integer)
returns void language plpgsql security definer set search_path = public as $$
declare campus uuid;
begin
  select institution_id into campus from public.profiles where id = auth.uid() and active and role = 'admin';
  if campus is null then raise exception 'Administrator access required'; end if;
  if p_waiting_cap is null or p_waiting_cap < 1 or p_waiting_cap > 50 then raise exception 'Waiting cap must be 1 to 50'; end if;
  insert into public.institution_settings(institution_id, waiting_cap, updated_at, updated_by)
  values (campus, p_waiting_cap, now(), auth.uid())
  on conflict (institution_id) do update
    set waiting_cap = excluded.waiting_cap, updated_at = now(), updated_by = auth.uid();
end $$;

create or replace function public.set_faculty_inbox_prefs(
  p_pause boolean,
  p_quiet_start time,
  p_quiet_end time,
  p_snippets text[]
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
    reply_snippets = clean
  where id = auth.uid();
end $$;

create or replace function public.set_faculty_leave_day(p_leave_on date, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare campus uuid; result uuid; clean text := btrim(coalesce(p_note, ''));
begin
  select institution_id into campus from public.profiles where id = auth.uid() and active and role = 'faculty';
  if campus is null then raise exception 'Faculty access required'; end if;
  if p_leave_on is null then raise exception 'Choose a leave day'; end if;
  if char_length(clean) > 200 then raise exception 'Note is too long'; end if;
  insert into public.faculty_leave_days(institution_id, faculty_id, leave_on, note)
  values (campus, auth.uid(), p_leave_on, clean)
  on conflict (faculty_id, leave_on) do update set note = excluded.note
  returning id into result;
  return result;
end $$;

create or replace function public.remove_faculty_leave_day(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.faculty_leave_days where id = p_id and faculty_id = auth.uid();
end $$;

create or replace function public.submit_privacy_request(p_kind text, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare campus uuid; result uuid; clean text := btrim(coalesce(p_note, ''));
begin
  select institution_id into campus from public.profiles where id = auth.uid() and active;
  if campus is null then raise exception 'Active account required'; end if;
  if p_kind is null or p_kind not in ('export', 'delete') then raise exception 'Choose export or delete'; end if;
  if char_length(clean) > 500 then raise exception 'Note is too long'; end if;
  if exists (select 1 from public.privacy_requests where user_id = auth.uid() and status = 'open' and kind = p_kind) then
    raise exception 'You already have an open request of this type';
  end if;
  insert into public.privacy_requests(institution_id, user_id, kind, note)
  values (campus, auth.uid(), p_kind, clean) returning id into result;
  return result;
end $$;

create or replace function public.admin_resolve_privacy_request(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare campus uuid;
begin
  select institution_id into campus from public.profiles where id = auth.uid() and active and role = 'admin';
  if campus is null then raise exception 'Administrator access required'; end if;
  if p_status is null or p_status not in ('done', 'dismissed') then raise exception 'Invalid status'; end if;
  update public.privacy_requests
    set status = p_status, resolved_at = now(), resolved_by = auth.uid()
  where id = p_id and institution_id = campus and status = 'open';
  if not found then raise exception 'Request unavailable'; end if;
end $$;

create or replace function public.accept_meeting_alternative(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.meeting_requests;
begin
  select * into r from public.meeting_requests where id = p_request for update;
  if not found or r.student_id <> auth.uid() or r.institution_id is distinct from public.current_institution() then
    raise exception 'Request unavailable';
  end if;
  if r.status <> 'alternative' then raise exception 'No alternative time to accept'; end if;
  if r.meeting_at is null or r.meeting_at <= now() then raise exception 'That alternative time has passed'; end if;
  update public.meeting_requests set status = 'accepted', updated_at = now() where id = p_request;
  insert into public.notifications(recipient_id, request_id, message)
  values (r.faculty_id, p_request, 'The student accepted the suggested time.');
end $$;

create or replace function public.create_timed_meeting_request(p_faculty uuid, p_reason text, p_meeting_at timestamptz, p_voice_path text, p_submission_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare campus uuid; result uuid; old public.meeting_requests; clean_reason text := coalesce(nullif(trim(p_reason), ''), 'Voice note');
  cap integer := 5; faculty public.profiles; leave_hit boolean;
begin
  select institution_id into campus from public.profiles where id = (select auth.uid()) and active and role = 'student';
  if campus is null then raise exception 'Student access required'; end if;
  if p_submission_id is null then raise exception 'Submission ID required'; end if;
  perform pg_advisory_xact_lock(hashtextextended((select auth.uid())::text, 0));
  select * into old from public.meeting_requests where submission_id = p_submission_id;
  if found then
    if old.student_id = (select auth.uid()) and old.institution_id = campus and old.faculty_id = p_faculty
      and old.reason = clean_reason and old.requested_for = p_meeting_at and old.request_voice_path is not distinct from p_voice_path then return old.id; end if;
    raise exception 'This submission has already been used';
  end if;
  select * into faculty from public.profiles where id = p_faculty and institution_id = campus and active and role = 'faculty';
  if not found then raise exception 'Faculty unavailable'; end if;
  if faculty.pause_requests then raise exception 'This person is not taking new requests right now'; end if;
  if faculty.quiet_start is not null and faculty.quiet_end is not null then
    if faculty.quiet_start < faculty.quiet_end then
      if localtime >= faculty.quiet_start and localtime < faculty.quiet_end then
        raise exception 'This person is in quiet hours right now';
      end if;
    else
      if localtime >= faculty.quiet_start or localtime < faculty.quiet_end then
        raise exception 'This person is in quiet hours right now';
      end if;
    end if;
  end if;
  select exists (
    select 1 from public.faculty_leave_days d
    where d.faculty_id = p_faculty and d.leave_on = ((p_meeting_at at time zone 'UTC')::date)
  ) into leave_hit;
  if leave_hit then raise exception 'That day is marked as leave for this person'; end if;
  if p_meeting_at is null or p_meeting_at <= now() or p_meeting_at > now() + interval '180 days' then raise exception 'Choose a future meeting time within 180 days'; end if;
  if length(clean_reason) > 500 or (coalesce(length(trim(p_reason)), 0) = 0 and p_voice_path is null) then raise exception 'Add a brief reason or a voice note'; end if;
  perform campuspulse_private.check_voice_upload(p_voice_path);
  if (select count(*) from public.meeting_requests where student_id = (select auth.uid()) and created_at > now() - interval '1 hour') >= 10 then raise exception 'Too many requests; try again later'; end if;
  select coalesce((select s.waiting_cap from public.institution_settings s where s.institution_id = campus), 5) into cap;
  if (select count(*) from public.meeting_requests where faculty_id = p_faculty and status = 'pending' and (meeting_at is null or meeting_at > now())) >= cap then
    raise exception 'This person already has several requests waiting';
  end if;
  insert into public.meeting_requests(institution_id, student_id, faculty_id, reason, preferred_time, requested_for, meeting_at, purge_after, request_voice_path, submission_id)
    values (campus, (select auth.uid()), p_faculty, clean_reason, p_meeting_at::text, p_meeting_at, p_meeting_at, p_meeting_at + interval '1080 hours', p_voice_path, p_submission_id) returning id into result;
  insert into public.notifications(recipient_id, request_id, message) values (p_faculty, result, 'You have a new meeting request.');
  return result;
end $$;

create or replace function public.admin_bulk_update_profiles(p_users uuid[], p_department text, p_role text, p_active boolean)
returns integer language plpgsql security definer set search_path = public as $$
declare campus uuid; n integer := 0; uid uuid;
begin
  select institution_id into campus from public.profiles where id = auth.uid() and active and role = 'admin';
  if campus is null then raise exception 'Administrator access required'; end if;
  if p_users is null or cardinality(p_users) < 1 or cardinality(p_users) > 200 then raise exception 'Select between 1 and 200 people'; end if;
  if p_role is not null and p_role not in ('student', 'faculty', 'admin') then raise exception 'Invalid role'; end if;
  if p_department is not null and char_length(trim(p_department)) > 120 then raise exception 'Department is too long'; end if;
  foreach uid in array p_users loop
    if uid = auth.uid() and ((p_active is not null and not p_active) or (p_role is not null and p_role <> 'admin')) then
      continue;
    end if;
    update public.profiles set
      department = case when p_department is null then department else trim(p_department) end,
      role = coalesce(p_role, role),
      active = coalesce(p_active, active)
    where id = uid and institution_id = campus;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

revoke all on function public.get_institution_settings(), public.admin_update_institution_settings(integer),
  public.set_faculty_inbox_prefs(boolean, time, time, text[]), public.set_faculty_leave_day(date, text),
  public.remove_faculty_leave_day(uuid), public.submit_privacy_request(text, text),
  public.admin_resolve_privacy_request(uuid, text), public.accept_meeting_alternative(uuid),
  public.admin_bulk_update_profiles(uuid[], text, text, boolean),
  public.create_timed_meeting_request(uuid, text, timestamptz, text, uuid)
  from public, anon;
grant execute on function public.get_institution_settings(), public.admin_update_institution_settings(integer),
  public.set_faculty_inbox_prefs(boolean, time, time, text[]), public.set_faculty_leave_day(date, text),
  public.remove_faculty_leave_day(uuid), public.submit_privacy_request(text, text),
  public.admin_resolve_privacy_request(uuid, text), public.accept_meeting_alternative(uuid),
  public.admin_bulk_update_profiles(uuid[], text, text, boolean),
  public.create_timed_meeting_request(uuid, text, timestamptz, text, uuid)
  to authenticated;
