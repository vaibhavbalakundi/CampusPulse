-- Pilot metrics for administrators. Meeting content is never included.
create or replace function public.admin_usage_summary() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare campus uuid;
begin
  select institution_id into campus from public.profiles where id=auth.uid() and active and role='admin';
  if campus is null then raise exception 'Administrator access required'; end if;
  return jsonb_build_object(
    'active_students',(select count(*) from public.profiles where institution_id=campus and role='student' and active),
    'active_faculty',(select count(*) from public.profiles where institution_id=campus and role='faculty' and active),
    'inactive_profiles',(select count(*) from public.profiles where institution_id=campus and not active),
    'requests_last_7_days',(select count(*) from public.meeting_requests where institution_id=campus and created_at >= now()-interval '7 days'),
    'pending_requests',(select count(*) from public.meeting_requests where institution_id=campus and status='pending'),
    'accepted_last_7_days',(select count(*) from public.meeting_requests where institution_id=campus and status='accepted' and updated_at >= now()-interval '7 days'),
    'declined_last_7_days',(select count(*) from public.meeting_requests where institution_id=campus and status='declined' and updated_at >= now()-interval '7 days'),
    'alternative_last_7_days',(select count(*) from public.meeting_requests where institution_id=campus and status='alternative' and updated_at >= now()-interval '7 days'),
    'median_response_hours',(
      select round((percentile_cont(0.5) within group (
        order by extract(epoch from (updated_at - created_at)) / 3600.0
      ))::numeric, 1)
      from public.meeting_requests
      where institution_id=campus
        and status in ('accepted','declined','alternative')
        and updated_at >= now()-interval '7 days'
        and updated_at > created_at
    )
  );
end $$;

revoke all on function public.admin_usage_summary() from public;
grant execute on function public.admin_usage_summary() to authenticated;
