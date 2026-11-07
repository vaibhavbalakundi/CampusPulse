-- Run after migration 007 and fictional test-profile setup. All changes roll back.
begin;
select set_config('sygnetta_test.student',coalesce((select id::text from auth.users where lower(email)='student@sygnetta.example.com'),''),true),
       set_config('sygnetta_test.admin',coalesce((select id::text from auth.users where lower(email)='admin@sygnetta.example.com'),''),true);
do $$ begin
  if current_setting('sygnetta_test.student')='' or current_setting('sygnetta_test.admin')='' then raise exception 'Student and admin test accounts are required'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('sygnetta_test.student'),true),
       set_config('request.jwt.claims',json_build_object('sub',current_setting('sygnetta_test.student'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  begin
    perform public.admin_import_profiles('[]'::jsonb);
    raise exception 'Student was incorrectly allowed to import profiles';
  exception when others then if sqlerrm <> 'Administrator access required' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('sygnetta_test.admin'),true),
       set_config('request.jwt.claims',json_build_object('sub',current_setting('sygnetta_test.admin'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  begin
    perform public.admin_import_profiles('[{"auth_user_id":"00000000-0000-4000-8000-000000000000","name":"Example","department":"Test","role":"admin"}]'::jsonb);
    raise exception 'Admin role was incorrectly allowed in an import';
  exception when others then if sqlerrm <> 'Each row needs an Auth user ID and student or faculty role' then raise; end if; end;
  begin
    perform public.admin_import_profiles('[{"auth_user_id":"00000000-0000-4000-8000-000000000000","name":"Example","department":"Test","role":"student"}]'::jsonb);
    raise exception 'An unavailable Auth account was incorrectly imported';
  exception when others then if sqlerrm <> 'Account unavailable' then raise; end if; end;
end $$;
reset role;
rollback;
select 'Profile-import access checks passed; test changes rolled back' as result;
