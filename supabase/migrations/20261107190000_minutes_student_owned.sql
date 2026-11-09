-- Student-owned minutes: student publishes; faculty may flag - no dual review required.

alter table public.meeting_minutes
  add column if not exists faculty_flagged_at timestamptz,
  add column if not exists faculty_flag_note text;

do $$ begin
  alter table public.meeting_minutes
    add constraint meeting_minutes_faculty_flag_note_len
    check (faculty_flag_note is null or char_length(faculty_flag_note) <= 500);
exception when duplicate_object then null;
end $$;

create or replace function public.confirm_meeting_minutes(p_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.meeting_requests;
begin
  if public.current_institution() is null then raise exception 'Active account required'; end if;
  select * into r from public.meeting_requests where id = p_request;
  if not found or r.institution_id is distinct from public.current_institution()
    or (select auth.uid()) is distinct from r.student_id then
    raise exception 'Only the student publishes meeting minutes';
  end if;
  update public.meeting_minutes set
    student_confirmed_at = now(),
    faculty_flagged_at = null,
    faculty_flag_note = null,
    updated_at = now()
  where request_id = r.id and status = 'ready' and char_length(transcript) > 0;
  if not found then raise exception 'Publish the transcript after it is ready'; end if;
  insert into public.notifications(recipient_id, request_id, kind, message)
  values (r.faculty_id, r.id, 'meeting', 'Minutes published. Open the request only if you need them.');
end $$;

create or replace function public.flag_meeting_minutes(p_request uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.meeting_requests; clean text := left(btrim(coalesce(p_note, '')), 500);
begin
  if public.current_institution() is null then raise exception 'Active account required'; end if;
  select * into r from public.meeting_requests where id = p_request;
  if not found or r.institution_id is distinct from public.current_institution()
    or (select auth.uid()) is distinct from r.faculty_id then
    raise exception 'Only faculty can ask for a minutes correction';
  end if;
  update public.meeting_minutes set
    faculty_flagged_at = now(),
    faculty_flag_note = nullif(clean, ''),
    updated_at = now()
  where request_id = r.id and status = 'ready' and char_length(transcript) > 0;
  if not found then raise exception 'Flag minutes after they are ready'; end if;
  insert into public.notifications(recipient_id, request_id, kind, message)
  values (r.student_id, r.id, 'meeting', case when clean = '' then 'Faculty asked for a minutes correction.'
    else left('Faculty asked for a minutes correction: ' || clean, 180) end);
end $$;

create or replace function public.save_meeting_minutes(p_request uuid, p_transcript text, p_actions jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.meeting_requests; clean text := btrim(coalesce(p_transcript, '')); was_flagged boolean;
begin
  if public.current_institution() is null then raise exception 'Active account required'; end if;
  select * into r from public.meeting_requests where id = p_request for update;
  if not found or r.institution_id is distinct from public.current_institution()
    or (select auth.uid()) not in (r.student_id, r.faculty_id) then raise exception 'Meeting unavailable'; end if;
  if r.purge_after is not null and r.purge_after <= now() then raise exception 'This meeting record has expired'; end if;
  if char_length(clean) not between 1 and 12000 then raise exception 'Add the meeting transcript'; end if;
  select faculty_flagged_at is not null into was_flagged from public.meeting_minutes where request_id = r.id;
  update public.meeting_minutes set transcript = clean, actions = campuspulse_private.clean_actions(coalesce(p_actions, '[]'::jsonb)),
    status = 'ready', failure = null, student_confirmed_at = null,
    faculty_flagged_at = null, faculty_flag_note = null, faculty_confirmed_at = null, updated_at = now()
  where request_id = r.id;
  if not found then raise exception 'Record the meeting before editing the minutes'; end if;
  if coalesce(was_flagged, false) and (select auth.uid()) = r.student_id then
    insert into public.notifications(recipient_id, request_id, kind, message)
    values (r.faculty_id, r.id, 'meeting', 'Student updated the minutes after your note.');
  end if;
end $$;

create or replace function public.complete_meeting_transcript(p_minute uuid, p_user uuid, p_transcript text, p_actions jsonb, p_failure text) returns void
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
    status = 'ready', failure = null, student_confirmed_at = null, faculty_confirmed_at = null,
    faculty_flagged_at = null, faculty_flag_note = null, updated_at = now()
  where id = m.id;
  insert into public.notifications(recipient_id, request_id, kind, message)
  values (r.student_id, r.id, 'meeting', 'Your minutes are ready. Publish when they look right.');
  insert into public.notifications(recipient_id, request_id, kind, message)
  values (r.faculty_id, r.id, 'meeting', 'Minutes draft ready. Action points are on My day - no review required.');
end $$;

create or replace function public.submit_meeting_minutes(p_request uuid, p_voice_path text) returns uuid
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
  insert into public.meeting_minutes(institution_id, request_id, audio_path, status, failure, student_confirmed_at, faculty_confirmed_at, faculty_flagged_at, faculty_flag_note, updated_at)
  values (r.institution_id, r.id, p_voice_path, 'transcribing', null, null, null, null, null, now())
  on conflict (request_id) do update set audio_path = excluded.audio_path, status = 'transcribing', failure = null,
    student_confirmed_at = null, faculty_confirmed_at = null, faculty_flagged_at = null, faculty_flag_note = null, updated_at = now()
  returning id into result;
  other_party := case when (select auth.uid()) = r.student_id then r.faculty_id else r.student_id end;
  insert into public.notifications(recipient_id, request_id, kind, message)
  values (other_party, r.id, 'meeting', case when (select auth.uid()) = r.student_id
    then 'Student recorded meeting minutes.'
    else 'Meeting minutes were recorded and are being transcribed.' end);
  return result;
end $$;

revoke all on function public.flag_meeting_minutes(uuid, text) from public, anon;
grant execute on function public.flag_meeting_minutes(uuid, text) to authenticated;
