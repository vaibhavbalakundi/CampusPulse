-- Preview before enabling this schedule on 2026-11-03: 0 meeting records and 0 abandoned uploads due.
-- A random webhook credential is generated and kept entirely inside Supabase Vault.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$ begin
  if not exists (select 1 from vault.secrets where name='campuspulse_retention_job') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'campuspulse_retention_job','Internal meeting maintenance webhook');
  end if;
end $$;
select cron.schedule('campuspulse-expire-meetings','* * * * *', $$select public.expire_meeting_requests();$$);
select cron.schedule('campuspulse-retention','17 * * * *', $job$
  select net.http_post(
    url:='https://zqljaarwncamxqxawcxd.supabase.co/functions/v1/meeting-maintenance',
    headers:=jsonb_build_object('Content-Type','application/json','x-campus-job-token',
      (select decrypted_secret from vault.decrypted_secrets where name='campuspulse_retention_job')),
    body:='{}'::jsonb, timeout_milliseconds:=120000
  );
$job$);
