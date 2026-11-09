-- Enforce event audience on browse (role / department / whole college).
-- Follow still controls alerts, but only for people who also match the audience.

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
          or (audience = 'department' and p.department = audience_value and audience_value <> '')
          or (audience = 'role' and p.role = audience_value)
        )
    )
  )
);

-- Attachment reads must follow the same visibility as the parent event/notice.
create or replace function campuspulse_private.campus_file_readable(p_path text, p_owner text) returns boolean
language sql stable security definer set search_path = '' as $$
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
            or (n.audience = 'department' and me.department = n.audience_value and n.audience_value <> '')
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
            or (e.audience = 'department' and me.department = e.audience_value and e.audience_value <> '')
            or (e.audience = 'role' and me.role = e.audience_value)
          )
      )
    )
  )
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
language plpgsql security definer set search_path = '' as $$
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

  -- Phone / Updates alerts: followers who also match the chosen audience.
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
      or (p_audience = 'department' and p.department = audience_value)
      or (p_audience = 'role' and p.role = audience_value)
    );

  return result;
end $$;

revoke all on function public.publish_club_event(text, text, text, timestamptz, timestamptz, text, text, text, text, text)
  from public, anon;
grant execute on function public.publish_club_event(text, text, text, timestamptz, timestamptz, text, text, text, text, text)
  to authenticated;
