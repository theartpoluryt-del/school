-- Run after accompanist_journal.sql and private staff configuration. Fixtures roll back.
begin;
set local statement_timeout='30s';
do $test$
declare source jsonb; uid uuid; other_uid uuid; admin_uid uuid; outsider_uid uuid;
  employee text; other_employee text; outsider text; pupil_ids jsonb; request jsonb;
  saved jsonb; edited jsonb; result jsonb; lid uuid:=gen_random_uuid();
begin
  select payload into source from public.school_state order by updated_at desc limit 1;
  select p.id,e->>'id' into uid,employee from public.school_profiles p,
    jsonb_array_elements(source->'employees') e,public.school_accompanists a
    where e->>'username'=p.username and a.employee_id=e->>'id' and a.enabled and not p.is_admin limit 1;
  select p.id,e->>'id' into other_uid,other_employee from public.school_profiles p,
    jsonb_array_elements(source->'employees') e,public.school_accompanists a
    where e->>'username'=p.username and a.employee_id=e->>'id' and a.enabled and not p.is_admin and a.employee_id<>employee limit 1;
  select p.id,e->>'id' into outsider_uid,outsider from public.school_profiles p,jsonb_array_elements(source->'employees') e
    where e->>'username'=p.username and not p.is_admin and not exists(select 1 from public.school_accompanists a where a.employee_id=e->>'id' and a.enabled) limit 1;
  select id into admin_uid from public.school_profiles where is_admin limit 1;
  if uid is null or other_uid is null or outsider_uid is null or admin_uid is null then raise exception 'Test actors missing'; end if;
  select jsonb_agg(s->>'id') into pupil_ids from (select s from jsonb_array_elements(source->'students') s limit 2) q;
  perform set_config('request.jwt.claim.sub',uid::text,true);
  if jsonb_array_length(public.get_accompanist_access())<>1 then raise exception 'Own access list mismatch'; end if;
  result:=public.get_accompanist_journal(employee,'2031-01-01');
  if jsonb_array_length(result->'students')<>jsonb_array_length(source->'students') then raise exception 'Not all pupils accessible'; end if;
  if exists(select 1 from jsonb_array_elements(result->'students') s where s ? 'assignedEmployeeIds' or s ? 'grades') then raise exception 'Unnecessary data leaked'; end if;
  request:=jsonb_build_object('id',lid,'employee_id',employee,'lesson_date','2031-01-02','subject','QA joint lesson','hours',1.5,'student_ids',pupil_ids);
  -- Seed one historical manual record as the DB owner; new manual rows are no longer exposed.
  saved:=public.save_accompanist_lesson_manual(request);
  if jsonb_array_length(saved->'students')<>2 or (saved->>'hours')::numeric<>1.5 then raise exception 'Wrong joint lesson workload'; end if;
  if public.save_accompanist_lesson(request)<>saved then raise exception 'Retry is not idempotent'; end if;
  edited:=public.save_accompanist_lesson(request||'{"hours":2}',(saved->>'updated_at')::timestamptz);
  if (edited->>'hours')::numeric<>2 then raise exception 'Edit failed'; end if;
  begin
    perform public.save_accompanist_lesson(request||'{"hours":3}',(saved->>'updated_at')::timestamptz);
    raise exception 'Stale write accepted';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform public.save_accompanist_lesson(request||'{"hours":2.13}',(edited->>'updated_at')::timestamptz);
    raise exception 'Fractional hours accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.save_accompanist_lesson(request||'{"student_ids":["unknown"]}',(edited->>'updated_at')::timestamptz);
    raise exception 'Unknown pupil accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.get_accompanist_journal(other_employee,'2031-01-01');
    raise exception 'Foreign journal readable';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',other_uid::text,true);
  begin
    perform public.save_accompanist_lesson(request||jsonb_build_object('employee_id',other_employee),(edited->>'updated_at')::timestamptz);
    raise exception 'Foreign lesson takeover accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',outsider_uid::text,true);
  if public.get_accompanist_access()<>'[]'::jsonb then raise exception 'Outsider access list'; end if;
  begin
    perform public.get_accompanist_journal(outsider,'2031-01-01');
    raise exception 'Outsider roster accessible';
  exception when insufficient_privilege then null; end;
  begin
    perform public.save_accompanist_lesson(request);
    raise exception 'Outsider write accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.get_accompanist_access();
    raise exception 'Anonymous access accepted';
  exception when insufficient_privilege then null; end;
  if has_table_privilege('authenticated','public.accompanist_lessons','SELECT') or has_table_privilege('authenticated','public.school_accompanists','UPDATE')
    or has_function_privilege('anon','public.get_accompanist_access()','EXECUTE') then raise exception 'Direct access exposed'; end if;
  perform set_config('request.jwt.claim.sub',admin_uid::text,true);
  result:=public.get_accompanist_journal(employee,'2031-01-01');
  if not exists(select 1 from jsonb_array_elements(result->'lessons') l where l->>'id'=lid::text) then raise exception 'Admin read failed'; end if;
  saved:=public.save_accompanist_lesson(request||'{"hours":2,"deleted":true}',(edited->>'updated_at')::timestamptz);
  if public.save_accompanist_lesson(request||'{"hours":2,"deleted":true}',(edited->>'updated_at')::timestamptz)<>saved then raise exception 'Delete retry failed'; end if;
  result:=public.get_accompanist_journal(employee,'2031-01-01');
  if exists(select 1 from jsonb_array_elements(result->'lessons') l where l->>'id'=lid::text) then raise exception 'Deleted hours included'; end if;
  if (select payload from public.school_state order by updated_at desc limit 1)<>source then raise exception 'Main journal changed'; end if;
end $test$;
rollback;
select 'KC security, full roster, save, retry, conflict, half hours, deletion: PASS; all test records rolled back' as result;
