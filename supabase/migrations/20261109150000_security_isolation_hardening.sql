-- College safety hardening:
-- 1) Status notifications must be readable by the recipient (and only them).
-- 2) Faculty leave notes stay private to the faculty member and campus admins.
-- 3) Expire-nudge helper is internal-only (no direct client execute).
-- 4) Hot RLS policies evaluate auth.uid() once per query for scale.
-- 5) Covering indexes for common foreign keys under concurrent load.

-- Status notification isolation (recipient-only; no meeting/notice/event join required).
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated using (
  recipient_id = (select auth.uid()) and (
    (kind = 'meeting' and exists (
      select 1 from public.meeting_requests r
      where r.id = request_id
        and r.institution_id = public.current_institution()
        and (r.student_id = (select auth.uid()) or r.faculty_id = (select auth.uid()))
    ))
    or (kind = 'notice' and exists (
      select 1 from public.notices n
      where n.id = notice_id
        and n.institution_id = public.current_institution()
        and n.expires_at > now()
    ))
    or (kind = 'event' and exists (
      select 1 from public.club_events e
      where e.id = event_id
        and e.institution_id = public.current_institution()
    ))
    or (
      kind = 'status'
      and request_id is null
      and notice_id is null
      and event_id is null
      and public.current_institution() is not null
    )
  )
);

drop policy if exists notices_retention_window on public.notifications;
create policy notices_retention_window on public.notifications as restrictive for select to authenticated using (
  (kind = 'meeting' and exists (select 1 from public.meeting_requests r where r.id = request_id))
  or kind in ('notice', 'event', 'status')
);

create or replace function public.mark_notifications_read() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.current_institution() is null then raise exception 'Active account required'; end if;
  update public.notifications n set read_at = now()
  where n.recipient_id = (select auth.uid()) and n.read_at is null and (
    (n.kind = 'meeting' and exists (
      select 1 from public.meeting_requests r
      where r.id = n.request_id
        and r.institution_id = public.current_institution()
        and (r.student_id = (select auth.uid()) or r.faculty_id = (select auth.uid()))
    ))
    or (n.kind = 'notice' and exists (
      select 1 from public.notices x
      where x.id = n.notice_id and x.institution_id = public.current_institution()
    ))
    or (n.kind = 'event' and exists (
      select 1 from public.club_events x
      where x.id = n.event_id and x.institution_id = public.current_institution()
    ))
    or (
      n.kind = 'status'
      and n.request_id is null
      and n.notice_id is null
      and n.event_id is null
    )
  );
end $$;

revoke all on function public.mark_notifications_read() from public, anon;
grant execute on function public.mark_notifications_read() to authenticated;

-- Leave notes are personal; request-time leave checks use SECURITY DEFINER RPCs.
drop policy if exists leave_read on public.faculty_leave_days;
create policy leave_read on public.faculty_leave_days for select to authenticated
  using (
    institution_id = public.current_institution()
    and (
      faculty_id = (select auth.uid())
      or public.is_institution_admin()
    )
  );

-- Anyone signed in could previously force-expire every open nudge campus-wide.
revoke all on function public.expire_status_nudges() from public, anon, authenticated;

-- Hot-path RLS: evaluate auth.uid() once per statement.
drop policy if exists profiles_read on public.profiles;
drop policy if exists profiles_admin_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (
  institution_id = public.current_institution() and (
    public.is_institution_admin()
    or id = (select auth.uid())
    or (role = 'faculty' and active)
    or exists (
      select 1 from public.meeting_requests r
      where r.student_id = profiles.id and r.faculty_id = (select auth.uid())
    )
  )
);

drop policy if exists requests_read on public.meeting_requests;
create policy requests_read on public.meeting_requests for select to authenticated using (
  institution_id = public.current_institution()
  and (student_id = (select auth.uid()) or faculty_id = (select auth.uid()))
);

drop policy if exists privacy_requests_own on public.privacy_requests;
create policy privacy_requests_own on public.privacy_requests for select to authenticated
  using (user_id = (select auth.uid()) or public.is_institution_admin());

drop policy if exists status_nudges_read on public.status_nudges;
create policy status_nudges_read on public.status_nudges for select to authenticated
  using (
    institution_id = public.current_institution()
    and (
      faculty_id = (select auth.uid())
      or student_id = (select auth.uid())
      or public.is_institution_admin()
    )
  );

-- Foreign-key indexes that matter under concurrent campus load.
create index if not exists profiles_institution_id_idx on public.profiles (institution_id);
create index if not exists meeting_requests_institution_id_idx on public.meeting_requests (institution_id);
create index if not exists notifications_request_id_idx on public.notifications (request_id);
create index if not exists notifications_notice_id_idx on public.notifications (notice_id);
create index if not exists notifications_event_id_idx on public.notifications (event_id);
create index if not exists meeting_minutes_institution_id_idx on public.meeting_minutes (institution_id);
create index if not exists personal_deadlines_institution_id_idx on public.personal_deadlines (institution_id);
create index if not exists notices_author_id_idx on public.notices (author_id);
create index if not exists club_events_author_id_idx on public.club_events (author_id);
create index if not exists club_events_club_id_idx on public.club_events (club_id);
create index if not exists club_follows_profile_id_idx on public.club_follows (profile_id);
create index if not exists faculty_leave_days_institution_id_idx on public.faculty_leave_days (institution_id);
create index if not exists status_nudges_institution_id_idx on public.status_nudges (institution_id);
create index if not exists privacy_requests_user_id_idx on public.privacy_requests (user_id);
create index if not exists audit_events_actor_id_idx on public.audit_events (actor_id);
