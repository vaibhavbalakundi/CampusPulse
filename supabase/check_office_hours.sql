-- Run after the office-hours migration and test-profile setup. All changes roll back.
begin;
select set_config('sygnetta_test.student', coalesce((select id::text from auth.users where lower(email)='student@sygnetta.example.com'),''), true),
       set_config('sygnetta_test.faculty', coalesce((select id::text from auth.users where lower(email)='faculty@sygnetta.example.com'),''), true);
do $$ begin
  if current_setting('sygnetta_test.student')='' or current_setting('sygnetta_test.faculty')='' then raise exception 'Both test accounts are required'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('sygnetta_test.faculty'),true),
       set_config('request.jwt.claims',json_build_object('sub',current_setting('sygnetta_test.faculty'),'role','authenticated')::text,true);
set local role authenticated;
select set_config('sygnetta_test.hour',public.add_office_hour(6,'05:17'::time,'05:18'::time,'Asia/Kolkata')::text,true);
reset role;
select set_config('request.jwt.claim.sub',current_setting('sygnetta_test.student'),true),
       set_config('request.jwt.claims',json_build_object('sub',current_setting('sygnetta_test.student'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if not exists (select 1 from public.office_hours where id=current_setting('sygnetta_test.hour')::uuid) then raise exception 'Student cannot see faculty office hours'; end if;
  begin
    perform public.remove_office_hour(current_setting('sygnetta_test.hour')::uuid);
    raise exception 'Student was incorrectly allowed to remove office hours';
  exception when others then
    if sqlerrm <> 'Faculty access required' then raise; end if;
  end;
end $$;
reset role;
rollback;
select 'Office-hours checks passed; test changes rolled back' as result;
