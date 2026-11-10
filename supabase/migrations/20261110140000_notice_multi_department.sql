-- Allow notices/events to target multiple departments (pipe-separated audience_value).

create or replace function campuspulse_private.department_in_audience(p_department text, p_audience_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_department, '') <> ''
    and coalesce(p_audience_value, '') <> ''
    and (
      p_department = p_audience_value
      or p_department = any(string_to_array(p_audience_value, '|'))
    );
$$;

create or replace function campuspulse_private.require_audience(p_audience text, p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  raw text := btrim(coalesce(p_value, ''));
  parts text[];
  cleaned text[] := array[]::text[];
  part text;
begin
  if p_audience is null or p_audience not in ('institution', 'department', 'role') then
    raise exception 'Choose who should see this';
  end if;
  if p_audience = 'institution' then
    return '';
  end if;
  if p_audience = 'role' and raw in ('student', 'faculty', 'admin') then
    return raw;
  end if;
  if p_audience = 'department' then
    parts := string_to_array(raw, '|');
    foreach part in array parts loop
      part := btrim(part);
      if part = '' then
        continue;
      end if;
      if char_length(part) > 120 then
        raise exception 'Choose who should see this';
      end if;
      if not (part = any (cleaned)) then
        cleaned := array_append(cleaned, part);
      end if;
    end loop;
    if cardinality(cleaned) between 1 and 20
      and char_length(array_to_string(cleaned, '|')) <= 800 then
      return array_to_string(cleaned, '|');
    end if;
  end if;
  raise exception 'Choose who should see this';
end;
$$;

revoke all on function campuspulse_private.department_in_audience(text, text) from public, anon;
grant execute on function campuspulse_private.department_in_audience(text, text) to authenticated;
revoke all on function campuspulse_private.require_audience(text, text) from public, anon, authenticated;

drop policy if exists notices_read on public.notices;
create policy notices_read on public.notices for select to authenticated using (
  institution_id = public.current_institution()
  and expires_at > now()
  and (
    author_id = (select auth.uid())
    or public.is_institution_admin()
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.active
        and (
          audience = 'institution'
          or (audience = 'department' and campuspulse_private.department_in_audience(p.department, audience_value))
          or (audience = 'role' and p.role = audience_value)
        )
    )
  )
);

drop policy if exists events_read on public.club_events;
create policy events_read on public.club_events for select to authenticated using (
  institution_id = public.current_institution()
  and starts_at > now() - interval '7 days'
  and (
    author_id = (select auth.uid())
    or public.is_institution_admin()
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.active
        and p.institution_id = club_events.institution_id
        and (
          audience = 'institution'
          or (audience = 'department' and campuspulse_private.department_in_audience(p.department, audience_value))
          or (audience = 'role' and p.role = audience_value)
        )
    )
  )
);

create or replace function campuspulse_private.campus_file_readable(p_path text, p_owner text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles me
    where me.id = (select auth.uid()) and me.active and (
      (p_owner = me.id::text and not campuspulse_private.campus_file_attached(p_path))
      or exists (
        select 1 from public.notices n
        where n.attachment_path = p_path
          and n.institution_id = me.institution_id
          and n.expires_at > now()
          and (
            n.author_id = me.id
            or public.is_institution_admin()
            or n.audience = 'institution'
            or (n.audience = 'department' and campuspulse_private.department_in_audience(me.department, n.audience_value))
            or (n.audience = 'role' and me.role = n.audience_value)
          )
      )
      or exists (
        select 1 from public.club_events e
        where e.attachment_path = p_path
          and e.institution_id = me.institution_id
          and e.starts_at > now() - interval '7 days'
          and (
            e.author_id = me.id
            or public.is_institution_admin()
            or e.audience = 'institution'
            or (e.audience = 'department' and campuspulse_private.department_in_audience(me.department, e.audience_value))
            or (e.audience = 'role' and me.role = e.audience_value)
          )
      )
    )
  );
$$;

