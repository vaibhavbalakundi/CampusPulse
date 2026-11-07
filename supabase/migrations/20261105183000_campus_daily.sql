-- Minutes, official notices, personal deadlines, and authorized club-event posts.
-- Audiences use the profile fields that exist today: the whole college, a department, or a role.

create table public.meeting_minutes (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id),
  request_id uuid not null unique references public.meeting_requests(id) on delete cascade,
  audio_path text unique,
  transcript text not null default '',
  actions jsonb not null default '[]'::jsonb,
  status text not null default 'empty' check (status in ('empty','transcribing','ready','failed')),
  failure text,
  updated_at timestamptz not null default now(),
  student_confirmed_at timestamptz,
  faculty_confirmed_at timestamptz,
  check (char_length(transcript) <= 12000),
  check (failure is null or char_length(failure) <= 300)
);

create table public.notices (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id),
  author_id uuid not null references public.profiles(id),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 2000),
  audience text not null check (audience in ('institution','department','role')),
  audience_value text not null default '',
  due_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (audience <> 'institution' or audience_value = ''),
  check (audience <> 'role' or audience_value in ('student','faculty','admin'))
);
create index notices_institution on public.notices(institution_id, expires_at desc);

create table public.personal_deadlines (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  due_at timestamptz not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create index deadlines_owner on public.personal_deadlines(owner_id, due_at);

create table public.club_posters (
  institution_id uuid not null references public.institutions(id),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  granted_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (institution_id, profile_id)
);

create table public.club_events (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id),
  author_id uuid not null references public.profiles(id),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 2000),
  place text not null default '' check (char_length(place) <= 160),
  starts_at timestamptz not null,
  ends_at timestamptz,
  audience text not null check (audience in ('institution','department','role')),
  audience_value text not null default '',
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  check (audience <> 'institution' or audience_value = ''),
  check (audience <> 'role' or audience_value in ('student','faculty','admin'))
);
create index club_events_institution on public.club_events(institution_id, starts_at);

alter table public.notifications alter column request_id drop not null;
alter table public.notifications add column kind text not null default 'meeting' check (kind in ('meeting','notice','event'));
alter table public.notifications add column notice_id uuid references public.notices(id) on delete cascade;
alter table public.notifications add column event_id uuid references public.club_events(id) on delete cascade;
alter table public.notifications add constraint notifications_kind_target check (
  (kind = 'meeting' and request_id is not null and notice_id is null and event_id is null)
  or (kind = 'notice' and notice_id is not null and request_id is null and event_id is null)
  or (kind = 'event' and event_id is not null and request_id is null and notice_id is null)
);

create or replace function campuspulse_private.voice_attached(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.meeting_requests where request_voice_path = p_path or response_voice_path = p_path)
    or exists (select 1 from public.meeting_minutes where audio_path = p_path)
$$;

create or replace function campuspulse_private.voice_readable(p_path text, p_owner text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.active and (
    (p_owner = p.id::text and not campuspulse_private.voice_attached(p_path)) or
    exists (select 1 from public.meeting_requests r where r.institution_id = p.institution_id
      and (r.student_id = p.id or r.faculty_id = p.id) and (r.purge_after is null or r.purge_after > now())
      and (r.request_voice_path = p_path or r.response_voice_path = p_path)) or
    exists (select 1 from public.meeting_minutes m join public.meeting_requests r on r.id = m.request_id
      where m.audio_path = p_path and r.institution_id = p.institution_id
      and (r.student_id = p.id or r.faculty_id = p.id) and (r.purge_after is null or r.purge_after > now()))
  ))
$$;

