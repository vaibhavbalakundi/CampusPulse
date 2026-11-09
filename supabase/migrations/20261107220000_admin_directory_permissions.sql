-- Admin directory emails, notice publishers, per-club event posters,
-- and email-based profile import (up to 2000 rows).

create table public.notice_posters (
  institution_id uuid not null references public.institutions(id),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  granted_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (institution_id, profile_id)
);

alter table public.notice_posters enable row level security;
create policy notice_posters_read on public.notice_posters for select to authenticated using (
  institution_id = public.current_institution()
);
revoke all on table public.notice_posters from public, anon, authenticated;
grant select on table public.notice_posters to authenticated;

-- Per-club posters: drop campus-wide grants and require a club.
delete from public.club_posters;
alter table public.club_posters add column if not exists club_id uuid references public.clubs(id) on delete cascade;
alter table public.club_posters alter column club_id set not null;
alter table public.club_posters drop constraint if exists club_posters_pkey;
alter table public.club_posters add primary key (club_id, profile_id);

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
declare campus uuid;
begin
  select institution_id into campus from public.profiles where id = auth.uid() and active and role = 'admin';
  if campus is null then raise exception 'Administrator access required'; end if;
  return query
  select p.id, p.name, p.role::text, p.department, coalesce(u.email, ''), p.active
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.institution_id = campus
  order by p.name;
end $$;

revoke all on function public.admin_people_directory() from public, anon;
grant execute on function public.admin_people_directory() to authenticated;

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
    or p_role is null or p_role not in ('student', 'faculty', 'admin') then
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
  select u.id into user_id from auth.users u
  where lower(u.email) = clean_email and u.email_confirmed_at is not null;
  if user_id is null then raise exception 'No confirmed Auth account for that email'; end if;
  perform public.admin_create_profile(user_id, p_name, coalesce(p_department, ''), p_role);
  return user_id;
end $$;

