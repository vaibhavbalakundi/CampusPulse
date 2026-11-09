-- College safety: revoke anon execute on faculty profile updater (advisor warning).
revoke all on function public.update_faculty_profile(text, text, text) from public, anon;
grant execute on function public.update_faculty_profile(text, text, text) to authenticated;

-- Invite / attach paths mint student or faculty only. Promote to admin via admin_update_profile.
create or replace function public.admin_create_profile(
  p_user uuid,
  p_name text,
  p_department text,
  p_role text
) returns void
language plpgsql security definer set search_path = public as $$
declare campus uuid;
begin
  select institution_id into campus from public.profiles where id = auth.uid() and active and role = 'admin';
  if campus is null then raise exception 'Administrator access required'; end if;
  if p_user is null or p_name is null or char_length(trim(p_name)) not between 1 and 120
    or p_department is null or char_length(trim(p_department)) > 120
    or p_role is null or p_role not in ('student', 'faculty') then
    raise exception 'Invalid profile details';
  end if;
  if not exists (select 1 from auth.users where id = p_user and email_confirmed_at is not null)
    or exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Account unavailable';
  end if;
  insert into public.profiles(id, institution_id, role, name, department)
  values (p_user, campus, p_role, trim(p_name), trim(p_department));
end $$;

create or replace function public.admin_create_profile_by_email(
  p_email text,
  p_name text,
  p_department text,
  p_role text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare campus uuid; user_id uuid; clean_email text := lower(btrim(coalesce(p_email, '')));
begin
  select institution_id into campus from public.profiles where id = auth.uid() and active and role = 'admin';
  if campus is null then raise exception 'Administrator access required'; end if;
  if clean_email = '' or clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid campus email';
  end if;
  if p_role is null or p_role not in ('student', 'faculty') then
    raise exception 'Attach only student or faculty roles';
  end if;
  select u.id into user_id from auth.users u
  where lower(u.email) = clean_email and u.email_confirmed_at is not null;
  if user_id is null then raise exception 'No confirmed Auth account for that email'; end if;
  perform public.admin_create_profile(user_id, p_name, coalesce(p_department, ''), p_role);
  return user_id;
end $$;

revoke all on function public.admin_create_profile(uuid, text, text, text),
  public.admin_create_profile_by_email(text, text, text, text)
  from public, anon;
grant execute on function public.admin_create_profile(uuid, text, text, text),
  public.admin_create_profile_by_email(text, text, text, text)
  to authenticated;
