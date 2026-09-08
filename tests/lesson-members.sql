-- Run after lesson_members.sql. All temporary test writes are rolled back.
begin;
do $test$
declare
  source jsonb := '{"students":[{"id":"a","name":"A","assignedEmployeeIds":["t"],"private":"own"},{"id":"b","name":"B","private":"hidden"},{"id":"x","name":"X"}],"groups":[{"id":"g","studentIds":["b"],"assignedEmployeeIds":["t"]}]}';
  incoming jsonb := '{"schedule":[{"id":"r","employeeId":"t","studentId":"g","participantIds":["a","b"]}]}';
  visible jsonb;
begin
  visible := public.school_teacher_students(source, 't');
  if jsonb_array_length(visible) <> 2 or visible @> '[{"id":"x"}]' or visible @> '[{"id":"b","private":"hidden"}]' then
    raise exception 'Roster visibility leaked unrelated pupil data';
  end if;
  perform public.validate_school_lesson_members(source, incoming, 't', false);
  begin
    perform public.validate_school_lesson_members(source, jsonb_set(incoming, '{schedule,0,participantIds}', '["x"]'), 't', false);
    raise exception 'TEST FAILED: foreign pupil accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.validate_school_lesson_members(source, jsonb_set(incoming, '{schedule,0,presentStudentIds}', '["x"]'), 't', false);
    raise exception 'TEST FAILED: attendance outside roster accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.validate_school_lesson_members(source, jsonb_set(incoming, '{schedule,0,participantIds}', '["a","a"]'), 't', false);
    raise exception 'TEST FAILED: duplicate pupils accepted';
  exception when invalid_parameter_value then null; end;
  perform public.validate_school_lesson_members(source, jsonb_set(incoming, '{schedule,0,presentStudentIds}', '[]'), 't', false);
  perform public.validate_school_lesson_members(source || incoming, incoming, 't', false);
end;
$test$;

-- Real RPC save/reload under a teacher identity; final ROLLBACK removes test row.
do $roundtrip$
declare
  profile_id uuid;
  teacher_id text;
  group_row jsonb;
  context jsonb;
  lesson jsonb;
  reloaded jsonb;
begin
  select p.id, e->>'id', g into profile_id, teacher_id, group_row
  from public.school_state ss
  cross join jsonb_array_elements(ss.payload->'employees') e
  join public.school_profiles p on p.username = e->>'username' and not p.is_admin
  cross join jsonb_array_elements(ss.payload->'groups') g
  where coalesce(g->'assignedEmployeeIds', '[]'::jsonb) ? (e->>'id')
    and jsonb_array_length(coalesce(g->'studentIds', '[]'::jsonb)) > 0 limit 1;
  if profile_id is null then raise exception 'No teacher group available for rollback test'; end if;
  perform set_config('request.jwt.claim.sub', profile_id::text, true);
  context := public.get_school_context();
  if not exists (select 1 from jsonb_array_elements(context->'payload'->'students') s where s->'id' = group_row->'studentIds'->0) then
    raise exception 'Group pupil missing from teacher context';
  end if;
  lesson := jsonb_build_object('id', 'qa-lesson-members-rollback-only', 'employeeId', teacher_id,
    'studentId', group_row->>'id', 'participantKind', 'group',
    'participantIds', jsonb_build_array(group_row->'studentIds'->0),
    'presentStudentIds', jsonb_build_array(group_row->'studentIds'->0), 'attendanceLessonHours', 1);
  perform public.save_school_context(jsonb_set(context->'payload', '{schedule}',
    (context->'payload'->'schedule') || jsonb_build_array(lesson)), (context->>'updated_at')::timestamptz);
  reloaded := public.get_school_context();
  if not (reloaded->'payload'->'schedule' @> jsonb_build_array(lesson)) then
    raise exception 'Roster did not survive save/reload';
  end if;
end;
$roundtrip$;
select 'PASS: visibility, validation and teacher RPC save/reload; test transaction will roll back' as result;
rollback;
