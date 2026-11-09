-- SQL-only hook checks. No user accounts or emails are created.
do $$
begin
  if public.restrict_bmsit_signup('{"user":{"email":"test@bmsit.in"}}'::jsonb) <> '{}'::jsonb then
    raise exception 'expected campus domain email to pass';
  end if;
  if public.restrict_bmsit_signup('{"user":{"email":"teacher@gmail.com"}}'::jsonb) <> '{}'::jsonb then
    raise exception 'expected any valid email to pass';
  end if;
  if public.restrict_bmsit_signup('{"user":{"email":"test@BMSIT.IN"}}'::jsonb) <> '{}'::jsonb then
    raise exception 'expected case-insensitive email to pass';
  end if;
  if not jsonb_exists(public.restrict_bmsit_signup('{"user":{"email":"not-an-email"}}'::jsonb), 'error')
    or not jsonb_exists(public.restrict_bmsit_signup('{"user":{"email":"@example.com"}}'::jsonb), 'error')
    or not jsonb_exists(public.restrict_bmsit_signup('{"user":{}}'::jsonb), 'error') then
    raise exception 'expected malformed emails to fail';
  end if;
end $$;
select 'Email hook checks passed; no accounts were created' as result;
