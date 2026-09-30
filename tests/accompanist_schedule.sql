-- All fixtures roll back; no staff timetables or journals are changed by this test.
begin;
set local statement_timeout='30s';
do $test$
declare source jsonb; school jsonb; uid uuid; employee text; other_employee text; admin_uid uuid; admin_employee text;
 pupil_ids jsonb; roster jsonb; row1 jsonb; row2 jsonb; result jsonb; item jsonb; request jsonb; saved jsonb; edited jsonb; absence_id uuid:=gen_random_uuid();
begin
 select payload into source from public.school_state order by updated_at desc limit 1;
 select p.id,e->>'id' into uid,employee from public.school_profiles p,jsonb_array_elements(source->'employees') e,public.school_accompanists a
 where e->>'username'=p.username and a.employee_id=e->>'id' and a.enabled and not p.is_admin limit 1;
 select a.employee_id into other_employee from public.school_accompanists a where a.enabled and a.employee_id<>employee limit 1;
 select p.id,e->>'id' into admin_uid,admin_employee from public.school_profiles p,jsonb_array_elements(source->'employees') e where p.is_admin and e->>'username'=p.username limit 1;
 if uid is null or admin_uid is null then raise exception 'Actors missing'; end if;
 select jsonb_agg(s->>'id'),jsonb_agg(s) into pupil_ids,roster from (select s from jsonb_array_elements(source->'students') s limit 2) q;
 row1:=jsonb_build_object('id','qa-kc-old','employeeId',employee,'studentId','qa-group','participantIds',pupil_ids,
 'weekday',2,'type','Концертмейстер','time','09:00-10:25','pedHours',2.13,'kcHours',0,'effectiveFrom','2031-01-01','effectiveTo','2031-01-14','archiveId','qa-archive');
 row2:=row1||jsonb_build_object('id','qa-kc-new','time','09:00-10:00','effectiveFrom','2031-01-15','effectiveTo','','archiveId','');
 school:=source||jsonb_build_object('schedule',jsonb_build_array(row1,row2,row2||jsonb_build_object('id','qa-teaching','type','Сольфеджио')),
 'records','[]'::jsonb,'holidays',jsonb_build_array(jsonb_build_object('date','2031-01-07')));
 update public.school_state set payload=school;
 perform set_config('request.jwt.claim.sub',uid::text,true);
 result:=public.get_accompanist_journal(employee,'2031-01-01');
 if jsonb_array_length(result->'lessons')<>3 then raise exception 'Expected Tuesdays 14,21,28, no holiday or teaching rows: %',result->'lessons'; end if;
 if (select sum((x->>'hours')::numeric) from jsonb_array_elements(result->'lessons') x)<>5 then raise exception 'Round each lesson, count joint roster once'; end if;
 if exists(select 1 from jsonb_array_elements(result->'lessons') x where jsonb_array_length(x->'students')<>2) then raise exception 'Roster not inherited'; end if;
 select x into item from jsonb_array_elements(result->'lessons') x where x->>'lesson_date'='2031-01-21';
 if public.get_accompanist_journal(employee,'2031-01-01')<>result then raise exception 'Read created duplicates or unstable ids'; end if;
 request:=item||jsonb_build_object('student_ids',pupil_ids,'hours',2);
 -- Forged form fields must not replace the canonical timetable roster or subject.
 saved:=public.save_accompanist_lesson(request||'{"subject":"Forged","student_ids":["unknown"]}');
 if saved->'students'<>item->'students' or saved->>'subject'<>item->>'subject' then raise exception 'Canonical source mutable'; end if;
 if public.save_accompanist_lesson(request)<>saved then raise exception 'Lost response retry not idempotent'; end if;
 edited:=public.save_accompanist_lesson(request||'{"hours":2.5}',(saved->>'updated_at')::timestamptz);
 begin
  perform public.save_accompanist_lesson(request||'{"hours":3}',(saved->>'updated_at')::timestamptz);
  raise exception 'Stale correction accepted';
 exception when sqlstate 'PT409' then null; end;
 begin
  perform public.save_accompanist_lesson(request||jsonb_build_object('employee_id',other_employee));
  raise exception 'Foreign journal accepted';
 exception when insufficient_privilege then null; end;
 begin
  perform public.save_accompanist_lesson(request||'{"source_key":null}',(edited->>'updated_at')::timestamptz);
  raise exception 'Source stripped';
 exception when invalid_parameter_value then null; end;
 school:=jsonb_set(school,'{schedule,1,time}','"09:00-10:40"');update public.school_state set payload=school;
 begin
  perform public.save_accompanist_lesson(request||'{"hours":3}',(edited->>'updated_at')::timestamptz);
  raise exception 'Stale timetable source accepted';
 exception when sqlstate 'PT409' then null; end;
 result:=public.get_accompanist_journal(employee,'2031-01-01');
 select x into item from jsonb_array_elements(result->'lessons') x where x->>'lesson_date'='2031-01-21';
 if (item->>'hours')::numeric<>2.5 then raise exception 'Timetable edit not reflected'; end if;
 request:=item||jsonb_build_object('student_ids',pupil_ids,'deleted',true);
 saved:=public.save_accompanist_lesson(request,(item->>'updated_at')::timestamptz);
 if public.save_accompanist_lesson(request,(item->>'updated_at')::timestamptz)<>saved then raise exception 'Cancellation retry not idempotent'; end if;
 if jsonb_array_length(public.get_accompanist_journal(employee,'2031-01-01')->'lessons')<>2 then raise exception 'Cancelled source recreated'; end if;
 insert into public.school_absences(id,source_employee,substitute_employee,starts_on,ends_on,created_by,lessons)
 values(absence_id,employee,other_employee,'2031-01-28','2031-01-28',uid,jsonb_build_array(row2||jsonb_build_object('id','qa-sub','date','2031-01-28')));
 if jsonb_array_length(public.get_accompanist_journal(employee,'2031-01-01')->'lessons')<>1 then raise exception 'Absent source hours counted'; end if;
 perform set_config('request.jwt.claim.sub',admin_uid::text,true);
 result:=public.get_accompanist_journal(other_employee,'2031-01-01');
 if jsonb_array_length(result->'lessons')<>1 then raise exception 'KC substitution not counted once'; end if;
 if not exists(select 1 from jsonb_array_elements(public.get_accompanist_access()) x where x->>'id'=admin_employee) then raise exception 'Admin has no own KC journal'; end if;
 perform public.get_accompanist_journal(admin_employee,'2031-01-01');
 if has_function_privilege('authenticated','public.accompanist_schedule_rows(jsonb,text,date)','EXECUTE')
 or has_function_privilege('authenticated','public.save_accompanist_lesson_manual(jsonb,timestamptz)','EXECUTE') then raise exception 'Internal helper exposed'; end if;
end $test$;
rollback;
select 'PASS: timetable dates, archives, roster, half-hour rounding, retries, corrections, cancellation, absences, substitution and admin own journal; fixtures rolled back' result;