create function campuspulse_private.clean_actions(p_actions jsonb) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare item jsonb; text_value text; due_value text; action_id text; cleaned jsonb := '[]'::jsonb; seen integer := 0;
begin
  if p_actions is null or jsonb_typeof(p_actions) <> 'array' then raise exception 'Action list is invalid'; end if;
  for item in select value from jsonb_array_elements(p_actions) loop
    seen := seen + 1;
    if seen > 20 then raise exception 'A meeting can have at most 20 action points'; end if;
    text_value := nullif(btrim(coalesce(item->>'text', '')), '');
    if text_value is null or char_length(text_value) > 200 then raise exception 'Each action point needs 1 to 200 characters'; end if;
    due_value := nullif(item->>'due_on', '');
    if due_value is not null and due_value !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'An action date is invalid'; end if;
    if due_value is not null then begin perform due_value::date; exception when others then raise exception 'An action date is invalid'; end; end if;
    action_id := nullif(item->>'id', '');
    if action_id is null then action_id := extensions.gen_random_uuid()::text;
    else begin perform action_id::uuid; exception when others then raise exception 'Action list is invalid'; end; end if;
    cleaned := cleaned || jsonb_build_array(jsonb_build_object('id', action_id, 'text', text_value, 'due_on', due_value, 'done', coalesce(item->>'done', 'false') = 'true'));
  end loop;
  return cleaned;
end $$;
revoke all on function campuspulse_private.clean_actions(jsonb) from public, anon, authenticated;

create function campuspulse_private.require_audience(p_audience text, p_value text) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if p_audience is null or p_audience not in ('institution','department','role') then raise exception 'Choose who should see this'; end if;
  if p_audience = 'institution' then return ''; end if;
  if p_audience = 'department' and char_length(btrim(coalesce(p_value, ''))) between 1 and 120 then return btrim(p_value); end if;
  if p_audience = 'role' and p_value in ('student','faculty','admin') then return p_value; end if;
  raise exception 'Choose who should see this';
end $$;
revoke all on function campuspulse_private.require_audience(text, text) from public, anon, authenticated;

alter table public.meeting_minutes enable row level security;
alter table public.notices enable row level security;
alter table public.personal_deadlines enable row level security;
alter table public.club_posters enable row level security;
alter table public.club_events enable row level security;

create policy minutes_read on public.meeting_minutes for select to authenticated using (
  institution_id = public.current_institution() and exists (
    select 1 from public.meeting_requests r where r.id = request_id
      and (r.student_id = (select auth.uid()) or r.faculty_id = (select auth.uid()))
      and (r.purge_after is null or r.purge_after > now())
  )
);
create policy notices_read on public.notices for select to authenticated using (
  institution_id = public.current_institution() and expires_at > now() and (
    author_id = (select auth.uid()) or public.is_institution_admin() or exists (
      select 1 from public.profiles p where p.id = (select auth.uid()) and p.active and (
        audience = 'institution'
        or (audience = 'department' and p.department = audience_value and audience_value <> '')
        or (audience = 'role' and p.role = audience_value)
      )
    )
  )
);
create policy deadlines_read on public.personal_deadlines for select to authenticated using (
  owner_id = (select auth.uid()) and institution_id = public.current_institution()
);
create policy posters_read on public.club_posters for select to authenticated using (
  institution_id = public.current_institution() and (profile_id = (select auth.uid()) or public.is_institution_admin())
);
create policy events_read on public.club_events for select to authenticated using (
  institution_id = public.current_institution() and starts_at > now() - interval '7 days' and (
    author_id = (select auth.uid()) or public.is_institution_admin() or exists (
      select 1 from public.profiles p where p.id = (select auth.uid()) and p.active and (
        audience = 'institution'
        or (audience = 'department' and p.department = audience_value and audience_value <> '')
        or (audience = 'role' and p.role = audience_value)
      )
    )
  )
);

drop policy notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated using (
  recipient_id = (select auth.uid()) and (
    (kind = 'meeting' and exists (
      select 1 from public.meeting_requests r where r.id = request_id and r.institution_id = public.current_institution()
        and (r.student_id = (select auth.uid()) or r.faculty_id = (select auth.uid()))
    ))
    or (kind = 'notice' and exists (
      select 1 from public.notices n where n.id = notice_id and n.institution_id = public.current_institution() and n.expires_at > now()
    ))
    or (kind = 'event' and exists (
      select 1 from public.club_events e where e.id = event_id and e.institution_id = public.current_institution()
    ))
  )
);
drop policy notices_retention_window on public.notifications;
create policy notices_retention_window on public.notifications as restrictive for select to authenticated using (
  (kind = 'meeting' and exists (select 1 from public.meeting_requests r where r.id = request_id))
  or kind in ('notice','event')
);

