-- Real RPC authorization test, with synthetic lessons. No changes survive rollback.
begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
do $test$
declare actors jsonb; teacher text; substitute text; outsider text; uid uuid; ctx jsonb; args jsonb;
  a uuid; lesson text; pupil text; result jsonb; original jsonb;
begin
 select jsonb_agg(x) into actors from (select jsonb_build_object('uid',p.id,'employee',e->>'id') x
 from public.school_state st,jsonb_array_elements(st.payload->'employees') e
 join public.school_profiles p on p.username=e->>'username' and not p.is_admin limit 3) q;
 if jsonb_array_length(actors)<>3 then raise exception 'Need three teachers'; end if;
 teacher:=actors->0->>'employee';substitute:=actors->1->>'employee';outsider:=actors->2->>'employee';
 select payload into original from public.school_state order by updated_at desc limit 1;
 select s->>'id' into pupil from jsonb_array_elements(original->'students') s
 where s->'assignedEmployeeIds' ? teacher limit 1;
 if pupil is null then raise exception 'Need assigned pupil'; end if;
 update public.school_state set payload=payload||jsonb_build_object('holidays','[]'::jsonb,'records','[]'::jsonb,
 'schedule',jsonb_build_array(jsonb_build_object('id','qa-absence-row','employeeId',teacher,'studentId',pupil,
 'participantKind','student','participantIds',jsonb_build_array(pupil),'weekday',1,'time','10:00-10:40',
 'effectiveFrom','2030-01-01','effectiveTo','2030-01-31','type','Специальность','pedHours',1,'kcHours',0)));
 perform set_config('request.jwt.claim.sub',actors->0->>'uid',true);
 ctx:=public.get_school_context();
 if ctx->'payload'->'absencesEnabled' is distinct from 'true'::jsonb then raise exception 'Feature unavailable'; end if;
 args:=jsonb_build_object('employeeId',teacher,'substituteId',substitute,'from','2030-01-07','to','2030-01-07',
 'expectedVersion',ctx->>'updated_at','reason','Больничный');
 begin
  perform public.school_absence_action('create',args||jsonb_build_object('employeeId',outsider));
  raise exception 'Other teacher absence accepted';
 exception when insufficient_privilege then null; end;
 ctx:=public.school_absence_action('create',args);
 select id,lessons->0->>'id' into strict a,lesson from public.school_absences
 where source_employee=teacher and starts_on='2030-01-07' and not cancelled;
 if (select jsonb_array_length(lessons)<>1 from public.school_absences where id=a) then raise exception 'Wrong occurrence count'; end if;
 begin
  perform public.school_absence_action('grade',jsonb_build_object('absenceId',a,'lessonId',lesson,'pupilId',pupil,'grade','5'));
  raise exception 'Source can edit substitute grade';
 exception when insufficient_privilege then null; end;
 begin
  perform public.school_absence_action('create',args||jsonb_build_object('expectedVersion',ctx->>'updated_at'));
  raise exception 'Overlapping absence accepted';
 exception when invalid_parameter_value then null; end;
 perform set_config('request.jwt.claim.sub',actors->2->>'uid',true);
 ctx:=public.get_school_context();
 if exists(select 1 from jsonb_array_elements(ctx->'payload'->'absenceRows') x where x->>'id'=a::text) then raise exception 'Unrelated teacher sees absence'; end if;
 begin
  perform public.school_absence_action('cancel',jsonb_build_object('absenceId',a));
  raise exception 'Outsider can cancel absence';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',actors->1->>'uid',true);
 ctx:=public.get_school_context();
 select x into strict result from jsonb_array_elements(ctx->'payload'->'absenceRows') x where x->>'id'=a::text;
 if result->>'reason'<>'Замещение' then raise exception 'Medical reason exposed'; end if;
 begin
  perform public.school_absence_action('create',jsonb_build_object('employeeId',substitute,'from','2030-01-07','to','2030-01-07','expectedVersion',ctx->>'updated_at'));
  raise exception 'Substitute may go absent without reassignment';
 exception when invalid_parameter_value then null; end;
 ctx:=public.school_absence_action('grade',jsonb_build_object('absenceId',a,'lessonId',lesson,'pupilId',pupil,'grade','5'));
 if not exists(select 1 from jsonb_array_elements(ctx->'payload'->'absenceRows') x where x->>'id'=a::text and x->'lessons'->0->>'grade'='5') then raise exception 'Grade response is stale'; end if;
 begin
  perform public.school_absence_action('grade',jsonb_build_object('absenceId',a,'lessonId',lesson,'pupilId','outsider','grade','5'));
  raise exception 'Outsider pupil accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.school_absence_action('topic',jsonb_build_object('absenceId',a,'lessonId',lesson,'topic','QA'));
  raise exception 'Individual topic accepted';
 exception when invalid_parameter_value then null; end;
 perform set_config('request.jwt.claim.sub',actors->0->>'uid',true);
 perform public.school_absence_action('cancel',jsonb_build_object('absenceId',a));
 if not exists(select 1 from public.school_absences where id=a and cancelled and lessons->0->>'grade'='5') then raise exception 'Cancellation lost audit'; end if;
 -- A regular lesson of the substitute must block a conflicting assignment.
 update public.school_state set payload=jsonb_set(payload,'{schedule}',(payload->'schedule')||jsonb_build_array(
  (payload->'schedule'->0)||jsonb_build_object('id','qa-conflict','employeeId',substitute)));
 ctx:=public.get_school_context();
 begin
  perform public.school_absence_action('create',args||jsonb_build_object('expectedVersion',ctx->>'updated_at'));
  raise exception 'Timetable collision accepted';
 exception when invalid_parameter_value then null; end;
 -- No substitute is also valid: original hours are simply excluded.
 ctx:=public.school_absence_action('create',args||jsonb_build_object('expectedVersion',ctx->>'updated_at','substituteId',''));
 if not exists(select 1 from jsonb_array_elements(ctx->'payload'->'absenceRows') x where x->>'source_employee'=teacher
  and x->>'starts_on'='2030-01-07' and x->>'cancelled'='false' and x->>'substitute_employee' is null) then raise exception 'No-substitute absence failed'; end if;
 if public.strip_school_secrets('{"employees":[],"absenceRows":[1],"absencesEnabled":true,"substituteTeachers":[1]}') ? 'absenceRows' then raise exception 'Metadata not stripped'; end if;
end;
$test$;
select 'PASS: own absence, scoped access, hidden reason, grades, cancellation, no data retained' as result;
rollback;
