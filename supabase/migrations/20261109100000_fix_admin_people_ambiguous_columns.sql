-- RETURNS TABLE out-params shadow column names (42702); auth.users.email is varchar (42804).
create or replace function public.admin_people_directory()
returns table(
  id uuid,
  name text,
  role text,
  department text,
  email text,
  active boolean
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare campus uuid;
begin
  select institution_id into campus from public.profiles where profiles.id = auth.uid() and profiles.active and profiles.role = 'admin';
  if campus is null then raise exception 'Administrator access required'; end if;
  return query
  select p.id, p.name::text, p.role::text, p.department::text, coalesce(u.email, '')::text, p.active
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.institution_id = campus
  order by p.name;
end $$;

create or replace function public.admin_people_search(
  p_query text default '',
  p_role text default null,
  p_active boolean default null,
  p_limit integer default 50,
  p_offset integer default 0
) returns table (
  id uuid,
  name text,
  role text,
  department text,
  email text,
  active boolean,
  total_count bigint
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare campus uuid;
  q text := lower(btrim(coalesce(p_query, '')));
  lim integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  off integer := greatest(coalesce(p_offset, 0), 0);
begin
  select institution_id into campus from public.profiles where profiles.id = auth.uid() and profiles.active and profiles.role = 'admin';
  if campus is null then raise exception 'Administrator access required'; end if;
  if p_role is not null and p_role not in ('student', 'faculty', 'admin') then
    raise exception 'Invalid role filter';
  end if;
  return query
  with matched as (
    select p.id, p.name::text as name, p.role::text as role, p.department::text as department, coalesce(u.email, '')::text as email, p.active
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.institution_id = campus
      and (p_role is null or p.role::text = p_role)
      and (p_active is null or p.active = p_active)
      and (
        q = '' or
        lower(p.name) like '%' || q || '%' or
        lower(coalesce(p.department, '')) like '%' || q || '%' or
        lower(coalesce(u.email, '')) like '%' || q || '%'
      )
  ), counted as (
    select count(*)::bigint as total_count from matched
  )
  select m.id, m.name, m.role, m.department, m.email, m.active, c.total_count
  from matched m
  cross join counted c
  order by m.name
  limit lim offset off;
end $$;

revoke all on function public.admin_people_directory(),
  public.admin_people_search(text, text, boolean, integer, integer)
  from public, anon;

grant execute on function public.admin_people_directory(),
  public.admin_people_search(text, text, boolean, integer, integer)
  to authenticated;