revoke all on table public.meeting_minutes, public.notices, public.personal_deadlines, public.club_posters, public.club_events from public, anon, authenticated;
grant select on table public.meeting_minutes, public.notices, public.personal_deadlines, public.club_posters, public.club_events to authenticated;

create or replace function public.mark_notifications_read() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.current_institution() is null then raise exception 'Active account required'; end if;
  update public.notifications n set read_at = now()
  where n.recipient_id = (select auth.uid()) and n.read_at is null and (
    (n.kind = 'meeting' and exists (
      select 1 from public.meeting_requests r where r.id = n.request_id and r.institution_id = public.current_institution()
        and (r.student_id = (select auth.uid()) or r.faculty_id = (select auth.uid()))
    ))
    or (n.kind = 'notice' and exists (
      select 1 from public.notices x where x.id = n.notice_id and x.institution_id = public.current_institution()
    ))
    or (n.kind = 'event' and exists (
      select 1 from public.club_events x where x.id = n.event_id and x.institution_id = public.current_institution()
    ))
  );
end $$;

create function public.submit_meeting_minutes(p_request uuid, p_voice_path text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.meeting_requests; result uuid; other_party uuid;
begin
  if public.current_institution() is null then raise exception 'Active account required'; end if;
  if p_voice_path is null then raise exception 'Record the meeting first'; end if;
  select * into r from public.meeting_requests where id = p_request for update;
  if not found or r.institution_id is distinct from public.current_institution()
    or (select auth.uid()) not in (r.student_id, r.faculty_id) then raise exception 'Meeting unavailable'; end if;
  if r.status not in ('accepted','alternative','expired') then raise exception 'Minutes are available after a meeting is accepted'; end if;
  if r.purge_after is not null and r.purge_after <= now() then raise exception 'This meeting record has expired'; end if;
  perform campuspulse_private.check_voice_upload(p_voice_path);
  insert into public.meeting_minutes(institution_id, request_id, audio_path, status, failure, student_confirmed_at, faculty_confirmed_at, updated_at)
  values (r.institution_id, r.id, p_voice_path, 'transcribing', null, null, null, now())
  on conflict (request_id) do update set audio_path = excluded.audio_path, status = 'transcribing', failure = null,
    student_confirmed_at = null, faculty_confirmed_at = null, updated_at = now()
  returning id into result;
  other_party := case when (select auth.uid()) = r.student_id then r.faculty_id else r.student_id end;
  insert into public.notifications(recipient_id, request_id, kind, message)
  values (other_party, r.id, 'meeting', 'Meeting minutes were recorded and are being transcribed.');
  return result;
end $$;

create function public.save_meeting_minutes(p_request uuid, p_transcript text, p_actions jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.meeting_requests; clean text := btrim(coalesce(p_transcript, ''));
begin
  if public.current_institution() is null then raise exception 'Active account required'; end if;
  select * into r from public.meeting_requests where id = p_request for update;
  if not found or r.institution_id is distinct from public.current_institution()
    or (select auth.uid()) not in (r.student_id, r.faculty_id) then raise exception 'Meeting unavailable'; end if;
  if r.purge_after is not null and r.purge_after <= now() then raise exception 'This meeting record has expired'; end if;
  if char_length(clean) not between 1 and 12000 then raise exception 'Add the meeting transcript'; end if;
  update public.meeting_minutes set transcript = clean, actions = campuspulse_private.clean_actions(coalesce(p_actions, '[]'::jsonb)),
    status = 'ready', failure = null, student_confirmed_at = null, faculty_confirmed_at = null, updated_at = now()
  where request_id = r.id;
  if not found then raise exception 'Record the meeting before editing the minutes'; end if;
end $$;

create function public.confirm_meeting_minutes(p_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.meeting_requests;
begin
  if public.current_institution() is null then raise exception 'Active account required'; end if;
  select * into r from public.meeting_requests where id = p_request;
  if not found or r.institution_id is distinct from public.current_institution()
    or (select auth.uid()) not in (r.student_id, r.faculty_id) then raise exception 'Meeting unavailable'; end if;
  update public.meeting_minutes set
    student_confirmed_at = case when (select auth.uid()) = r.student_id then now() else student_confirmed_at end,
    faculty_confirmed_at = case when (select auth.uid()) = r.faculty_id then now() else faculty_confirmed_at end,
    updated_at = now()
  where request_id = r.id and status = 'ready' and char_length(transcript) > 0;
  if not found then raise exception 'Confirm the transcript after it is ready'; end if;
end $$;

create function public.set_minute_action_done(p_request uuid, p_action uuid, p_done boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.meeting_requests;
begin
  if public.current_institution() is null or p_done is null then raise exception 'Active account required'; end if;
  select * into r from public.meeting_requests where id = p_request;
  if not found or r.institution_id is distinct from public.current_institution()
    or (select auth.uid()) not in (r.student_id, r.faculty_id) then raise exception 'Meeting unavailable'; end if;
  update public.meeting_minutes as minutes set actions = (
    select coalesce(jsonb_agg(case when item->>'id' = p_action::text then jsonb_set(item, '{done}', to_jsonb(p_done)) else item end order by ordinality), '[]'::jsonb)
    from jsonb_array_elements(minutes.actions) with ordinality as listed(item, ordinality)
  ), updated_at = now()
  where request_id = r.id and status = 'ready' and actions @> jsonb_build_array(jsonb_build_object('id', p_action::text));
  if not found then raise exception 'Action point unavailable'; end if;
end $$;

create function public.add_personal_deadline(p_title text, p_due timestamptz) returns uuid
language plpgsql security definer set search_path = '' as $$
declare institution uuid; result uuid; clean text := btrim(coalesce(p_title, ''));
begin
  select institution_id into institution from public.profiles where id = (select auth.uid()) and active;
  if institution is null then raise exception 'Active account required'; end if;
  if char_length(clean) not between 1 and 160 or p_due is null or p_due < now() - interval '1 day' or p_due > now() + interval '2 years' then raise exception 'Choose a title and a due date'; end if;
  if (select count(*) from public.personal_deadlines where owner_id = (select auth.uid()) and done = false) >= 50 then raise exception 'Finish or remove an existing deadline first'; end if;
  insert into public.personal_deadlines(institution_id, owner_id, title, due_at) values (institution, (select auth.uid()), clean, p_due) returning id into result;
  return result;
end $$;

create function public.set_personal_deadline_done(p_id uuid, p_done boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.current_institution() is null or p_done is null then raise exception 'Active account required'; end if;
  update public.personal_deadlines set done = p_done where id = p_id and owner_id = (select auth.uid()) and institution_id = public.current_institution();
  if not found then raise exception 'Deadline unavailable'; end if;
end $$;

create function public.remove_personal_deadline(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.current_institution() is null then raise exception 'Active account required'; end if;
  delete from public.personal_deadlines where id = p_id and owner_id = (select auth.uid()) and institution_id = public.current_institution();
  if not found then raise exception 'Deadline unavailable'; end if;
end $$;

create function public.publish_notice(p_title text, p_body text, p_audience text, p_audience_value text, p_due timestamptz, p_expires timestamptz) returns uuid
language plpgsql security definer set search_path = '' as $$
declare institution uuid; result uuid; clean_title text := btrim(coalesce(p_title, '')); clean_body text := btrim(coalesce(p_body, '')); audience_value text;
begin
  select institution_id into institution from public.profiles where id = (select auth.uid()) and active and role = 'admin';
  if institution is null then raise exception 'Administrator access required'; end if;
  if char_length(clean_title) not between 1 and 120 or char_length(clean_body) not between 1 and 2000 then raise exception 'Add a title and a notice'; end if;
  if p_expires is null or p_expires <= now() or p_expires > now() + interval '90 days' then raise exception 'Choose an expiry within 90 days'; end if;
  if p_due is not null and (p_due < now() - interval '1 day' or p_due > p_expires) then raise exception 'A due date must fall before the notice expires'; end if;
  if (select count(*) from public.notices where author_id = (select auth.uid()) and created_at > now() - interval '1 hour') >= 20 then raise exception 'Too many notices; try again later'; end if;
  audience_value := campuspulse_private.require_audience(p_audience, p_audience_value);
  insert into public.notices(institution_id, author_id, title, body, audience, audience_value, due_at, expires_at)
  values (institution, (select auth.uid()), clean_title, clean_body, p_audience, audience_value, p_due, p_expires) returning id into result;
  insert into public.notifications(recipient_id, kind, notice_id, message)
  select p.id, 'notice', result, left('Notice: ' || clean_title, 180)
  from public.profiles p
  where p.institution_id = institution and p.active and p.id is distinct from (select auth.uid()) and (
    p_audience = 'institution'
    or (p_audience = 'department' and p.department = audience_value)
    or (p_audience = 'role' and p.role = audience_value)
  );
  return result;
end $$;

create function public.grant_club_poster(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare institution uuid;
begin
  select institution_id into institution from public.profiles where id = (select auth.uid()) and active and role = 'admin';
  if institution is null or p_user is null then raise exception 'Administrator access required'; end if;
  if not exists (select 1 from public.profiles where id = p_user and institution_id = institution and active) then raise exception 'Choose an active person at your college'; end if;
  insert into public.club_posters(institution_id, profile_id, granted_by) values (institution, p_user, (select auth.uid()))
  on conflict (institution_id, profile_id) do nothing;
end $$;

create function public.revoke_club_poster(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare institution uuid;
begin
  select institution_id into institution from public.profiles where id = (select auth.uid()) and active and role = 'admin';
  if institution is null then raise exception 'Administrator access required'; end if;
  delete from public.club_posters where institution_id = institution and profile_id = p_user;
end $$;

create function public.publish_club_event(p_title text, p_body text, p_place text, p_starts timestamptz, p_ends timestamptz, p_audience text, p_audience_value text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare institution uuid; result uuid; clean_title text := btrim(coalesce(p_title, '')); clean_body text := btrim(coalesce(p_body, '')); clean_place text := btrim(coalesce(p_place, '')); audience_value text;
begin
  select institution_id into institution from public.profiles where id = (select auth.uid()) and active;
  if institution is null then raise exception 'Active account required'; end if;
  if not public.is_institution_admin() and not exists (
    select 1 from public.club_posters where institution_id = institution and profile_id = (select auth.uid())
  ) then raise exception 'You are not authorized to post club events'; end if;
  if char_length(clean_title) not between 1 and 120 or char_length(clean_body) not between 1 and 2000 or char_length(clean_place) > 160 then raise exception 'Add an event title and details'; end if;
  if p_starts is null or p_starts < now() - interval '1 hour' or p_starts > now() + interval '180 days' then raise exception 'Choose an event time'; end if;
  if p_ends is not null and p_ends <= p_starts then raise exception 'The end time must be after the start time'; end if;
  if (select count(*) from public.club_events where author_id = (select auth.uid()) and created_at > now() - interval '1 hour') >= 20 then raise exception 'Too many events; try again later'; end if;
  audience_value := campuspulse_private.require_audience(p_audience, p_audience_value);
  insert into public.club_events(institution_id, author_id, title, body, place, starts_at, ends_at, audience, audience_value)
  values (institution, (select auth.uid()), clean_title, clean_body, clean_place, p_starts, p_ends, p_audience, audience_value) returning id into result;
  insert into public.notifications(recipient_id, kind, event_id, message)
  select p.id, 'event', result, left('Club event: ' || clean_title, 180)
  from public.profiles p
  where p.institution_id = institution and p.active and p.id is distinct from (select auth.uid()) and (
    p_audience = 'institution'
    or (p_audience = 'department' and p.department = audience_value)
    or (p_audience = 'role' and p.role = audience_value)
  );
  return result;
end $$;

create function public.complete_meeting_transcript(p_minute uuid, p_user uuid, p_transcript text, p_actions jsonb, p_failure text) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.meeting_minutes; r public.meeting_requests; clean text := left(btrim(coalesce(p_transcript, '')), 12000);
begin
  if coalesce(auth.jwt()->>'role', '') is distinct from 'service_role' then raise exception 'Transcript completion is internal'; end if;
  select * into m from public.meeting_minutes where id = p_minute for update;
  if not found or m.status is distinct from 'transcribing' then raise exception 'Minutes are not waiting for a transcript'; end if;
  select * into r from public.meeting_requests where id = m.request_id;
  if not found or p_user is null or p_user not in (r.student_id, r.faculty_id) then raise exception 'Minutes unavailable'; end if;
  if p_failure is not null then
    update public.meeting_minutes set status = 'failed', failure = left(btrim(p_failure), 300), updated_at = now() where id = m.id;
    return;
  end if;
  if char_length(clean) < 1 then raise exception 'Transcript is empty'; end if;
  update public.meeting_minutes set transcript = clean, actions = campuspulse_private.clean_actions(coalesce(p_actions, '[]'::jsonb)),
    status = 'ready', failure = null, student_confirmed_at = null, faculty_confirmed_at = null, updated_at = now()
  where id = m.id;
  insert into public.notifications(recipient_id, request_id, kind, message)
  select party, r.id, 'meeting', 'Meeting minutes are ready to review.'
  from unnest(array[r.student_id, r.faculty_id]) as party;
end $$;
revoke all on function public.complete_meeting_transcript(uuid, uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.complete_meeting_transcript(uuid, uuid, text, jsonb, text) to service_role;

create or replace function public.meeting_retention_candidates() returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('requests', coalesce((select jsonb_agg(to_jsonb(r)) from (
    select id, request_voice_path, response_voice_path,
      (select audio_path from public.meeting_minutes m where m.request_id = public.meeting_requests.id) as minutes_voice_path
    from public.meeting_requests where purge_after <= now() order by purge_after limit 100
  ) r), '[]'::jsonb), 'orphans', coalesce((select jsonb_agg(o.name) from (
    select name from storage.objects where bucket_id = 'voice-notes' and created_at < now() - interval '24 hours'
      and not campuspulse_private.voice_attached(name) order by created_at limit 100
  ) o), '[]'::jsonb))
$$;

create or replace function public.finalize_meeting_retention(p_ids uuid[]) returns integer language plpgsql security definer set search_path = '' as $$
declare eligible uuid[]; removed integer;
begin
  select array_agg(r.id) into eligible from public.meeting_requests r where r.id = any(p_ids) and r.purge_after <= now()
    and not exists (
      select 1 from storage.objects o where o.bucket_id = 'voice-notes' and (
        o.name = r.request_voice_path or o.name = r.response_voice_path
        or o.name = (select m.audio_path from public.meeting_minutes m where m.request_id = r.id)
      )
    );
  delete from public.notifications where request_id = any(eligible);
  delete from public.meeting_requests where id = any(eligible);
  get diagnostics removed = row_count; return removed;
end $$;

revoke all on function public.submit_meeting_minutes(uuid, text), public.save_meeting_minutes(uuid, text, jsonb),
  public.confirm_meeting_minutes(uuid), public.set_minute_action_done(uuid, uuid, boolean),
  public.add_personal_deadline(text, timestamptz), public.set_personal_deadline_done(uuid, boolean), public.remove_personal_deadline(uuid),
  public.publish_notice(text, text, text, text, timestamptz, timestamptz), public.grant_club_poster(uuid), public.revoke_club_poster(uuid),
  public.publish_club_event(text, text, text, timestamptz, timestamptz, text, text)
  from public, anon;
grant execute on function public.submit_meeting_minutes(uuid, text), public.save_meeting_minutes(uuid, text, jsonb),
  public.confirm_meeting_minutes(uuid), public.set_minute_action_done(uuid, uuid, boolean),
  public.add_personal_deadline(text, timestamptz), public.set_personal_deadline_done(uuid, boolean), public.remove_personal_deadline(uuid),
  public.publish_notice(text, text, text, text, timestamptz, timestamptz), public.grant_club_poster(uuid), public.revoke_club_poster(uuid),
  public.publish_club_event(text, text, text, timestamptz, timestamptz, text, text)
  to authenticated;
