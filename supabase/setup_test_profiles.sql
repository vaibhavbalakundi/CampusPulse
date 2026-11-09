-- Run only after creating and confirming these two fictional accounts in
-- Supabase Authentication. This script creates no passwords or Auth users.
-- It stops if either account is missing or already has a profile.
do $$
declare
  faculty_user uuid;
  student_user uuid;
  test_institution uuid;
begin
  select id into faculty_user from auth.users where lower(email) = 'faculty@sygnetta.example.com';
  select id into student_user from auth.users where lower(email) = 'student@sygnetta.example.com';
  if faculty_user is null or student_user is null then
    raise exception 'Create both fictional Auth users before running this script';
  end if;
  if exists (select 1 from public.profiles where id in (faculty_user, student_user)) then
    raise exception 'A test user already has a profile; no changes were made';
  end if;
  insert into public.institutions(name) values ('Sygnetta Test Campus') returning id into test_institution;
  insert into public.profiles(id,institution_id,role,name,department,office_location) values
    (faculty_user,test_institution,'faculty','Dr. Aanya Sharma','Computer Science','Room 204'),
    (student_user,test_institution,'student','Example Student','Computer Science',null);
end $$;
