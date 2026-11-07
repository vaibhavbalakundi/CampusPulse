-- Run in the Supabase SQL Editor after setup_test_profiles.sql.
-- All test changes are rolled back. Uses only the two fictional test accounts.
begin;
select set_config('sygnetta_test.student', coalesce((select id::text from auth.users where lower(email) = 'student@sygnetta.example.com'), ''), true),
       set_config('sygnetta_test.faculty', coalesce((select id::text from auth.users where lower(email) = 'faculty@sygnetta.example.com'), ''), true);
do $$ begin
  if current_setting('sygnetta_test.student') = '' or current_setting('sygnetta_test.faculty') = '' then
    raise exception 'Both fictional test accounts must exist';
  end if;
end $$;

-- Check that the anonymous role cannot see the existing test profiles/status.
set local role anon;
do $$ begin
  if exists (select 1 from public.profiles) or exists (select 1 from public.availability) then
    raise exception 'Anonymous users can read profiles or availability';
  end if;
end $$;
reset role;

-- Simulate the faculty's authenticated database context.
select set_config('request.jwt.claim.sub', current_setting('sygnetta_test.faculty'), true),
       set_config('request.jwt.claims', json_build_object('sub',current_setting('sygnetta_test.faculty'),'role','authenticated')::text, true);
set local role authenticated;
select public.set_availability('available', 60);
reset role;

-- Simulate the student, verify availability, and create a request.
select set_config('request.jwt.claim.sub', current_setting('sygnetta_test.student'), true),
       set_config('request.jwt.claims', json_build_object('sub',current_setting('sygnetta_test.student'),'role','authenticated')::text, true);
set local role authenticated;
do $$ begin
  if not exists (select 1 from public.availability where faculty_id=current_setting('sygnetta_test.faculty')::uuid and status='available') then
    raise exception 'Student cannot see faculty availability';
  end if;
  begin
    perform public.set_availability('available',60);
    raise exception 'Student was incorrectly allowed to set availability';
  exception when others then
    if sqlerrm <> 'Faculty access required' then raise; end if;
  end;
end $$;
select set_config('sygnetta_test.request', public.create_meeting_request(current_setting('sygnetta_test.faculty')::uuid, 'Fictional test inquiry', 'Tomorrow afternoon')::text, true);
reset role;

-- Faculty responds to that request.
select set_config('request.jwt.claim.sub', current_setting('sygnetta_test.faculty'), true),
       set_config('request.jwt.claims', json_build_object('sub',current_setting('sygnetta_test.faculty'),'role','authenticated')::text, true);
set local role authenticated;
do $$ begin
  if not exists (select 1 from public.meeting_requests where id=current_setting('sygnetta_test.request')::uuid and status='pending') then
    raise exception 'Faculty cannot see the new request';
  end if;
end $$;
select public.respond_to_request(current_setting('sygnetta_test.request')::uuid,'accepted',null);
reset role;

-- Verify the student's response and in-app notification.
select set_config('request.jwt.claim.sub', current_setting('sygnetta_test.student'), true),
       set_config('request.jwt.claims', json_build_object('sub',current_setting('sygnetta_test.student'),'role','authenticated')::text, true);
set local role authenticated;
do $$ begin
  if not exists (select 1 from public.meeting_requests where id=current_setting('sygnetta_test.request')::uuid and status='accepted') then
    raise exception 'Student cannot see the accepted response';
  end if;
  if not exists (select 1 from public.notifications where request_id=current_setting('sygnetta_test.request')::uuid) then
    raise exception 'Student did not receive an in-app update';
  end if;
end $$;
reset role;
rollback;
select 'Workflow checks passed; test changes rolled back' as result;
