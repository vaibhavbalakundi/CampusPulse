-- The managed pg_net queue is not owned by postgres. Do not enqueue reusable secrets.
create table campuspulse_private.used_maintenance_tickets (
  nonce uuid primary key, used_at timestamptz not null default now()
);
alter table campuspulse_private.used_maintenance_tickets enable row level security;
revoke all on campuspulse_private.used_maintenance_tickets from public,anon,authenticated;

create function campuspulse_private.issue_retention_job_ticket() returns text
language plpgsql volatile security invoker set search_path='' as $$
declare payload text; key text;
begin
  payload := floor(extract(epoch from clock_timestamp()))::bigint::text || '.' || gen_random_uuid()::text;
  select decrypted_secret into key from vault.decrypted_secrets where name='campuspulse_retention_job';
  if key is null then raise exception 'Maintenance signing key unavailable'; end if;
  return payload || '.' || encode(extensions.hmac(payload,key,'sha256'),'hex');
end $$;
revoke all on function campuspulse_private.issue_retention_job_ticket() from public,anon,authenticated,service_role;

create or replace function public.validate_retention_job_token(p_token text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare payload text; key text; expected text; inserted integer;
begin
  if p_token is null or p_token !~ '^[0-9]{10,12}\.[0-9a-f-]{36}\.[0-9a-f]{64}$' then return false; end if;
  if abs(extract(epoch from clock_timestamp())-split_part(p_token,'.',1)::numeric)>120 then return false; end if;
  payload := split_part(p_token,'.',1) || '.' || split_part(p_token,'.',2);
  select decrypted_secret into key from vault.decrypted_secrets where name='campuspulse_retention_job';
  if key is null then return false; end if;
  expected := encode(extensions.hmac(payload,key,'sha256'),'hex');
  if split_part(p_token,'.',3)<>expected then return false; end if;
  insert into campuspulse_private.used_maintenance_tickets(nonce) values(split_part(p_token,'.',2)::uuid) on conflict do nothing;
  get diagnostics inserted=row_count;
  delete from campuspulse_private.used_maintenance_tickets where used_at<now()-interval '1 day';
  return inserted=1;
exception when invalid_text_representation then return false;
end $$;
-- Replaces only the CampusPulse retention job; no unrelated queue privileges change.
select cron.schedule('campuspulse-retention','17 * * * *', $job$
  select net.http_post(
    url:='https://zqljaarwncamxqxawcxd.supabase.co/functions/v1/meeting-maintenance',
    headers:=jsonb_build_object('Content-Type','application/json','x-campus-job-token',campuspulse_private.issue_retention_job_ticket()),
    body:='{}'::jsonb,timeout_milliseconds:=120000
  );
$job$);
