-- Allow status notes while Available or Busy. Clear only on Away.

create or replace function public.set_availability(
  p_status text,
  p_duration_minutes integer,
  p_walk_in_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  open_nudge uuid;
  student uuid;
  clean_note text := btrim(coalesce(p_walk_in_note, ''));
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and active and role = 'faculty') then
    raise exception 'Faculty access required';
  end if;
  if p_status not in ('available', 'busy', 'away') or p_status is null
     or p_duration_minutes is null or p_duration_minutes not between 5 and 480 then
    raise exception 'Invalid availability';
  end if;
  if char_length(clean_note) > 120 then
    raise exception 'Status note must be 120 characters or fewer';
  end if;
  -- Notes show while Available or Busy; Away clears them.
  if p_status = 'away' then
    clean_note := '';
  end if;

  insert into public.availability(faculty_id, status, updated_at, expires_at, walk_in_note)
    values (auth.uid(), p_status, now(), now() + make_interval(mins => p_duration_minutes), clean_note)
  on conflict (faculty_id) do update
    set status = excluded.status,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at,
        walk_in_note = excluded.walk_in_note;

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
end;
$$;

revoke all on function public.set_availability(text, integer) from public, anon;
revoke all on function public.set_availability(text, integer, text) from public, anon;
grant execute on function public.set_availability(text, integer) to authenticated;
grant execute on function public.set_availability(text, integer, text) to authenticated;

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

  insert into public.availability(faculty_id, status, updated_at, expires_at, walk_in_note)
    values (
      auth.uid(),
      p_status,
      now(),
      now() + interval '480 minutes',
      case
        when p_status = 'away' then ''
        else coalesce((select walk_in_note from public.availability where faculty_id = auth.uid()), '')
      end
    )
  on conflict (faculty_id) do update
    set status = excluded.status,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at,
        walk_in_note = excluded.walk_in_note;

  update public.status_nudges
    set status = 'updated', resolved_at = now(), resolved_status = p_status
  where id = p_nudge;

  insert into public.notifications(recipient_id, kind, message)
    values (n.student_id, 'status', 'Faculty updated their status.');
end;
$$;
