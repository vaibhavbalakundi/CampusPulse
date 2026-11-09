-- Limited to the internal queue created for the new maintenance jobs.
-- Application sessions do not enqueue/read/edit raw maintenance requests.
-- Keep net functions, other tables, schema access and the existing Vault token unchanged.
-- Preserve explicit access for the postgres scheduler and the supabase_admin owner.
grant all on table net.http_request_queue to postgres;
revoke all on table net.http_request_queue from public,anon,authenticated;
