-- One optional future status change per faculty member.
create table public.scheduled_status (
  id uuid primary key default gen_random_uuid(),
  faculty_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('available','busy','away')),
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (starts_at < expires_at)
);
create index scheduled_status_faculty_start on public.scheduled_status(faculty_id,starts_at desc);
alter table public.scheduled_status enable row level security;
create policy scheduled_status_read on public.scheduled_status for select to authenticated using (
  exists (select 1 from public.profiles p where p.id=faculty_id
    and p.institution_id=public.current_institution() and p.role='faculty' and p.active)
);
grant select on public.scheduled_status to authenticated;

create function public.schedule_status(p_status text, p_starts_at timestamptz, p_expires_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id=auth.uid() and active and role='faculty') then raise exception 'Faculty access required'; end if;
  if p_status is null or p_status not in ('available','busy','away') or p_starts_at is null or p_expires_at is null
    or p_starts_at <= now() or p_starts_at > now() + interval '30 days'
    or p_expires_at <= p_starts_at or p_expires_at > p_starts_at + interval '8 hours' then
    raise exception 'Invalid scheduled status';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 4));
  delete from public.scheduled_status where faculty_id=auth.uid() and (starts_at > now() or expires_at < now() - interval '90 days');
  insert into public.scheduled_status(faculty_id,status,starts_at,expires_at,created_at)
    values(auth.uid(),p_status,p_starts_at,p_expires_at,now());
end $$;
create function public.cancel_scheduled_status() returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id=auth.uid() and active and role='faculty') then raise exception 'Faculty access required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 4));
  delete from public.scheduled_status where faculty_id=auth.uid() and starts_at > now();
  if not found then raise exception 'No upcoming scheduled status'; end if;
end $$;
revoke all on function public.schedule_status(text,timestamptz,timestamptz), public.cancel_scheduled_status() from public;
grant execute on function public.schedule_status(text,timestamptz,timestamptz), public.cancel_scheduled_status() to authenticated;
