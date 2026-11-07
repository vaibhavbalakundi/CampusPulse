-- Additive: existing text-only clients keep their RPCs. Audio remains private.
create schema if not exists campuspulse_private;
revoke all on schema campuspulse_private from public;
grant usage on schema campuspulse_private to authenticated;

alter table public.meeting_requests
  add column request_voice_path text unique,
  add column response_voice_path text unique,
  add column submission_id uuid unique;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice-notes', 'voice-notes', false, 5242880,
  array['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav']);

create function campuspulse_private.voice_attached(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.meeting_requests
    where request_voice_path = p_path or response_voice_path = p_path)
$$;

create function campuspulse_private.voice_readable(p_path text, p_owner text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.active and (
    (p_owner = p.id::text and not campuspulse_private.voice_attached(p_path)) or
    exists (select 1 from public.meeting_requests r where r.institution_id = p.institution_id
      and (r.student_id = p.id or r.faculty_id = p.id)
      and (r.request_voice_path = p_path or r.response_voice_path = p_path))
  ))
$$;

-- Internal validator: only a completed, owned, unused Storage object can be attached.
-- Locking the object serializes concurrent attempts to attach the same upload.
create function campuspulse_private.check_voice_upload(p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare o storage.objects;
begin
  if p_path is null then return; end if;
  if auth.uid() is null or split_part(p_path, '/', 1) <> auth.uid()::text then
    raise exception 'Voice note unavailable';
  end if;
  select * into o from storage.objects where bucket_id = 'voice-notes' and name = p_path for update;
  if not found or o.owner_id is distinct from auth.uid()::text
    or coalesce((o.metadata->>'size')::bigint, 0) not between 1 and 5242880
    or coalesce(o.metadata->>'mimetype', '') not in ('audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav')
    or campuspulse_private.voice_attached(p_path) then raise exception 'Voice note unavailable'; end if;
end $$;

revoke all on function campuspulse_private.voice_attached(text), campuspulse_private.voice_readable(text,text), campuspulse_private.check_voice_upload(text) from public, anon, authenticated;
grant execute on function campuspulse_private.voice_attached(text), campuspulse_private.voice_readable(text,text) to authenticated;

create policy voice_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'voice-notes' and owner_id = (select auth.uid())::text
  and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f-]{36}\.(webm|ogg|m4a|mp3|wav)$')
  and exists (select 1 from public.profiles where id = (select auth.uid()) and active and role in ('student','faculty'))
);
create policy voice_read on storage.objects for select to authenticated using (
  bucket_id = 'voice-notes' and campuspulse_private.voice_readable(name, owner_id)
);
create policy voice_discard on storage.objects for delete to authenticated using (
  bucket_id = 'voice-notes' and owner_id = (select auth.uid())::text
  and public.current_institution() is not null and not campuspulse_private.voice_attached(name)
);
-- No UPDATE policy: attached recordings cannot be overwritten or silently replaced.

create function public.create_meeting_request_with_voice(
  p_faculty uuid, p_reason text, p_preferred_time text, p_voice_path text, p_submission_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid; old public.meeting_requests; clean_reason text := coalesce(nullif(trim(p_reason), ''), 'Voice note');
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and active and role = 'student') then raise exception 'Student access required'; end if;
  if p_submission_id is null then raise exception 'Submission ID required'; end if;
  if coalesce(length(trim(p_reason)), 0) = 0 and p_voice_path is null then raise exception 'Add a reason or a voice note'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  select * into old from public.meeting_requests where submission_id = p_submission_id;
  if found then
    if old.student_id = auth.uid() and old.institution_id = public.current_institution()
      and old.faculty_id = p_faculty and old.reason = clean_reason and old.preferred_time = trim(p_preferred_time)
      and old.request_voice_path is not distinct from p_voice_path then return old.id; end if;
    raise exception 'This submission has already been used';
  end if;
  perform campuspulse_private.check_voice_upload(p_voice_path);
  result := public.create_meeting_request(p_faculty, clean_reason, p_preferred_time);
  update public.meeting_requests set request_voice_path = p_voice_path, submission_id = p_submission_id where id = result;
  return result;
end $$;

create function public.respond_to_request_with_voice(p_request uuid, p_status text, p_note text, p_voice_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.meeting_requests; clean_note text := nullif(trim(p_note), '');
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and active and role = 'faculty') then raise exception 'Faculty access required'; end if;
  select * into r from public.meeting_requests where id = p_request for update;
  if not found or r.faculty_id <> auth.uid() or r.institution_id is distinct from public.current_institution() then raise exception 'Request unavailable'; end if;
  if p_status = 'alternative' and clean_note is null and p_voice_path is not null then clean_note := 'See voice note for the suggested time.'; end if;
  -- Safe retry after a lost network response. Never sends duplicate notifications.
  if r.status <> 'pending' and r.status = p_status and r.response_note is not distinct from clean_note
    and r.response_voice_path is not distinct from p_voice_path then return; end if;
  perform campuspulse_private.check_voice_upload(p_voice_path);
  perform public.respond_to_request(p_request, p_status, clean_note);
  update public.meeting_requests set response_voice_path = p_voice_path where id = p_request;
end $$;
revoke all on function public.create_meeting_request_with_voice(uuid,text,text,text,uuid), public.respond_to_request_with_voice(uuid,text,text,text) from public, anon;
grant execute on function public.create_meeting_request_with_voice(uuid,text,text,text,uuid), public.respond_to_request_with_voice(uuid,text,text,text) to authenticated;
