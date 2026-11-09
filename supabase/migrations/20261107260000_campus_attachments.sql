-- Optional file attachments for notices and club event posters.

alter table public.notices
  add column if not exists attachment_path text unique,
  add column if not exists attachment_name text,
  add column if not exists attachment_mime text;

alter table public.club_events
  add column if not exists attachment_path text unique,
  add column if not exists attachment_name text,
  add column if not exists attachment_mime text;

do $$ begin
  alter table public.notices
    add constraint notices_attachment_name_len check (attachment_name is null or char_length(attachment_name) between 1 and 180);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.club_events
    add constraint club_events_attachment_name_len check (attachment_name is null or char_length(attachment_name) between 1 and 180);
exception when duplicate_object then null;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'campus-files',
  'campus-files',
  false,
  10485760,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf',
    'text/plain', 'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function campuspulse_private.campus_file_attached(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.notices where attachment_path = p_path
    union all
    select 1 from public.club_events where attachment_path = p_path
  )
$$;

create or replace function campuspulse_private.campus_file_readable(p_path text, p_owner text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active and (
      (p_owner = p.id::text and not campuspulse_private.campus_file_attached(p_path))
      or exists (
        select 1 from public.notices n
        where n.attachment_path = p_path and n.institution_id = p.institution_id
      )
      or exists (
        select 1 from public.club_events e
        where e.attachment_path = p_path and e.institution_id = p.institution_id
      )
    )
  )
$$;

create or replace function campuspulse_private.check_campus_file_upload(p_path text, p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o storage.objects;
  mime text;
  notice_mimes text[] := array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf',
    'text/plain', 'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ];
  event_mimes text[] := array['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
begin
  if p_path is null then return; end if;
  if auth.uid() is null or split_part(p_path, '/', 1) <> auth.uid()::text then
    raise exception 'Attachment unavailable';
  end if;
  select * into o from storage.objects where bucket_id = 'campus-files' and name = p_path for update;
  if not found or o.owner_id is distinct from auth.uid()::text
    or coalesce((o.metadata->>'size')::bigint, 0) not between 1 and 10485760
    or campuspulse_private.campus_file_attached(p_path) then
    raise exception 'Attachment unavailable';
  end if;
  mime := coalesce(o.metadata->>'mimetype', '');
  if p_kind = 'event' then
    if mime <> all (event_mimes) then raise exception 'Event posters must be JPG, PNG, WEBP, or GIF'; end if;
  elsif p_kind = 'notice' then
    if mime <> all (notice_mimes) then raise exception 'That file type is not allowed for notices'; end if;
  else
    raise exception 'Attachment unavailable';
  end if;
end $$;

revoke all on function campuspulse_private.campus_file_attached(text),
  campuspulse_private.campus_file_readable(text, text),
  campuspulse_private.check_campus_file_upload(text, text)
  from public, anon, authenticated;
grant execute on function campuspulse_private.campus_file_attached(text),
  campuspulse_private.campus_file_readable(text, text)
  to authenticated;

drop policy if exists campus_files_upload on storage.objects;
create policy campus_files_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'campus-files'
  and owner_id = (select auth.uid())::text
  and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f-]{36}\.[a-z0-9]{2,8}$')
  and exists (select 1 from public.profiles where id = (select auth.uid()) and active)
);

drop policy if exists campus_files_read on storage.objects;
create policy campus_files_read on storage.objects for select to authenticated using (
  bucket_id = 'campus-files' and campuspulse_private.campus_file_readable(name, owner_id)
);

drop policy if exists campus_files_discard on storage.objects;
create policy campus_files_discard on storage.objects for delete to authenticated using (
  bucket_id = 'campus-files'
  and owner_id = (select auth.uid())::text
  and public.current_institution() is not null
  and not campuspulse_private.campus_file_attached(name)
);

drop function if exists public.publish_notice(text, text, text, text, timestamptz, timestamptz);
create function public.publish_notice(
  p_title text,
  p_body text,
  p_audience text,
  p_audience_value text,
  p_due timestamptz,
  p_expires timestamptz,
  p_attachment_path text default null,
  p_attachment_name text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
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
    or (p_audience = 'department' and p.department = audience_value)
    or (p_audience = 'role' and p.role = audience_value)
  );
  return result;
end $$;

drop function if exists public.publish_club_event(text, text, text, timestamptz, timestamptz, text, text, text);
create function public.publish_club_event(
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

revoke all on function public.publish_notice(text, text, text, text, timestamptz, timestamptz, text, text),
  public.publish_club_event(text, text, text, timestamptz, timestamptz, text, text, text, text, text)
  from public, anon;
grant execute on function public.publish_notice(text, text, text, text, timestamptz, timestamptz, text, text),
  public.publish_club_event(text, text, text, timestamptz, timestamptz, text, text, text, text, text)
  to authenticated;
