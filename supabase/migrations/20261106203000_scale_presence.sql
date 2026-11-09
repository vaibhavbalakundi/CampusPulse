-- Weekly hours stay the default presence. A manual change still wins until it ends.
-- New requests stop at five waiting. Club events notify followers of that club.

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id),
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);
create unique index clubs_institution_name on public.clubs (institution_id, lower(name));

create table public.club_follows (
  club_id uuid not null references public.clubs(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (club_id, profile_id)
);

alter table public.club_events add column club_id uuid references public.clubs(id);

alter table public.clubs enable row level security;
alter table public.club_follows enable row level security;

create policy clubs_read on public.clubs for select to authenticated
  using (institution_id = public.current_institution());
create policy follows_read on public.club_follows for select to authenticated
  using (profile_id = (select auth.uid()) and exists (
    select 1 from public.clubs c where c.id = club_id and c.institution_id = public.current_institution()
  ));

revoke all on table public.clubs, public.club_follows from public, anon, authenticated;
grant select on table public.clubs, public.club_follows to authenticated;

drop policy events_read on public.club_events;
create policy events_read on public.club_events for select to authenticated using (
  institution_id = public.current_institution() and starts_at > now() - interval '7 days' and (
    author_id = (select auth.uid()) or public.is_institution_admin() or exists (
      select 1 from public.profiles p where p.id = (select auth.uid()) and p.active and (
        audience = 'institution'
        or (audience = 'department' and p.department = audience_value and audience_value <> '')
        or (audience = 'role' and p.role = audience_value)
      )
    ) or exists (
      select 1 from public.club_follows f where f.club_id = club_events.club_id and f.profile_id = (select auth.uid())
    )
  )
);

create function public.clear_status_override() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = (select auth.uid()) and active and role = 'faculty') then
    raise exception 'Faculty access required';
  end if;
  update public.availability set expires_at = now(), updated_at = now() where faculty_id = (select auth.uid());
end $$;

create function public.faculty_waiting_counts()
returns table(faculty_id uuid, waiting integer)
language sql stable security definer set search_path = '' as $$
  select r.faculty_id, count(*)::integer
  from public.meeting_requests r
  where r.institution_id = public.current_institution()
    and r.status = 'pending'
    and (r.meeting_at is null or r.meeting_at > now())
  group by r.faculty_id
$$;

