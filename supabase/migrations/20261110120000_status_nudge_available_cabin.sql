-- Ask-to-update: only when faculty shows Available (cabin looks empty to the student).

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
  if current is distinct from 'available' then
    raise exception 'Ask only when they show Available and the cabin is empty';
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
      'A student checked your cabin while you show Available and asked you to update your status.'
    );

  return result;
end $$;

revoke all on function public.request_status_nudge(uuid) from public, anon;
grant execute on function public.request_status_nudge(uuid) to authenticated;
