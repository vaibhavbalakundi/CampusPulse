-- Keep old notifications private if a profile is moved to another institution.
begin;
drop policy notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated using (
  recipient_id = auth.uid() and exists (
    select 1 from public.meeting_requests r
    where r.id = notifications.request_id and r.institution_id = public.current_institution()
      and (r.student_id = auth.uid() or r.faculty_id = auth.uid())
  )
);
create or replace function public.mark_notifications_read() returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.current_institution() is null then raise exception 'Active account required'; end if;
  update public.notifications n set read_at=now()
  where n.recipient_id=auth.uid() and n.read_at is null and exists (
    select 1 from public.meeting_requests r where r.id=n.request_id
      and r.institution_id=public.current_institution()
      and (r.student_id=auth.uid() or r.faculty_id=auth.uid())
  );
end $$;
commit;