create or replace function public.create_timed_meeting_request(p_faculty uuid, p_reason text, p_meeting_at timestamptz, p_voice_path text, p_submission_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare campus uuid; result uuid; old public.meeting_requests; clean_reason text := coalesce(nullif(trim(p_reason), ''), 'Voice note');
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
  if not exists (select 1 from public.profiles where id = p_faculty and institution_id = campus and active and role = 'faculty') then raise exception 'Faculty unavailable'; end if;
  if p_meeting_at is null or p_meeting_at <= now() or p_meeting_at > now() + interval '180 days' then raise exception 'Choose a future meeting time within 180 days'; end if;
  if length(clean_reason) > 500 or (coalesce(length(trim(p_reason)), 0) = 0 and p_voice_path is null) then raise exception 'Add a brief reason or a voice note'; end if;
  perform campuspulse_private.check_voice_upload(p_voice_path);
  if (select count(*) from public.meeting_requests where student_id = (select auth.uid()) and created_at > now() - interval '1 hour') >= 10 then raise exception 'Too many requests; try again later'; end if;
  if (select count(*) from public.meeting_requests where faculty_id = p_faculty and status = 'pending' and (meeting_at is null or meeting_at > now())) >= 5 then
    raise exception 'This person already has several requests waiting';
  end if;
  insert into public.meeting_requests(institution_id, student_id, faculty_id, reason, preferred_time, requested_for, meeting_at, purge_after, request_voice_path, submission_id)
    values (campus, (select auth.uid()), p_faculty, clean_reason, p_meeting_at::text, p_meeting_at, p_meeting_at, p_meeting_at + interval '1080 hours', p_voice_path, p_submission_id) returning id into result;
  insert into public.notifications(recipient_id, request_id, message) values (p_faculty, result, 'You have a new meeting request.');
  return result;
end $$;

create or replace function public.respond_to_timed_request(p_request uuid, p_status text, p_note text, p_voice_path text, p_alternative_at timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.meeting_requests; clean_note text := nullif(trim(p_note), ''); new_time timestamptz; reply text;
begin
  if not exists (select 1 from public.profiles where id = (select auth.uid()) and active and role = 'faculty') then raise exception 'Faculty access required'; end if;
  select * into r from public.meeting_requests where id = p_request for update;
  if not found or r.faculty_id <> (select auth.uid()) or r.institution_id is distinct from public.current_institution() then raise exception 'Request unavailable'; end if;
  new_time := case when p_status = 'alternative' then p_alternative_at else r.meeting_at end;
  if r.status <> 'pending' and r.status = p_status and r.response_note is not distinct from clean_note
    and r.response_voice_path is not distinct from p_voice_path and r.meeting_at is not distinct from new_time then return; end if;
  if r.status <> 'pending' or p_status is null or p_status not in ('accepted', 'declined', 'alternative') then raise exception 'Invalid request state'; end if;
  if r.meeting_at is not null and r.meeting_at <= now() then raise exception 'This meeting request has expired'; end if;
  if p_status = 'alternative' and (p_alternative_at is null or p_alternative_at <= now() or p_alternative_at > now() + interval '180 days') then raise exception 'Choose a future alternative time within 180 days'; end if;
  if length(coalesce(clean_note, '')) > 500 then raise exception 'Response must be 500 characters or fewer'; end if;
  perform campuspulse_private.check_voice_upload(p_voice_path);
  update public.meeting_requests set status = p_status, response_note = clean_note, response_voice_path = p_voice_path,
    meeting_at = new_time, purge_after = case when new_time is null then null else new_time + interval '1080 hours' end, updated_at = now() where id = p_request;
  reply := case p_status
    when 'accepted' then 'Your meeting was accepted.'
    when 'declined' then 'Your meeting request was declined.'
    else 'A different time was suggested.'
  end;
  insert into public.notifications(recipient_id, request_id, message) values (r.student_id, p_request, reply);
end $$;

create function public.follow_club(p_club uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.clubs c
    join public.profiles p on p.id = (select auth.uid()) and p.active and p.institution_id = c.institution_id
    where c.id = p_club
  ) then raise exception 'Club unavailable'; end if;
  insert into public.club_follows(club_id, profile_id) values (p_club, (select auth.uid()))
  on conflict (club_id, profile_id) do nothing;
end $$;

create function public.unfollow_club(p_club uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.current_institution() is null then raise exception 'Active account required'; end if;
  delete from public.club_follows where club_id = p_club and profile_id = (select auth.uid());
end $$;

drop function public.publish_club_event(text, text, text, timestamptz, timestamptz, text, text);
create function public.publish_club_event(p_title text, p_body text, p_place text, p_starts timestamptz, p_ends timestamptz, p_audience text, p_audience_value text, p_club_name text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare institution uuid; result uuid; club uuid; clean_title text := btrim(coalesce(p_title, '')); clean_body text := btrim(coalesce(p_body, '')); clean_place text := btrim(coalesce(p_place, '')); clean_club text := btrim(coalesce(p_club_name, '')); audience_value text;
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
  if char_length(clean_club) > 80 then raise exception 'Club name is too long'; end if;
  if char_length(clean_club) > 0 then
    insert into public.clubs(institution_id, name) values (institution, clean_club)
    on conflict (institution_id, lower(name)) do update set name = public.clubs.name
    returning id into club;
    insert into public.club_follows(club_id, profile_id) values (club, (select auth.uid()))
    on conflict (club_id, profile_id) do nothing;
  end if;
  insert into public.club_events(institution_id, author_id, title, body, place, starts_at, ends_at, audience, audience_value, club_id)
  values (institution, (select auth.uid()), clean_title, clean_body, clean_place, p_starts, p_ends, p_audience, audience_value, club) returning id into result;
  if club is null then
    insert into public.notifications(recipient_id, kind, event_id, message)
    select p.id, 'event', result, left('Club event: ' || clean_title, 180)
    from public.profiles p
    where p.institution_id = institution and p.active and p.id is distinct from (select auth.uid()) and (
      p_audience = 'institution'
      or (p_audience = 'department' and p.department = audience_value)
      or (p_audience = 'role' and p.role = audience_value)
    );
  else
    insert into public.notifications(recipient_id, kind, event_id, message)
    select f.profile_id, 'event', result, left('Club event: ' || clean_title, 180)
    from public.club_follows f
    join public.profiles p on p.id = f.profile_id
    where f.club_id = club and p.institution_id = institution and p.active and p.id is distinct from (select auth.uid());
  end if;
  return result;
end $$;

revoke all on function public.clear_status_override(), public.faculty_waiting_counts(), public.follow_club(uuid), public.unfollow_club(uuid),
  public.publish_club_event(text, text, text, timestamptz, timestamptz, text, text, text)
  from public, anon;
grant execute on function public.clear_status_override(), public.faculty_waiting_counts(), public.follow_club(uuid), public.unfollow_club(uuid),
  public.publish_club_event(text, text, text, timestamptz, timestamptz, text, text, text)
  to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
