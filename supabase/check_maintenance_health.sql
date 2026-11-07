-- Read-only operational check. Do not select Vault values or request headers.
select jobname,schedule,active from cron.job where jobname like 'campuspulse-%';
select j.jobname,d.status,d.return_message,d.start_time,d.end_time
from cron.job_run_details d join cron.job j using(jobid)
where j.jobname like 'campuspulse-%' order by d.start_time desc limit 20;
select
  count(*) filter (where status in ('pending','accepted','alternative') and meeting_at<=now()) as overdue_active_requests,
  count(*) filter (where purge_after<=now()) as cleanup_backlog,
  count(*) filter (where meeting_at is null) as legacy_records_needing_review
from public.meeting_requests;
-- Inspect the corresponding Edge Function response after a queued invocation.
-- pg_cron success proves enqueueing only; HTTP 200 and the Edge logs prove execution.
select id,status_code,timed_out,error_msg from net._http_response order by created desc limit 10;
