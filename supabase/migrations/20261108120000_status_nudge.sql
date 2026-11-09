-- Student can ask one faculty member to update forgotten status.
-- Only one open nudge per faculty; expires in 30 minutes.

create table if not exists public.status_nudges (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  faculty_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'updated', 'dismissed', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  resolved_at timestamptz,
  resolved_status text check (resolved_status is null or resolved_status in ('available', 'busy', 'away'))
);

create unique index if not exists status_nudges_one_open_per_faculty
  on public.status_nudges (faculty_id)
  where status = 'open';

create index if not exists status_nudges_faculty_open
  on public.status_nudges (faculty_id, expires_at)
  where status = 'open';

create index if not exists status_nudges_student
  on public.status_nudges (student_id, created_at desc);

alter table public.status_nudges enable row level security;

drop policy if exists status_nudges_read on public.status_nudges;
create policy status_nudges_read on public.status_nudges for select to authenticated
  using (
    institution_id = public.current_institution()
    and (faculty_id = auth.uid() or student_id = auth.uid() or public.is_institution_admin())
  );

revoke all on table public.status_nudges from public, anon, authenticated;
grant select on table public.status_nudges to authenticated;

-- Allow status notification kind.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('meeting', 'notice', 'event', 'status'));

alter table public.notifications drop constraint if exists notifications_kind_target;
alter table public.notifications add constraint notifications_kind_target check (
  (kind = 'meeting' and request_id is not null and notice_id is null and event_id is null)
  or (kind = 'notice' and notice_id is not null and request_id is null and event_id is null)
  or (kind = 'event' and event_id is not null and request_id is null and notice_id is null)
  or (kind = 'status' and request_id is null and notice_id is null and event_id is null)
);

create or replace function public.expire_status_nudges()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.status_nudges
    set status = 'expired', resolved_at = now()
  where status = 'open' and expires_at <= now();
end $$;

create or replace function public.request_status_nudge(p_faculty uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  campus uuid;
  result uuid;
  current text;
begin
  perform public.expire_status_nudges();
  select institution_id into campus from public.profiles where id = auth.uid() and active and role = 'student';
  if campus is null then raise exception 'Student access required'; end if;
  if p_faculty is null then raise exception 'Choose a faculty member'; end if;
  if not exists (
    select 1 from public.profiles
    where id = p_faculty and institution_id = campus and active and role = 'faculty'
  ) then raise exception 'Faculty not found'; end if;

  select a.status into current
  from public.availability a
  where a.faculty_id = p_faculty and a.expires_at > now();
  if current = 'available' then
    raise exception 'They already show as Available';
  end if;

  if exists (
    select 1 from public.status_nudges
    where faculty_id = p_faculty and status = 'open' and expires_at > now()
  ) then
    raise exception 'Someone already asked them to update status';
  end if;

  if exists (
    select 1 from public.status_nudges
    where student_id = auth.uid()
      and faculty_id = p_faculty
      and created_at > now() - interval '15 minutes'
  ) then
    raise exception 'Wait a few minutes before asking again';
  end if;

  begin
    insert into public.status_nudges(institution_id, faculty_id, student_id, expires_at)
      values (campus, p_faculty, auth.uid(), now() + interval '30 minutes')
      returning id into result;
  exception when unique_violation then
    raise exception 'Someone already asked them to update status';
  end;

  insert into public.notifications(recipient_id, kind, message)
    values (
      p_faculty,
      'status',
      'A student saw you in your cabin and asked you to update your status.'
    );

  return result;
end $$;

create or replace function public.respond_status_nudge(p_nudge uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  n public.status_nudges;
begin
  perform public.expire_status_nudges();
  if p_status is null or p_status not in ('available', 'busy', 'away') then
    raise exception 'Choose Available, Busy, or Away';
  end if;
  select * into n from public.status_nudges where id = p_nudge for update;
  if not found or n.faculty_id <> auth.uid() then raise exception 'Status ask not found'; end if;
  if n.status <> 'open' or n.expires_at <= now() then raise exception 'This ask has expired'; end if;

  insert into public.availability(faculty_id, status, updated_at, expires_at)
    values (auth.uid(), p_status, now(), now() + interval '480 minutes')
  on conflict (faculty_id) do update
    set status = excluded.status, updated_at = excluded.updated_at, expires_at = excluded.expires_at;

  update public.status_nudges
    set status = 'updated', resolved_at = now(), resolved_status = p_status
  where id = p_nudge;

  insert into public.notifications(recipient_id, kind, message)
    values (n.student_id, 'status', 'Faculty updated their status.');
end $$;

create or replace function public.dismiss_status_nudge(p_nudge uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  n public.status_nudges;
begin
  perform public.expire_status_nudges();
  select * into n from public.status_nudges where id = p_nudge for update;
  if not found or n.faculty_id <> auth.uid() then raise exception 'Status ask not found'; end if;
  if n.status <> 'open' then return; end if;

  update public.status_nudges
    set status = 'dismissed', resolved_at = now()
  where id = p_nudge;

  insert into public.notifications(recipient_id, kind, message)
    values (n.student_id, 'status', 'Faculty kept their current status.');
end $$;

-- Manual status changes also clear any open nudge (same smooth path).
create or replace function public.set_availability(p_status text, p_duration_minutes integer) returns void
language plpgsql security definer set search_path = public as $$
declare open_nudge uuid; student uuid;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and active and role = 'faculty') then
    raise exception 'Faculty access required';
  end if;
  if p_status not in ('available', 'busy', 'away') or p_status is null
     or p_duration_minutes is null or p_duration_minutes not between 5 and 480 then
    raise exception 'Invalid availability';
  end if;

  insert into public.availability(faculty_id, status, updated_at, expires_at)
    values (auth.uid(), p_status, now(), now() + make_interval(mins => p_duration_minutes))
  on conflict (faculty_id) do update
    set status = excluded.status, updated_at = excluded.updated_at, expires_at = excluded.expires_at;

  perform public.expire_status_nudges();
  select id, student_id into open_nudge, student
    from public.status_nudges
    where faculty_id = auth.uid() and status = 'open' and expires_at > now()
    for update;
  if open_nudge is not null then
    update public.status_nudges
      set status = 'updated', resolved_at = now(), resolved_status = p_status
    where id = open_nudge;
    insert into public.notifications(recipient_id, kind, message)
      values (student, 'status', 'Faculty updated their status.');
  end if;
end $$;

revoke all on function public.expire_status_nudges(),
  public.request_status_nudge(uuid),
  public.respond_status_nudge(uuid, text),
  public.dismiss_status_nudge(uuid),
  public.set_availability(text, integer)
  from public, anon;

grant execute on function public.expire_status_nudges(),
  public.request_status_nudge(uuid),
  public.respond_status_nudge(uuid, text),
  public.dismiss_status_nudge(uuid),
  public.set_availability(text, integer)
  to authenticated;
