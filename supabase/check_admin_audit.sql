-- Run after migration 005 and test-profile setup. All changes roll back.
begin;
select set_config('sygnetta_test.student',coalesce((select id::text from auth.users where lower(email)='student@sygnetta.example.com'),''),true),
       set_config('sygnetta_test.faculty',coalesce((select id::text from auth.users where lower(email)='faculty@sygnetta.example.com'),''),true);
do $$ begin
  if current_setting('sygnetta_test.student')='' or current_setting('sygnetta_test.faculty')='' then raise exception 'Both test accounts are required'; end if;
end $$;
update public.profiles set role='admin' where id=current_setting('sygnetta_test.faculty')::uuid;
select set_config('request.jwt.claim.sub',current_setting('sygnetta_test.student'),true),
       set_config('request.jwt.claims',json_build_object('sub',current_setting('sygnetta_test.student'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.audit_events) then raise exception 'Student can see audit events'; end if;
  begin
    perform public.admin_usage_summary();
    raise exception 'Student was incorrectly allowed to view usage summary';
  exception when others then
    if sqlerrm <> 'Administrator access required' then raise; end if;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('sygnetta_test.faculty'),true),
       set_config('request.jwt.claims',json_build_object('sub',current_setting('sygnetta_test.faculty'),'role','authenticated')::text,true);
set local role authenticated;
select public.admin_update_profile(current_setting('sygnetta_test.student')::uuid,'Example Student','Audit Test','student',true);
do $$ begin
  if not exists(select 1 from public.audit_events where actor_id=auth.uid() and action='profile_updated' and target_id=current_setting('sygnetta_test.student')::uuid) then raise exception 'Expected audit event missing'; end if;
  if (public.admin_usage_summary()->>'active_students')::integer < 1 then raise exception 'Usage summary is incorrect'; end if;
end $$;
reset role;
rollback;
select 'Administration and audit checks passed; test changes rolled back' as result;
