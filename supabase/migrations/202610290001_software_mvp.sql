-- Initial software MVP. Apply to a new Supabase project only after review.
create extension if not exists pgcrypto;

create table public.institutions (
  id uuid primary key default gen_random_uuid(), name text not null
);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  institution_id uuid not null references public.institutions(id),
  role text not null check (role in ('student','faculty','admin')),
  name text not null check (char_length(name) between 1 and 120),
  department text not null default '', office_location text,
  active boolean not null default true
);
create table public.availability (
  faculty_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null check (status in ('available','busy','away')),
  updated_at timestamptz not null default now(), expires_at timestamptz not null
);
create table public.meeting_requests (
  id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id),
  student_id uuid not null references public.profiles(id), faculty_id uuid not null references public.profiles(id),
  reason text not null check (char_length(reason) between 1 and 500), preferred_time text not null check (char_length(preferred_time) between 1 and 150),
  status text not null default 'pending' check (status in ('pending','accepted','declined','alternative','cancelled')),
  response_note text check (char_length(response_note) <= 500), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index requests_student on public.meeting_requests(student_id, created_at desc);
create index requests_faculty on public.meeting_requests(faculty_id, created_at desc);
create table public.notifications (
  id uuid primary key default gen_random_uuid(), recipient_id uuid not null references public.profiles(id),
  request_id uuid not null references public.meeting_requests(id), message text not null,
  created_at timestamptz not null default now(), read_at timestamptz
);
create index notifications_recipient on public.notifications(recipient_id, created_at desc);

create function public.current_institution() returns uuid language sql stable security definer set search_path = public as $$
  select institution_id from public.profiles where id = auth.uid() and active
$$;
revoke all on function public.current_institution() from public;
grant execute on function public.current_institution() to authenticated;

alter table public.institutions enable row level security;
alter table public.profiles enable row level security;
alter table public.availability enable row level security;
alter table public.meeting_requests enable row level security;
alter table public.notifications enable row level security;
create policy institution_read on public.institutions for select to authenticated using (id = public.current_institution());
create policy profiles_read on public.profiles for select to authenticated using (
 institution_id = public.current_institution() and (id = auth.uid() or (role = 'faculty' and active) or
 exists (select 1 from public.meeting_requests r where r.student_id = profiles.id and r.faculty_id = auth.uid()))
);
create policy availability_read on public.availability for select to authenticated using (
 exists (select 1 from public.profiles p where p.id = faculty_id and p.institution_id = public.current_institution() and p.role = 'faculty' and p.active)
);
create policy requests_read on public.meeting_requests for select to authenticated using (
 institution_id = public.current_institution() and (student_id = auth.uid() or faculty_id = auth.uid())
);
create policy notifications_read on public.notifications for select to authenticated using (recipient_id = auth.uid() and public.current_institution() is not null);
grant select on public.institutions, public.profiles, public.availability, public.meeting_requests, public.notifications to authenticated;

create function public.set_availability(p_status text, p_duration_minutes integer) returns void
language plpgsql security definer set search_path = public as $$
begin
 if not exists (select 1 from public.profiles where id = auth.uid() and active and role = 'faculty') then raise exception 'Faculty access required'; end if;
 if p_status not in ('available','busy','away') or p_status is null or p_duration_minutes is null or p_duration_minutes not between 5 and 480 then raise exception 'Invalid availability'; end if;
 insert into public.availability(faculty_id,status,updated_at,expires_at) values(auth.uid(),p_status,now(),now() + make_interval(mins => p_duration_minutes))
 on conflict (faculty_id) do update set status=excluded.status, updated_at=excluded.updated_at, expires_at=excluded.expires_at;
end $$;

create function public.create_meeting_request(p_faculty uuid, p_reason text, p_preferred_time text) returns uuid
language plpgsql security definer set search_path = public as $$
declare institution uuid; result uuid;
begin
 select institution_id into institution from public.profiles where id=auth.uid() and active and role='student';
 if institution is null then raise exception 'Student access required'; end if;
 if not exists (select 1 from public.profiles where id=p_faculty and institution_id=institution and role='faculty' and active) then raise exception 'Faculty unavailable'; end if;
 if p_reason is null or char_length(trim(p_reason)) not between 1 and 500 or p_preferred_time is null or char_length(trim(p_preferred_time)) not between 1 and 150 then raise exception 'Invalid request'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
 if (select count(*) from public.meeting_requests where student_id=auth.uid() and created_at > now() - interval '1 hour') >= 10 then raise exception 'Too many requests; try again later'; end if;
 insert into public.meeting_requests(institution_id,student_id,faculty_id,reason,preferred_time) values(institution,auth.uid(),p_faculty,trim(p_reason),trim(p_preferred_time)) returning id into result;
 insert into public.notifications(recipient_id,request_id,message) values(p_faculty,result,'You have a new meeting request.');
 return result;
end $$;

create function public.respond_to_request(p_request uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.meeting_requests;
begin
 select * into r from public.meeting_requests where id=p_request for update;
 if not found or r.faculty_id <> auth.uid() or r.institution_id is distinct from public.current_institution() then raise exception 'Request unavailable'; end if;
 if r.status <> 'pending' or p_status is null or p_status not in ('accepted','declined','alternative') then raise exception 'Invalid request state'; end if;
 if char_length(coalesce(p_note,'')) > 500 or (p_status='alternative' and (p_note is null or length(trim(p_note))=0)) then raise exception 'Invalid response note'; end if;
 update public.meeting_requests set status=p_status,response_note=nullif(trim(p_note),''),updated_at=now() where id=p_request;
 insert into public.notifications(recipient_id,request_id,message) values(r.student_id,p_request,'Your meeting request has a response.');
end $$;

create function public.cancel_meeting_request(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.meeting_requests;
begin
 select * into r from public.meeting_requests where id=p_request for update;
 if not found or r.student_id <> auth.uid() or r.institution_id is distinct from public.current_institution() then raise exception 'Request unavailable'; end if;
 if r.status not in ('pending','accepted','alternative') then raise exception 'Request cannot be cancelled'; end if;
 update public.meeting_requests set status='cancelled',updated_at=now() where id=p_request;
 insert into public.notifications(recipient_id,request_id,message) values(r.faculty_id,p_request,'A meeting request was cancelled.');
end $$;

create function public.mark_notifications_read() returns void language plpgsql security definer set search_path = public as $$
begin
 if public.current_institution() is null then raise exception 'Active account required'; end if;
 update public.notifications set read_at=now() where recipient_id=auth.uid() and read_at is null;
end $$;

revoke all on function public.set_availability(text,integer), public.create_meeting_request(uuid,text,text), public.respond_to_request(uuid,text,text), public.cancel_meeting_request(uuid), public.mark_notifications_read() from public;
grant execute on function public.set_availability(text,integer), public.create_meeting_request(uuid,text,text), public.respond_to_request(uuid,text,text), public.cancel_meeting_request(uuid), public.mark_notifications_read() to authenticated;
