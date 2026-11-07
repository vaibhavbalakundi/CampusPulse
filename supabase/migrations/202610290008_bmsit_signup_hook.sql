-- Defines the Auth hook, but does not activate it. Enable it in the Supabase
-- Dashboard under Authentication > Hooks > Before User Created after review.
-- Existing test accounts are not changed; new accounts must use @bmsit.in.
create function public.restrict_bmsit_signup(event jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare signup_email text;
begin
  signup_email := coalesce(event->'user'->>'email','');
  if signup_email !~* '^[^@[:space:]]+@bmsit[.]in$' then
    return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','Use a valid @bmsit.in email address to sign up.'));
  end if;
  return '{}'::jsonb;
end $$;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.restrict_bmsit_signup(jsonb) to supabase_auth_admin;
revoke execute on function public.restrict_bmsit_signup(jsonb) from public, anon, authenticated;
