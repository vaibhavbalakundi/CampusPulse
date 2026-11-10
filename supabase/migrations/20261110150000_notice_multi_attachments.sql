-- Multiple attachments per notice.

create table if not exists public.notice_attachments (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null references public.notices(id) on delete cascade,
  path text not null unique,
  name text not null check (char_length(name) between 1 and 180),
  mime text,
  sort_order smallint not null default 0 check (sort_order between 0 and 20),
  created_at timestamptz not null default now()
);

create index if not exists notice_attachments_notice_id_idx on public.notice_attachments(notice_id, sort_order);

alter table public.notice_attachments enable row level security;

drop policy if exists notice_attachments_read on public.notice_attachments;
create policy notice_attachments_read on public.notice_attachments for select to authenticated using (
  exists (
    select 1 from public.notices n
    where n.id = notice_attachments.notice_id
  )
);

-- Move any existing single attachment into the new table.
insert into public.notice_attachments(notice_id, path, name, mime, sort_order)
select id, attachment_path, coalesce(nullif(btrim(attachment_name), ''), 'Attachment'), attachment_mime, 0
from public.notices
where attachment_path is not null
on conflict (path) do nothing;

create or replace function campuspulse_private.campus_file_attached(p_path text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.notices where attachment_path = p_path
    union all
    select 1 from public.club_events where attachment_path = p_path
    union all
    select 1 from public.notice_attachments where path = p_path
  );
$$;

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
            or (
              n.audience = 'department'
              and n.audience_value <> ''
              and me.department <> ''
              and (
                me.department = n.audience_value
                or me.department = any (string_to_array(n.audience_value, '|'))
              )
            )
            or (n.audience = 'role' and me.role = n.audience_value)
          )
      )
      or exists (
        select 1
        from public.notice_attachments a
        join public.notices n on n.id = a.notice_id
        where a.path = p_path
          and n.institution_id = me.institution_id
          and n.expires_at > now()
          and (
            n.author_id = me.id
            or public.is_institution_admin()
            or n.audience = 'institution'
            or (
              n.audience = 'department'
              and n.audience_value <> ''
              and me.department <> ''
              and (
                me.department = n.audience_value
                or me.department = any (string_to_array(n.audience_value, '|'))
              )
            )
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
            or (
              e.audience = 'department'
              and e.audience_value <> ''
              and me.department <> ''
              and (
                me.department = e.audience_value
                or me.department = any (string_to_array(e.audience_value, '|'))
              )
            )
            or (e.audience = 'role' and me.role = e.audience_value)
          )
      )
    )
  );
$$;

drop function if exists public.publish_notice(text, text, text, text, timestamptz, timestamptz, text, text);

create function public.publish_notice(
  p_title text,
  p_body text,
  p_audience text,
  p_audience_value text,
  p_due timestamptz,
  p_expires timestamptz,
  p_attachment_paths text[] default null,
  p_attachment_names text[] default null
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
  audience_value text;
  paths text[] := coalesce(p_attachment_paths, array[]::text[]);
  names text[] := coalesce(p_attachment_names, array[]::text[]);
  path text;
  clean_name text;
  mime text;
  i integer;
  first_path text := null;
  first_name text := null;
  first_mime text := null;
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
  if cardinality(paths) > 5 then raise exception 'You can attach up to 5 files'; end if;
  if cardinality(names) <> cardinality(paths) then raise exception 'Attachment names do not match files'; end if;

  audience_value := campuspulse_private.require_audience(p_audience, p_audience_value);

  for i in 1..coalesce(cardinality(paths), 0) loop
    path := paths[i];
    clean_name := left(btrim(coalesce(names[i], '')), 180);
    perform campuspulse_private.check_campus_file_upload(path, 'notice');
    if clean_name = '' then raise exception 'Add a file name for each attachment'; end if;
    select coalesce(metadata->>'mimetype', '') into mime
    from storage.objects where bucket_id = 'campus-files' and name = path;
    if first_path is null then
      first_path := path;
      first_name := clean_name;
      first_mime := mime;
    end if;
  end loop;

  insert into public.notices(
    institution_id, author_id, title, body, audience, audience_value, due_at, expires_at,
    attachment_path, attachment_name, attachment_mime
  )
  values (
    institution, (select auth.uid()), clean_title, clean_body, p_audience, audience_value, p_due, p_expires,
    first_path, first_name, first_mime
  )
  returning id into result;

  for i in 1..coalesce(cardinality(paths), 0) loop
    path := paths[i];
    clean_name := left(btrim(coalesce(names[i], '')), 180);
    select coalesce(metadata->>'mimetype', '') into mime
    from storage.objects where bucket_id = 'campus-files' and name = path;
    insert into public.notice_attachments(notice_id, path, name, mime, sort_order)
    values (result, path, clean_name, nullif(mime, ''), i - 1);
  end loop;

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

revoke all on function public.publish_notice(text, text, text, text, timestamptz, timestamptz, text[], text[])
  from public, anon;
grant execute on function public.publish_notice(text, text, text, text, timestamptz, timestamptz, text[], text[])
  to authenticated;

revoke all on function campuspulse_private.campus_file_attached(text),
  campuspulse_private.campus_file_readable(text, text)
  from public, anon;
grant execute on function campuspulse_private.campus_file_attached(text),
  campuspulse_private.campus_file_readable(text, text)
  to authenticated;