create or replace function public.publish_notice(
  p_title text,
  p_body text,
  p_audience text,
  p_audience_value text,
  p_due timestamptz,
  p_expires timestamptz,
  p_attachment_path text default null,
  p_attachment_name text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  institution uuid;
  result uuid;
  clean_title text := btrim(coalesce(p_title, ''));
  clean_body text := btrim(coalesce(p_body, ''));
  clean_name text := left(btrim(coalesce(p_attachment_name, '')), 180);
  audience_value text;
  mime text;
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
  perform campuspulse_private.check_campus_file_upload(p_attachment_path, 'notice');
  if p_attachment_path is not null then
    if clean_name = '' then raise exception 'Add a file name for the attachment'; end if;
    select coalesce(metadata->>'mimetype', '') into mime
    from storage.objects where bucket_id = 'campus-files' and name = p_attachment_path;
  else
    clean_name := null;
    mime := null;
  end if;
  insert into public.notices(institution_id, author_id, title, body, audience, audience_value, due_at, expires_at, attachment_path, attachment_name, attachment_mime)
  values (institution, (select auth.uid()), clean_title, clean_body, p_audience, audience_value, p_due, p_expires, p_attachment_path, clean_name, mime)
  returning id into result;
  insert into public.notifications(recipient_id, kind, notice_id, message)
  select p.id, 'notice', result, left('Notice: ' || clean_title, 180)
  from public.profiles p
  where p.institution_id = institution and p.active and p.id is distinct from (select auth.uid()) and (
    p_audience = 'institution'
    or (p_audience = 'department' and campuspulse_private.department_in_audience(p.department, audience_value))
    or (p_audience = 'role' and p.role = audience_value)
  );
  return result;
end;
$$;

create or replace function public.publish_club_event(
  p_title text,
  p_body text,
  p_place text,
  p_starts timestamptz,
  p_ends timestamptz,
  p_audience text,
  p_audience_value text,
  p_club_name text default null,
  p_attachment_path text default null,
  p_attachment_name text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  institution uuid;
  result uuid;
  club uuid;
  clean_title text := btrim(coalesce(p_title, ''));
  clean_body text := btrim(coalesce(p_body, ''));
  clean_place text := btrim(coalesce(p_place, ''));
  clean_club text := btrim(coalesce(p_club_name, ''));
  clean_name text := left(btrim(coalesce(p_attachment_name, '')), 180);
  audience_value text;
  allowed boolean;
  mime text;
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
  perform campuspulse_private.check_campus_file_upload(p_attachment_path, 'event');
  if p_attachment_path is not null then
    if clean_name = '' then raise exception 'Add a file name for the poster'; end if;
    select coalesce(metadata->>'mimetype', '') into mime
    from storage.objects where bucket_id = 'campus-files' and name = p_attachment_path;
  else
    clean_name := null;
    mime := null;
  end if;

  insert into public.club_events(institution_id, author_id, title, body, place, starts_at, ends_at, audience, audience_value, club_id, attachment_path, attachment_name, attachment_mime)
  values (institution, (select auth.uid()), clean_title, clean_body, clean_place, p_starts, p_ends, p_audience, audience_value, club, p_attachment_path, clean_name, mime)
  returning id into result;

  insert into public.notifications(recipient_id, kind, event_id, message)
  select f.profile_id, 'event', result, left('Club event: ' || clean_title, 180)
  from public.club_follows f
  join public.profiles p on p.id = f.profile_id
  where f.club_id = club
    and p.institution_id = institution
    and p.active
    and p.id is distinct from (select auth.uid())
    and (
      p_audience = 'institution'
      or (p_audience = 'department' and campuspulse_private.department_in_audience(p.department, audience_value))
      or (p_audience = 'role' and p.role = audience_value)
    );

  return result;
end;
$$;

revoke all on function public.publish_notice(text, text, text, text, timestamptz, timestamptz, text, text),
  public.publish_club_event(text, text, text, timestamptz, timestamptz, text, text, text, text, text)
  from public, anon;
grant execute on function public.publish_notice(text, text, text, text, timestamptz, timestamptz, text, text),
  public.publish_club_event(text, text, text, timestamptz, timestamptz, text, text, text, text, text)
  to authenticated;
