-- Synthetic fixtures only. Run after teacher_groups.sql; rolls back all tests.
begin;
do $test$
declare
  source jsonb := '{"students":[{"id":"a","assignedEmployeeIds":["t"]},{"id":"b","assignedEmployeeIds":["other"]}],"groups":[{"id":"imported","name":"Class group","studentIds":["a"],"assignedEmployeeIds":["t"]}]}';
  g jsonb := '{"id":"g","name":"My group","studentIds":["a"],"ownerEmployeeId":"t","assignedEmployeeIds":["t"],"educationForm":"ДПП"}';
  result jsonb;
begin
  result := public.merge_school_teacher_groups(source,jsonb_build_object('groups',jsonb_build_array(g)),'t');
  if jsonb_array_length(result)<>2 then raise exception 'Create failed'; end if;
  if result->0 is distinct from source->'groups'->0 then raise exception 'Imported group changed'; end if;
  source := jsonb_set(source,'{groups}',result);
  if public.merge_school_teacher_groups(source,'{"groups":[]}','t') is distinct from result then
    raise exception 'Omission deleted groups';
  end if;
  begin
    perform public.merge_school_teacher_groups(source,jsonb_build_object('groups',jsonb_build_array(jsonb_set(g,'{studentIds}','["b"]'))),'t');
    raise exception 'Other pupil accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.merge_school_teacher_groups(source,jsonb_build_object('groups',jsonb_build_array(jsonb_set(g,'{ownerEmployeeId}','"other"'))),'t');
    raise exception 'Owner spoof accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.merge_school_teacher_groups(source,jsonb_build_object('groups',jsonb_build_array(jsonb_set(g,'{assignedEmployeeIds}','["t","other"]'))),'t');
    raise exception 'Other teacher accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.merge_school_teacher_groups(source,jsonb_build_object('groups',jsonb_build_array(jsonb_set(g,'{studentIds}','["a","a"]'))),'t');
    raise exception 'Duplicate accepted';
  exception when invalid_parameter_value then null; end;
  result := public.merge_school_teacher_groups(source,jsonb_build_object('groups',jsonb_build_array(g || '{"name":"Updated"}')),'t');
  if result->1->>'name'<>'Updated' then raise exception 'Edit failed'; end if;
end;
$test$;
-- Exercise the real RPC as an existing non-admin teacher. Everything rolls back.
do $rpc$
declare uid uuid; teacher text; pupil text; ctx jsonb; incoming jsonb; original jsonb; after_save jsonb;
  group_id text := 'qa-group-' || gen_random_uuid()::text;
begin
  select p.id,e->>'id',s->>'id' into strict uid,teacher,pupil
  from public.school_state st cross join jsonb_array_elements(st.payload->'employees') e
  join public.school_profiles p on p.username=e->>'username' and not p.is_admin
  cross join jsonb_array_elements(st.payload->'students') s
  where s->'assignedEmployeeIds' ? (e->>'id') and coalesce(s->>'isArchived','false')<>'true' limit 1;
  select payload into original from public.school_state order by updated_at desc limit 1;
  perform set_config('request.jwt.claim.sub',uid::text,true);
  ctx := public.get_school_context();
  if ctx->'payload'->'teacherGroupsEnabled' is distinct from 'true'::jsonb then raise exception 'Feature not enabled'; end if;
  incoming := jsonb_set(ctx->'payload','{groups}',coalesce(ctx->'payload'->'groups','[]') || jsonb_build_array(
    jsonb_build_object('id',group_id,'name','QA group','studentIds',jsonb_build_array(pupil),
      'ownerEmployeeId',teacher,'assignedEmployeeIds',jsonb_build_array(teacher),'educationForm','ДПП')));
  perform public.save_school_context(incoming,(ctx->>'updated_at')::timestamptz);
  ctx := public.get_school_context();
  if not exists(select 1 from jsonb_array_elements(ctx->'payload'->'groups') g where g->>'id'=group_id) then
    raise exception 'RPC did not persist teacher group'; end if;
  select payload into after_save from public.school_state order by updated_at desc limit 1;
  if (original - 'groups' - 'schedule' - 'records' - 'scheduleArchives') is distinct from
    (after_save - 'groups' - 'schedule' - 'records' - 'scheduleArchives') then raise exception 'Other state changed'; end if;
  if exists(select 1 from jsonb_array_elements(original->'records') r where not (after_save->'records' @> jsonb_build_array(r))) then
    raise exception 'Grades changed'; end if;
  incoming := jsonb_set(ctx->'payload','{schedule}',coalesce(ctx->'payload'->'schedule','[]') || jsonb_build_array(
    jsonb_build_object('id',group_id||'-lesson','studentId',group_id,'employeeId',teacher,
      'participantIds',jsonb_build_array(pupil),'weekday',1,'time','10:00-10:40','pedHours',1,'kcHours',0)));
  perform public.save_school_context(incoming,(ctx->>'updated_at')::timestamptz);
  ctx := public.get_school_context();
  if not exists(select 1 from jsonb_array_elements(ctx->'payload'->'schedule') r where r->>'id'=group_id||'-lesson') then
    raise exception 'New group not usable in timetable'; end if;
end;
$rpc$;
rollback;
select 'PASS: own groups, roster validation, ownership, imported groups and omission safety' as result;
