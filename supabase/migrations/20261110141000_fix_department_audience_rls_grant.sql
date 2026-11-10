-- RLS policies call department_in_audience as the querying role.
grant execute on function campuspulse_private.department_in_audience(text, text) to authenticated;
revoke all on function campuspulse_private.department_in_audience(text, text) from public, anon;
