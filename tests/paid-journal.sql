-- Integration tests against the installed schema; all fixture writes roll back.
begin;
do $test$
declare
  user_id uuid; admin_id uuid; employee text; foreign_employee text;
  source jsonb; result jsonb; saved jsonb; edited jsonb; request jsonb;
  course_id uuid := gen_random_uuid();
begin
  select payload into source from public.school_state order by updated_at desc limit 1;
  select p.id,e->>'id' into user_id,employee from public.school_profiles p
    cross join jsonb_array_elements(source->'employees') e
    where not p.is_admin and e->>'username'=p.username limit 1;
  if user_id is null then raise exception 'No teacher profile available for test'; end if;
  select e->>'id' into foreign_employee from jsonb_array_elements(source->'employees') e where e->>'id'<>employee limit 1;
  insert into public.paid_school_courses(id,name,subject,teacher_ids,students,starts_on)
    values(course_id,'QA temporary group','QA',array[employee],'[{"id":"test-a","name":"Test A"},{"id":"test-b","name":"Test B"}]','2026-09-01');
  perform set_config('request.jwt.claim.sub',user_id::text,true);
  result := public.get_paid_journal(employee,'2026-09-01');
  if not exists(select 1 from jsonb_array_elements(result->'courses') c where c->>'id'=course_id::text) then
    raise exception 'TEST FAILED: own course is missing';
  end if;
  begin
    perform public.get_paid_journal(foreign_employee,'2026-09-01');
    raise exception 'TEST FAILED: foreign employee read allowed';
  exception when insufficient_privilege then null; end;
  request := jsonb_build_object('course_id',course_id,'employee_id',employee,'lesson_date','2026-09-02','hours',1.5,
    'students','[{"id":"forged","name":"Forged"}]'::jsonb);
  saved := public.save_paid_lesson(request);
  if saved->'completed'<>'false' or saved->'present_student_ids'<>'[]' or saved->'grades'<>'{}'
    or jsonb_array_length(saved->'students')<>2 or saved->'students' @> '[{"id":"forged"}]' then
    raise exception 'TEST FAILED: defaults or server roster';
  end if;
  edited := public.save_paid_lesson(saved || '{"completed":true,"present_student_ids":["test-a"],"grades":{"test-a":"5"}}', (saved->>'updated_at')::timestamptz);
  if edited->'present_student_ids'<>'["test-a"]' or edited->'grades'<>'{"test-a":"5"}' then
    raise exception 'TEST FAILED: attendance/grade save';
  end if;
  begin
    perform public.save_paid_lesson(saved, (saved->>'updated_at')::timestamptz);
    raise exception 'TEST FAILED: stale write accepted';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform public.save_paid_lesson(edited || jsonb_build_object('employee_id',foreign_employee),(edited->>'updated_at')::timestamptz);
    raise exception 'TEST FAILED: foreign employee write accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.save_paid_lesson(edited || '{"present_student_ids":["outsider"]}',(edited->>'updated_at')::timestamptz);
    raise exception 'TEST FAILED: foreign pupil accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.save_paid_lesson(edited || '{"grades":{"test-a":"6"}}',(edited->>'updated_at')::timestamptz);
    raise exception 'TEST FAILED: invalid grade accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.save_paid_lesson(edited || jsonb_build_object('lesson_date',(now() at time zone 'Asia/Yekaterinburg')::date+1),(edited->>'updated_at')::timestamptz);
    raise exception 'TEST FAILED: future completion accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.save_paid_course('{}');
    raise exception 'TEST FAILED: teacher course management allowed';
  exception when insufficient_privilege then null; end;
  if has_table_privilege('anon','public.paid_school_lessons','SELECT')
    or has_table_privilege('authenticated','public.paid_school_lessons','UPDATE')
    or has_table_privilege('authenticated','public.paid_school_courses','SELECT') then
    raise exception 'TEST FAILED: direct table access allowed';
  end if;
  -- A removed teacher may read their old lessons, not the new teacher's pupils.
  update public.paid_school_courses set teacher_ids=array[foreign_employee],students='[{"id":"new-pupil","name":"New pupil"}]' where id=course_id;
  result := public.get_paid_journal(employee,'2026-09-01');
  if exists(select 1 from jsonb_array_elements(result->'courses') c where c->>'id'=course_id::text
    and (c->'students' @> '[{"id":"new-pupil"}]' or c->'archived'<>'true')) then
    raise exception 'TEST FAILED: historical access leaked the new roster';
  end if;
  saved := public.save_paid_lesson(edited || '{"deleted":true}',(edited->>'updated_at')::timestamptz);
  result := public.get_paid_journal(employee,'2026-09-01');
  if exists(select 1 from jsonb_array_elements(result->'lessons') l where l->>'id'=saved->>'id') then
    raise exception 'TEST FAILED: removed lesson included';
  end if;
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.get_paid_journal(employee,'2026-09-01');
    raise exception 'TEST FAILED: anonymous read allowed';
  exception when insufficient_privilege then null; end;
  select id into admin_id from public.school_profiles where is_admin limit 1;
  if admin_id is null then raise exception 'No administrator for test'; end if;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  saved := public.save_paid_course(jsonb_build_object('name','QA admin course','subject','QA','teacher_ids',jsonb_build_array(employee),
    'students','[{"id":"test-a","name":"Test A"}]'::jsonb,'starts_on','2026-09-01','weekly_hours',2));
  edited := public.save_paid_course(saved || '{"name":"QA changed course"}',(saved->>'updated_at')::timestamptz);
  if edited->>'name'<>'QA changed course' then raise exception 'TEST FAILED: admin course update failed'; end if;
  if source is distinct from (select payload from public.school_state order by updated_at desc limit 1) then
    raise exception 'TEST FAILED: main journal changed';
  end if;
end;
$test$;
rollback;
select 'Paid journal: all server integration checks passed; fixtures rolled back' result;
