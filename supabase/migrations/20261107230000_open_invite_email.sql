-- Invite-first, multi-college: any valid email may create an Auth user.
-- College membership comes from profiles.institution_id set by the inviting admin.
create or replace function public.restrict_bmsit_signup(event jsonb) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  signup_email text := lower(coalesce(event->'user'->>'email',''));
begin
  if signup_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','Use a valid email address.'));
  end if;
  return '{}'::jsonb;
end;
$$;

grant execute on function public.restrict_bmsit_signup(jsonb) to supabase_auth_admin;
revoke execute on function public.restrict_bmsit_signup(jsonb) from public, anon, authenticated;