create or replace function public.admin_import_profiles(p_users jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  item jsonb;
  imported integer := 0;
  user_id uuid;
  user_role text;
  clean_email text;
begin
  if not public.is_institution_admin() then raise exception 'Administrator access required'; end if;
  if p_users is null or jsonb_typeof(p_users) <> 'array' then
    raise exception 'Import must contain between 1 and 2000 profiles';
  end if;
  if jsonb_array_length(p_users) not between 1 and 2000 then
    raise exception 'Import must contain between 1 and 2000 profiles';
  end if;
  for item in select * from jsonb_array_elements(p_users) loop
    if jsonb_typeof(item) <> 'object' then raise exception 'Each profile must be an object'; end if;
    user_role := item->>'role';
    if user_role is null or user_role not in ('student', 'faculty') then
      raise exception 'Each row needs a student or faculty role';
    end if;
    clean_email := lower(btrim(coalesce(item->>'email', '')));
    if clean_email <> '' then
      select u.id into user_id from auth.users u
      where lower(u.email) = clean_email and u.email_confirmed_at is not null;
      if user_id is null then raise exception 'No confirmed Auth account for %', clean_email; end if;
    else
      begin
        user_id := (item->>'auth_user_id')::uuid;
      exception when invalid_text_representation then raise exception 'Invalid Auth user ID'; end;
      if user_id is null then raise exception 'Each row needs an email or Auth user ID'; end if;
    end if;
    perform public.admin_create_profile(user_id, item->>'name', coalesce(item->>'department', ''), user_role);
    imported := imported + 1;
  end loop;
  return imported;
end $$;

create or replace function public.publish_notice(
  p_title text,
  p_body text,
  p_audience text,
  p_audience_value text,
  p_due timestamptz,
  p_expires timestamptz
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  institution uuid;
  result uuid;
  clean_title text := btrim(coalesce(p_title, ''));
  clean_body text := btrim(coalesce(p_body, ''));
  audience_value text;
begin
  select institution_id into institution from public.profiles where id = (select auth.uid()) and active;
  if institution is null then raise exception 'Active account required'; end if;
  if not public.is_institution_admin() and not exists (
    select 1 from public.notice_posters np
    where np.institution_id = institution and np.profile_id = (select auth.uid())
  ) then raise exception 'You are not authorized to publish notices'; end if;
  if char_length(clean_title) not between 1 and 120 or char_length(clean_body) not between 1 and 2000 then
    raise exception 'Add a title and a notice';
  end if;
  if p_expires is null or p_expires <= now() or p_expires > now() + interval '90 days' then
    raise exception 'Choose an expiry within 90 days';
  end if;
  if p_due is not null and (p_due < now() - interval '1 day' or p_due > p_expires) then
    raise exception 'A due date must fall before the notice expires';
  end if;
  if (select count(*) from public.notices where author_id = (select auth.uid()) and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many notices; try again later';
  end if;
  audience_value := campuspulse_private.require_audience(p_audience, p_audience_value);
  insert into public.notices(institution_id, author_id, title, body, audience, audience_value, due_at, expires_at)
  values (institution, (select auth.uid()), clean_title, clean_body, p_audience, audience_value, p_due, p_expires)
  returning id into result;
  insert into public.notifications(recipient_id, kind, notice_id, message)
  select p.id, 'notice', result, left('Notice: ' || clean_title, 180)
  from public.profiles p
  where p.institution_id = institution and p.active and p.id is distinct from (select auth.uid()) and (
    p_audience = 'institution'
    or (p_audience = 'department' and p.department = audience_value)
    or (p_audience = 'role' and p.role = audience_value)
  );
  return result;
end $$;

create or replace function public.grant_notice_poster(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare institution uuid;
begin
  select institution_id into institution from public.profiles where id = (select auth.uid()) and active and role = 'admin';
  if institution is null or p_user is null then raise exception 'Administrator access required'; end if;
  if not exists (select 1 from public.profiles where id = p_user and institution_id = institution and active) then
    raise exception 'Choose an active person at your college';
  end if;
  insert into public.notice_posters(institution_id, profile_id, granted_by)
  values (institution, p_user, (select auth.uid()))
  on conflict (institution_id, profile_id) do nothing;
end $$;

create or replace function public.revoke_notice_poster(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare institution uuid;
begin
  select institution_id into institution from public.profiles where id = (select auth.uid()) and active and role = 'admin';
  if institution is null then raise exception 'Administrator access required'; end if;
  delete from public.notice_posters where institution_id = institution and profile_id = p_user;
end $$;

drop function if exists public.grant_club_poster(uuid);
drop function if exists public.revoke_club_poster(uuid);

create function public.grant_club_poster(p_user uuid, p_club uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare institution uuid;
begin
  select institution_id into institution from public.profiles where id = (select auth.uid()) and active and role = 'admin';
  if institution is null or p_user is null or p_club is null then raise exception 'Administrator access required'; end if;
  if not exists (select 1 from public.profiles where id = p_user and institution_id = institution and active) then
    raise exception 'Choose an active person at your college';
  end if;
  if not exists (select 1 from public.clubs where id = p_club and institution_id = institution) then
    raise exception 'Choose a club at your college';
  end if;
  insert into public.club_posters(institution_id, profile_id, club_id, granted_by)
  values (institution, p_user, p_club, (select auth.uid()))
  on conflict (club_id, profile_id) do nothing;
end $$;

create function public.revoke_club_poster(p_user uuid, p_club uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare institution uuid;
begin
  select institution_id into institution from public.profiles where id = (select auth.uid()) and active and role = 'admin';
  if institution is null then raise exception 'Administrator access required'; end if;
  delete from public.club_posters
  where institution_id = institution and profile_id = p_user and club_id = p_club;
end $$;

create or replace function public.publish_club_event(
  p_title text,
  p_body text,
  p_place text,
  p_starts timestamptz,
  p_ends timestamptz,
  p_audience text,
  p_audience_value text,
  p_club_name text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  institution uuid;
  result uuid;
  club uuid;
  clean_title text := btrim(coalesce(p_title, ''));
  clean_body text := btrim(coalesce(p_body, ''));
  clean_place text := btrim(coalesce(p_place, ''));
  clean_club text := btrim(coalesce(p_club_name, ''));
  audience_value text;
  allowed boolean;
begin
  select institution_id into institution from public.profiles where id = (select auth.uid()) and active;
  if institution is null then raise exception 'Active account required'; end if;
  if char_length(clean_club) = 0 then raise exception 'Choose a club for this event'; end if;
  if char_length(clean_club) > 80 then raise exception 'Club name is too long'; end if;

  insert into public.clubs(institution_id, name) values (institution, clean_club)
  on conflict (institution_id, lower(name)) do update set name = public.clubs.name
  returning id into club;

  allowed := public.is_institution_admin() or exists (
    select 1 from public.club_posters cp
    where cp.institution_id = institution
      and cp.profile_id = (select auth.uid())
      and cp.club_id = club
  );
  if not allowed then raise exception 'You are not authorized to post for this club'; end if;

  if char_length(clean_title) not between 1 and 120 or char_length(clean_body) not between 1 and 2000 or char_length(clean_place) > 160 then
    raise exception 'Add an event title and details';
  end if;
  if p_starts is null or p_starts < now() - interval '1 hour' or p_starts > now() + interval '180 days' then
    raise exception 'Choose an event time';
  end if;
  if p_ends is not null and p_ends <= p_starts then raise exception 'The end time must be after the start time'; end if;
  if (select count(*) from public.club_events where author_id = (select auth.uid()) and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many events; try again later';
  end if;
  audience_value := campuspulse_private.require_audience(p_audience, p_audience_value);

  insert into public.club_events(institution_id, author_id, title, body, place, starts_at, ends_at, audience, audience_value, club_id)
  values (institution, (select auth.uid()), clean_title, clean_body, clean_place, p_starts, p_ends, p_audience, audience_value, club)
  returning id into result;

  insert into public.notifications(recipient_id, kind, event_id, message)
  select f.profile_id, 'event', result, left('Club event: ' || clean_title, 180)
  from public.club_follows f
  join public.profiles p on p.id = f.profile_id
  where f.club_id = club
    and p.institution_id = institution
    and p.active
    and p.id is distinct from (select auth.uid());

  return result;
end $$;

revoke all on function public.admin_create_profile(uuid, text, text, text),
  public.admin_create_profile_by_email(text, text, text, text),
  public.admin_import_profiles(jsonb),
  public.admin_people_directory(),
  public.publish_notice(text, text, text, text, timestamptz, timestamptz),
  public.grant_notice_poster(uuid),
  public.revoke_notice_poster(uuid),
  public.grant_club_poster(uuid, uuid),
  public.revoke_club_poster(uuid, uuid),
  public.publish_club_event(text, text, text, timestamptz, timestamptz, text, text, text)
  from public, anon;
grant execute on function public.admin_create_profile(uuid, text, text, text),
  public.admin_create_profile_by_email(text, text, text, text),
  public.admin_import_profiles(jsonb),
  public.admin_people_directory(),
  public.publish_notice(text, text, text, text, timestamptz, timestamptz),
  public.grant_notice_poster(uuid),
  public.revoke_notice_poster(uuid),
  public.grant_club_poster(uuid, uuid),
  public.revoke_club_poster(uuid, uuid),
  public.publish_club_event(text, text, text, timestamptz, timestamptz, text, text, text)
  to authenticated;
