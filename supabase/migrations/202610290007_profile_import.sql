-- Import profiles for already-created, confirmed Auth accounts. One request is atomic.
create function public.admin_import_profiles(p_users jsonb) returns integer
language plpgsql security definer set search_path=public as $$
declare item jsonb; imported integer := 0; user_id uuid; user_role text;
begin
  if not public.is_institution_admin() then raise exception 'Administrator access required'; end if;
  if p_users is null or jsonb_typeof(p_users) <> 'array' then
    raise exception 'Import must contain between 1 and 100 profiles';
  end if;
  if jsonb_array_length(p_users) not between 1 and 100 then
    raise exception 'Import must contain between 1 and 100 profiles';
  end if;
  for item in select * from jsonb_array_elements(p_users) loop
    if jsonb_typeof(item) <> 'object' then raise exception 'Each profile must be an object'; end if;
    begin
      user_id := (item->>'auth_user_id')::uuid;
    exception when invalid_text_representation then raise exception 'Invalid Auth user ID'; end;
    user_role := item->>'role';
    if user_id is null or user_role is null or user_role not in ('student','faculty') then
      raise exception 'Each row needs an Auth user ID and student or faculty role';
    end if;
    perform public.admin_create_profile(user_id,item->>'name',coalesce(item->>'department',''),user_role);
    imported := imported + 1;
  end loop;
  return imported;
end $$;
revoke all on function public.admin_import_profiles(jsonb) from public;
grant execute on function public.admin_import_profiles(jsonb) to authenticated;
