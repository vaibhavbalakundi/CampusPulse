-- Run after migration 004 and test-profile setup. All changes roll back.
begin;
select set_config('sygnetta_test.student',coalesce((select id::text from auth.users where lower(email)='student@sygnetta.example.com'),''),true),
       set_config('sygnetta_test.faculty',coalesce((select id::text from auth.users where lower(email)='faculty@sygnetta.example.com'),''),true);
do $$ begin
  if current_setting('sygnetta_test.student')='' or current_setting('sygnetta_test.faculty')='' then raise exception 'Both test accounts are required'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('sygnetta_test.faculty'),true),
       set_config('request.jwt.claims',json_build_object('sub',current_setting('sygnetta_test.faculty'),'role','authenticated')::text,true);
set local role authenticated;
select public.schedule_status('busy',now()+interval '5 minutes',now()+interval '20 minutes');
reset role;
select set_config('request.jwt.claim.sub',current_setting('sygnetta_test.student'),true),
       set_config('request.jwt.claims',json_build_object('sub',current_setting('sygnetta_test.student'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if not exists (select 1 from public.scheduled_status where faculty_id=current_setting('sygnetta_test.faculty')::uuid and status='busy' and starts_at > now()) then raise exception 'Student cannot see the scheduled status'; end if;
  begin
    perform public.schedule_status('available',now()+interval '5 minutes',now()+interval '20 minutes');
    raise exception 'Student was incorrectly allowed to schedule a status';
  exception when others then
    if sqlerrm <> 'Faculty access required' then raise; end if;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('sygnetta_test.faculty'),true),
       set_config('request.jwt.claims',json_build_object('sub',current_setting('sygnetta_test.faculty'),'role','authenticated')::text,true);
set local role authenticated;
select public.cancel_scheduled_status();
do $$ begin
  if exists (select 1 from public.scheduled_status where faculty_id=auth.uid() and starts_at > now()) then raise exception 'Scheduled status was not cancelled'; end if;
end $$;
reset role;
rollback;
select 'Scheduled-status checks passed; test changes rolled back' as result;
