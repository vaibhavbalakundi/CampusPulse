-- Run after migration 003 and test-profile setup; all changes roll back.
begin;
select set_config('sygnetta_test.student',coalesce((select id::text from auth.users where lower(email)='student@sygnetta.example.com'),''),true),
       set_config('sygnetta_test.faculty',coalesce((select id::text from auth.users where lower(email)='faculty@sygnetta.example.com'),''),true);
do $$ begin
  if current_setting('sygnetta_test.student')='' or current_setting('sygnetta_test.faculty')='' then raise exception 'Both test accounts are required'; end if;
end $$;
-- Temporarily make the fictional faculty account an admin for this test only.
update public.profiles set role='admin' where id=current_setting('sygnetta_test.faculty')::uuid;
select set_config('request.jwt.claim.sub',current_setting('sygnetta_test.student'),true),
       set_config('request.jwt.claims',json_build_object('sub',current_setting('sygnetta_test.student'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  begin
    perform public.admin_update_profile(current_setting('sygnetta_test.student')::uuid,'Example Student','Test','admin',true);
    raise exception 'Student was incorrectly allowed to administer profiles';
  exception when others then
    if sqlerrm <> 'Administrator access required' then raise; end if;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('sygnetta_test.faculty'),true),
       set_config('request.jwt.claims',json_build_object('sub',current_setting('sygnetta_test.faculty'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if not exists (select 1 from public.profiles where id=current_setting('sygnetta_test.student')::uuid) then raise exception 'Admin cannot read institution profiles'; end if;
  begin
    perform public.admin_update_profile(current_setting('sygnetta_test.faculty')::uuid,'Test Admin','Test','student',true);
    raise exception 'Administrator was incorrectly allowed to remove own access';
  exception when others then
    if sqlerrm <> 'You cannot deactivate or remove your own administrator access' then raise; end if;
  end;
end $$;
select public.admin_update_profile(current_setting('sygnetta_test.student')::uuid,'Example Student','Test','student',false);
reset role;
select set_config('request.jwt.claim.sub',current_setting('sygnetta_test.student'),true),
       set_config('request.jwt.claims',json_build_object('sub',current_setting('sygnetta_test.student'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.profiles) then raise exception 'Disabled user can still read profiles'; end if;
end $$;
reset role;
rollback;
select 'Admin checks passed; test changes rolled back' as result;
