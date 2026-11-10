-- Inline multi-department checks so RLS does not depend on private EXECUTE grants.

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
          or (
            audience = 'department'
            and audience_value <> ''
            and p.department <> ''
            and (
              p.department = audience_value
              or p.department = any (string_to_array(audience_value, '|'))
            )
          )
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
          or (
            audience = 'department'
            and audience_value <> ''
            and p.department <> ''
            and (
              p.department = audience_value
              or p.department = any (string_to_array(audience_value, '|'))
            )
          )
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
