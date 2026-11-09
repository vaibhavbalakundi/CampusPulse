-- Institution-scoped administration of existing profiles.
-- Auth account creation remains a trusted administrator operation.
create function public.is_institution_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and role = 'admin')
$$;
revoke all on function public.is_institution_admin() from public;
grant execute on function public.is_institution_admin() to authenticated;

create policy profiles_admin_read on public.profiles for select to authenticated using (
  institution_id = public.current_institution() and public.is_institution_admin()
);

create function public.admin_update_profile(
  p_user uuid, p_name text, p_department text, p_role text, p_active boolean
) returns void language plpgsql security definer set search_path = public as $$
declare admin_institution uuid; target public.profiles;
begin
  select institution_id into admin_institution from public.profiles
    where id=auth.uid() and active and role='admin';
  if admin_institution is null then raise exception 'Administrator access required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(admin_institution::text, 2));
  if not exists (select 1 from public.profiles where id=auth.uid() and active and role='admin' and institution_id=admin_institution) then
    raise exception 'Administrator access required';
  end if;
  if p_user is null or p_name is null or char_length(trim(p_name)) not between 1 and 120
    or p_department is null or char_length(trim(p_department)) > 120
    or p_role is null or p_role not in ('student','faculty','admin') or p_active is null then
    raise exception 'Invalid profile details';
  end if;
  select * into target from public.profiles where id=p_user and institution_id=admin_institution for update;
  if not found then raise exception 'Profile unavailable'; end if;
  if target.id=auth.uid() and (not p_active or p_role <> 'admin') then
    raise exception 'You cannot deactivate or remove your own administrator access';
  end if;
  update public.profiles set name=trim(p_name),department=trim(p_department),role=p_role,active=p_active where id=p_user;
end $$;
revoke all on function public.admin_update_profile(uuid,text,text,text,boolean) from public;
grant execute on function public.admin_update_profile(uuid,text,text,text,boolean) to authenticated;
