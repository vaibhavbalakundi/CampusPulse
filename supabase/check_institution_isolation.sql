-- Test cross-institution access using fictional accounts. All changes roll back.
begin;
select set_config('sygnetta_test.student',coalesce((select id::text from auth.users where lower(email)='student@sygnetta.example.com'),''),true),
       set_config('sygnetta_test.faculty',coalesce((select id::text from auth.users where lower(email)='faculty@sygnetta.example.com'),''),true),
       set_config('sygnetta_test.admin',coalesce((select id::text from auth.users where lower(email)='admin@sygnetta.example.com'),''),true);
do $$ begin
  if current_setting('sygnetta_test.student')='' or current_setting('sygnetta_test.faculty')='' or current_setting('sygnetta_test.admin')='' then
    raise exception 'Student, faculty and admin test accounts are required';
  end if;
  if not exists (select 1 from public.profiles s join public.profiles f on s.institution_id=f.institution_id
    join public.profiles a on a.institution_id=f.institution_id where s.id=current_setting('sygnetta_test.student')::uuid
    and f.id=current_setting('sygnetta_test.faculty')::uuid and a.id=current_setting('sygnetta_test.admin')::uuid and a.role='admin') then
    raise exception 'The test profiles must start in the same institution, with an administrator';
  end if;
end $$;
with request as (
  insert into public.meeting_requests(institution_id,student_id,faculty_id,reason,preferred_time)
    select institution_id,current_setting('sygnetta_test.student')::uuid,id,'Isolation test','Tomorrow' from public.profiles
    where id=current_setting('sygnetta_test.faculty')::uuid returning id
) select set_config('sygnetta_test.request',id::text,true) from request;
insert into public.notifications(recipient_id,request_id,message)
  values(current_setting('sygnetta_test.student')::uuid,current_setting('sygnetta_test.request')::uuid,'Isolation test');
with campus as (insert into public.institutions(name) values('Temporary isolation test campus') returning id)
  select set_config('sygnetta_test.other_campus',id::text,true) from campus;
update public.profiles set institution_id=current_setting('sygnetta_test.other_campus')::uuid where id=current_setting('sygnetta_test.student')::uuid;

-- The student now belongs to another institution and must not see old data.
select set_config('request.jwt.claim.sub',current_setting('sygnetta_test.student'),true),
       set_config('request.jwt.claims',json_build_object('sub',current_setting('sygnetta_test.student'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.profiles where id=current_setting('sygnetta_test.faculty')::uuid)
     or exists(select 1 from public.availability where faculty_id=current_setting('sygnetta_test.faculty')::uuid)
     or exists(select 1 from public.office_hours where faculty_id=current_setting('sygnetta_test.faculty')::uuid)
     or exists(select 1 from public.scheduled_status where faculty_id=current_setting('sygnetta_test.faculty')::uuid)
     or exists(select 1 from public.meeting_requests where id=current_setting('sygnetta_test.request')::uuid)
     or exists(select 1 from public.notifications where request_id=current_setting('sygnetta_test.request')::uuid) then
    raise exception 'Cross-institution data was visible to the student';
  end if;
  begin
    perform public.create_meeting_request(current_setting('sygnetta_test.faculty')::uuid,'Test','Tomorrow');
    raise exception 'Student was incorrectly allowed to contact another institution';
  exception when others then if sqlerrm <> 'Faculty unavailable' then raise; end if; end;
end $$;
select public.mark_notifications_read();
reset role;
do $$ begin
  if exists(select 1 from public.notifications where request_id=current_setting('sygnetta_test.request')::uuid and read_at is not null) then
    raise exception 'A notification from another institution was changed';
  end if;
end $$;

-- The original institution administrator cannot edit the moved student.
select set_config('request.jwt.claim.sub',current_setting('sygnetta_test.admin'),true),
       set_config('request.jwt.claims',json_build_object('sub',current_setting('sygnetta_test.admin'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.profiles where id=current_setting('sygnetta_test.student')::uuid) then raise exception 'Admin can see another institution profile'; end if;
  begin
    perform public.admin_update_profile(current_setting('sygnetta_test.student')::uuid,'Test','Test','student',true);
    raise exception 'Admin was incorrectly allowed to change another institution profile';
  exception when others then if sqlerrm <> 'Profile unavailable' then raise; end if; end;
end $$;
reset role;
rollback;
select 'Institution-isolation checks passed; test changes rolled back' as result;
