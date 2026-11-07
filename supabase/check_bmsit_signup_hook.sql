-- SQL-only hook checks. No user accounts or emails are created.
do $$
begin
  if public.restrict_bmsit_signup('{"user":{"email":"test@bmsit.in"}}'::jsonb) <> '{}'::jsonb then
    raise exception 'Valid domain was not accepted';
  end if;
  if public.restrict_bmsit_signup('{"user":{"email":"test@BMSIT.IN"}}'::jsonb) <> '{}'::jsonb then
    raise exception 'Domain comparison must be case insensitive';
  end if;
  if not jsonb_exists(public.restrict_bmsit_signup('{"user":{"email":"test@bmsit.in.example.com"}}'::jsonb), 'error')
    or not jsonb_exists(public.restrict_bmsit_signup('{"user":{"email":"test@example.com"}}'::jsonb), 'error')
    or not jsonb_exists(public.restrict_bmsit_signup('{"user":{}}'::jsonb), 'error') then
    raise exception 'An invalid or missing domain was accepted';
  end if;
end $$;
select 'Domain hook checks passed; no accounts were created' as result;
