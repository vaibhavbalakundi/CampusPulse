-- Minimal administrative reporting and operational audit; no meeting text is retained.
create table public.audit_events (
  id bigint generated always as identity primary key,
  institution_id uuid not null references public.institutions(id),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_id uuid not null,
  created_at timestamptz not null default now()
);
create index audit_events_institution_time on public.audit_events(institution_id, created_at desc);
alter table public.audit_events enable row level security;
create policy audit_admin_read on public.audit_events for select to authenticated using (
  institution_id=public.current_institution() and public.is_institution_admin()
);
grant select on public.audit_events to authenticated;

create function public.audit_request_change() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    insert into public.audit_events(institution_id,actor_id,action,target_id)
      values(new.institution_id,auth.uid(),'request_created',new.id);
  elsif old.status is distinct from new.status then
    insert into public.audit_events(institution_id,actor_id,action,target_id)
      values(new.institution_id,auth.uid(),'request_status_changed',new.id);
  end if;
  return new;
end $$;
create trigger audit_meeting_request after insert or update on public.meeting_requests
  for each row execute function public.audit_request_change();

create function public.audit_profile_change() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    insert into public.audit_events(institution_id,actor_id,action,target_id)
      values(new.institution_id,auth.uid(),'profile_created',new.id);
  elsif (old.role,old.active,old.name,old.department) is distinct from (new.role,new.active,new.name,new.department) then
    insert into public.audit_events(institution_id,actor_id,action,target_id)
      values(new.institution_id,auth.uid(),'profile_updated',new.id);
  end if;
  return new;
end $$;
create trigger audit_profile after insert or update on public.profiles
  for each row execute function public.audit_profile_change();

create function public.admin_create_profile(p_user uuid,p_name text,p_department text,p_role text)
returns void language plpgsql security definer set search_path=public as $$
declare campus uuid;
begin
  select institution_id into campus from public.profiles where id=auth.uid() and active and role='admin';
  if campus is null then raise exception 'Administrator access required'; end if;
  if p_user is null or p_name is null or char_length(trim(p_name)) not between 1 and 120
    or p_department is null or char_length(trim(p_department)) > 120
    or p_role is null or p_role not in ('student','faculty','admin') then raise exception 'Invalid profile details'; end if;
  if not exists (select 1 from auth.users where id=p_user and email_confirmed_at is not null)
    or exists (select 1 from public.profiles where id=p_user) then raise exception 'Account unavailable'; end if;
  insert into public.profiles(id,institution_id,role,name,department) values(p_user,campus,p_role,trim(p_name),trim(p_department));
end $$;

create function public.admin_usage_summary() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare campus uuid;
begin
  select institution_id into campus from public.profiles where id=auth.uid() and active and role='admin';
  if campus is null then raise exception 'Administrator access required'; end if;
  return jsonb_build_object(
    'active_students',(select count(*) from public.profiles where institution_id=campus and role='student' and active),
    'active_faculty',(select count(*) from public.profiles where institution_id=campus and role='faculty' and active),
    'requests_last_7_days',(select count(*) from public.meeting_requests where institution_id=campus and created_at >= now()-interval '7 days'),
    'pending_requests',(select count(*) from public.meeting_requests where institution_id=campus and status='pending')
  );
end $$;
revoke all on function public.admin_create_profile(uuid,text,text,text), public.admin_usage_summary() from public;
grant execute on function public.admin_create_profile(uuid,text,text,text), public.admin_usage_summary() to authenticated;
