-- Create and confirm admin@sygnetta.example.com in Supabase Auth first.
-- This script creates only a fictional administrator profile; no password or Auth user.
do $$
declare admin_user uuid; campus uuid;
begin
  select id into admin_user from auth.users where lower(email)='admin@sygnetta.example.com' and email_confirmed_at is not null;
  select p.institution_id into campus from public.profiles p join auth.users u on u.id=p.id
    where lower(u.email)='faculty@sygnetta.example.com';
  if admin_user is null or campus is null then raise exception 'Create and confirm the test admin and set up the faculty test profile first'; end if;
  if exists (select 1 from public.profiles where id=admin_user) then raise exception 'The test admin already has a profile; no changes were made'; end if;
  insert into public.profiles(id,institution_id,role,name,department) values(admin_user,campus,'admin','Example Administrator','Test Campus');
end $$;
