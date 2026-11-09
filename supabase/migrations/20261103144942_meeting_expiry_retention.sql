-- Meeting time is explicit; legacy free-form records remain for administrator review.
alter table public.meeting_requests
  add column requested_for timestamptz,
  add column meeting_at timestamptz,
  add column purge_after timestamptz;
alter table public.meeting_requests drop constraint meeting_requests_status_check;
alter table public.meeting_requests add constraint meeting_requests_status_check
  check (status in ('pending','accepted','declined','alternative','cancelled','expired'));
create index requests_expiry on public.meeting_requests(meeting_at) where status in ('pending','accepted','alternative');
create index requests_purge on public.meeting_requests(purge_after) where purge_after is not null;

create function public.create_timed_meeting_request(p_faculty uuid, p_reason text, p_meeting_at timestamptz, p_voice_path text, p_submission_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare campus uuid; result uuid; old public.meeting_requests; clean_reason text := coalesce(nullif(trim(p_reason), ''), 'Voice note');
begin
  select institution_id into campus from public.profiles where id=auth.uid() and active and role='student';
  if campus is null then raise exception 'Student access required'; end if;
  if p_submission_id is null then raise exception 'Submission ID required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  select * into old from public.meeting_requests where submission_id=p_submission_id;
  if found then
    if old.student_id=auth.uid() and old.institution_id=campus and old.faculty_id=p_faculty
      and old.reason=clean_reason and old.requested_for=p_meeting_at and old.request_voice_path is not distinct from p_voice_path then return old.id; end if;
    raise exception 'This submission has already been used';
  end if;
  if not exists (select 1 from public.profiles where id=p_faculty and institution_id=campus and active and role='faculty') then raise exception 'Faculty unavailable'; end if;
  if p_meeting_at is null or p_meeting_at <= now() or p_meeting_at > now()+interval '180 days' then raise exception 'Choose a future meeting time within 180 days'; end if;
  if length(clean_reason)>500 or (coalesce(length(trim(p_reason)),0)=0 and p_voice_path is null) then raise exception 'Add a brief reason or a voice note'; end if;
  perform campuspulse_private.check_voice_upload(p_voice_path);
  if (select count(*) from public.meeting_requests where student_id=auth.uid() and created_at>now()-interval '1 hour')>=10 then raise exception 'Too many requests; try again later'; end if;
  insert into public.meeting_requests(institution_id,student_id,faculty_id,reason,preferred_time,requested_for,meeting_at,purge_after,request_voice_path,submission_id)
    values(campus,auth.uid(),p_faculty,clean_reason,p_meeting_at::text,p_meeting_at,p_meeting_at,p_meeting_at+interval '1080 hours',p_voice_path,p_submission_id) returning id into result;
  insert into public.notifications(recipient_id,request_id,message) values(p_faculty,result,'You have a new meeting request.');
  return result;
end $$;

create function public.respond_to_timed_request(p_request uuid,p_status text,p_note text,p_voice_path text,p_alternative_at timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.meeting_requests; clean_note text := nullif(trim(p_note),''); new_time timestamptz;
begin
  if not exists (select 1 from public.profiles where id=auth.uid() and active and role='faculty') then raise exception 'Faculty access required'; end if;
  select * into r from public.meeting_requests where id=p_request for update;
  if not found or r.faculty_id<>auth.uid() or r.institution_id is distinct from public.current_institution() then raise exception 'Request unavailable'; end if;
  new_time := case when p_status='alternative' then p_alternative_at else r.meeting_at end;
  if r.status<>'pending' and r.status=p_status and r.response_note is not distinct from clean_note
    and r.response_voice_path is not distinct from p_voice_path and r.meeting_at is not distinct from new_time then return; end if;
  if r.status<>'pending' or p_status is null or p_status not in ('accepted','declined','alternative') then raise exception 'Invalid request state'; end if;
  if r.meeting_at is not null and r.meeting_at<=now() then raise exception 'This meeting request has expired'; end if;
  if p_status='alternative' and (p_alternative_at is null or p_alternative_at<=now() or p_alternative_at>now()+interval '180 days') then raise exception 'Choose a future alternative time within 180 days'; end if;
  if length(coalesce(clean_note,''))>500 then raise exception 'Response must be 500 characters or fewer'; end if;
  perform campuspulse_private.check_voice_upload(p_voice_path);
  update public.meeting_requests set status=p_status,response_note=clean_note,response_voice_path=p_voice_path,
    meeting_at=new_time,purge_after=case when new_time is null then null else new_time+interval '1080 hours' end,updated_at=now() where id=p_request;
  insert into public.notifications(recipient_id,request_id,message) values(r.student_id,p_request,'Your meeting request has a response.');
end $$;
-- Old creation/response endpoints cannot bypass timed expiry. The application uses the new RPCs.
revoke execute on function public.create_meeting_request(uuid,text,text), public.create_meeting_request_with_voice(uuid,text,text,text,uuid), public.respond_to_request(uuid,text,text), public.respond_to_request_with_voice(uuid,text,text,text) from authenticated;
revoke all on function public.create_timed_meeting_request(uuid,text,timestamptz,text,uuid), public.respond_to_timed_request(uuid,text,text,text,timestamptz) from public, anon;
grant execute on function public.create_timed_meeting_request(uuid,text,timestamptz,text,uuid), public.respond_to_timed_request(uuid,text,text,text,timestamptz) to authenticated;

create or replace function public.cancel_meeting_request(p_request uuid) returns void language plpgsql security definer set search_path='' as $$
declare r public.meeting_requests;
begin
  select * into r from public.meeting_requests where id=p_request for update;
  if not found or r.student_id<>auth.uid() or r.institution_id is distinct from public.current_institution() then raise exception 'Request unavailable'; end if;
  if r.meeting_at is not null and r.meeting_at<=now() then raise exception 'This meeting request has expired'; end if;
  if r.status not in ('pending','accepted','alternative') then raise exception 'Invalid request state'; end if;
  update public.meeting_requests set status='cancelled',updated_at=now() where id=p_request;
  insert into public.notifications(recipient_id,request_id,message) values(r.faculty_id,p_request,'A meeting request was cancelled.');
end $$;

create policy requests_retention_window on public.meeting_requests as restrictive for select to authenticated using (purge_after is null or purge_after>now());
create policy notices_retention_window on public.notifications as restrictive for select to authenticated using (
  exists (select 1 from public.meeting_requests r where r.id=request_id)
);
create or replace function campuspulse_private.voice_readable(p_path text,p_owner text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and (
    (p_owner=p.id::text and not campuspulse_private.voice_attached(p_path)) or
    exists (select 1 from public.meeting_requests r where r.institution_id=p.institution_id
      and (r.student_id=p.id or r.faculty_id=p.id) and (r.purge_after is null or r.purge_after>now())
      and (r.request_voice_path=p_path or r.response_voice_path=p_path))
  ))
$$;

-- Service-only maintenance API. No privileged key is shipped to the browser.
create function public.expire_meeting_requests() returns integer language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
  update public.meeting_requests set status='expired',updated_at=now() where status in ('pending','accepted','alternative') and meeting_at<=now();
  get diagnostics changed=row_count; return changed;
end $$;
create function public.meeting_retention_candidates() returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object('requests',coalesce((select jsonb_agg(to_jsonb(r)) from (
    select id,request_voice_path,response_voice_path from public.meeting_requests where purge_after<=now() order by purge_after limit 100
  ) r),'[]'::jsonb),'orphans',coalesce((select jsonb_agg(o.name) from (
    select name from storage.objects where bucket_id='voice-notes' and created_at<now()-interval '24 hours'
      and not campuspulse_private.voice_attached(name) order by created_at limit 100
  ) o),'[]'::jsonb))
$$;
create function public.finalize_meeting_retention(p_ids uuid[]) returns integer language plpgsql security definer set search_path='' as $$
declare eligible uuid[]; removed integer;
begin
  -- Never remove the last attachment reference while its object still exists.
  select array_agg(r.id) into eligible from public.meeting_requests r where r.id=any(p_ids) and r.purge_after<=now()
    and not exists (select 1 from storage.objects o where o.bucket_id='voice-notes' and (o.name=r.request_voice_path or o.name=r.response_voice_path));
  delete from public.notifications where request_id=any(eligible);
  delete from public.meeting_requests where id=any(eligible);
  get diagnostics removed=row_count; return removed;
end $$;
create function public.validate_retention_job_token(p_token text) returns boolean language sql stable security definer set search_path='' as $$
  select p_token is not null and length(p_token)=64 and exists (select 1 from vault.decrypted_secrets where name='campuspulse_retention_job' and decrypted_secret=p_token)
$$;
revoke all on function public.expire_meeting_requests(),public.meeting_retention_candidates(),public.finalize_meeting_retention(uuid[]),public.validate_retention_job_token(text) from public,anon,authenticated;
grant execute on function public.expire_meeting_requests(),public.meeting_retention_candidates(),public.finalize_meeting_retention(uuid[]),public.validate_retention_job_token(text) to service_role;
