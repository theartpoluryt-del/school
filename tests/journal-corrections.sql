-- Run after journal_corrections.sql. Every test data write is rolled back.
begin;
do $test$
declare
  source jsonb := '{"students":[{"id":"a"},{"id":"b"},{"id":"x"}],"groups":[{"id":"g","studentIds":["a","b"],"assignedEmployeeIds":["t"]}]}';
  incoming jsonb := '{"records":[{"id":"r","employeeId":"t","studentId":"g","date":"2026-09-02","participantIds":["a","b"],"rosterOverride":true,"studentGrades":{"a":"5","b":"4"}}]}';
  prior jsonb;
  removed_source jsonb;
begin
  perform public.validate_school_lesson_members(source, incoming, 't', false);
  prior := source || incoming;
  -- Retain a removed pupil's old grade for recovery without transferring it to anyone else.
  perform public.validate_school_lesson_members(prior, jsonb_set(incoming, '{records,0,participantIds}', '["a"]'), 't', false);
  -- A grade and roster correction can be queued together before the first save.
  perform public.validate_school_lesson_members(source, jsonb_set(incoming, '{records,0,participantIds}', '["a"]'), 't', false);
  removed_source := jsonb_set(jsonb_set(prior, '{records,0,participantIds}', '["a"]'), '{groups,0,studentIds}', '["a"]');
  begin
    perform public.validate_school_lesson_members(source, jsonb_set(incoming, '{records,0,studentGrades,x}', '"5"'), 't', false);
    raise exception 'TEST FAILED: grade for outsider accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.validate_school_lesson_members(removed_source, jsonb_set(jsonb_set(incoming, '{records,0,participantIds}', '["a"]'), '{records,0,studentGrades,b}', '"2"'), 't', false);
    raise exception 'TEST FAILED: changed grade for removed pupil accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.validate_school_lesson_members(source, jsonb_set(incoming, '{records,0,studentGrades,a}', '"6"'), 't', false);
    raise exception 'TEST FAILED: invalid grade accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.validate_school_lesson_members(source, jsonb_set(incoming, '{records,0,studentGrades}', '[]'), 't', false);
    raise exception 'TEST FAILED: array accepted as pupil grades';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.validate_school_lesson_members(source, jsonb_set(incoming, '{records,0,rosterOverride}', '"true"'), 't', false);
    raise exception 'TEST FAILED: invalid override type accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.validate_school_lesson_members(source, incoming #- '{records,0,participantIds}', 't', false);
    raise exception 'TEST FAILED: override without roster accepted';
  exception when invalid_parameter_value then null; end;
end;
$test$;

-- Save/reload through the actual teacher-scoped RPC, with temporary rows only.
do $roundtrip$
declare
  profile_id uuid;
  teacher_id text;
  group_row jsonb;
  context jsonb;
  lesson jsonb;
  journal_record jsonb;
  reloaded jsonb;
  modified jsonb;
begin
  select p.id, e->>'id', g into profile_id, teacher_id, group_row
  from public.school_state ss
  cross join jsonb_array_elements(ss.payload->'employees') e
  join public.school_profiles p on p.username = e->>'username' and not p.is_admin
  cross join jsonb_array_elements(ss.payload->'groups') g
  where coalesce(g->'assignedEmployeeIds', '[]'::jsonb) ? (e->>'id')
    and jsonb_array_length(coalesce(g->'studentIds', '[]'::jsonb)) >= 2 limit 1;
  if profile_id is null then raise exception 'No teacher group with two pupils for rollback test'; end if;
  perform set_config('request.jwt.claim.sub', profile_id::text, true);
  context := public.get_school_context();
  lesson := jsonb_build_object('id', 'qa-journal-correction-row-rollback-only', 'employeeId', teacher_id,
    'studentId', group_row->>'id', 'participantKind', 'group',
    'participantIds', jsonb_build_array(group_row->'studentIds'->0, group_row->'studentIds'->1));
  journal_record := lesson || jsonb_build_object('id', 'qa-journal-correction-record-rollback-only',
    'scheduleId', lesson->>'id', 'date', '2026-09-02', 'time', '10:00-10:40', 'rosterOverride', true,
    'studentGrades', jsonb_build_object(group_row->'studentIds'->>0, '5', group_row->'studentIds'->>1, '4'));
  modified := jsonb_set(context->'payload', '{schedule}', (context->'payload'->'schedule') || jsonb_build_array(lesson));
  modified := jsonb_set(modified, '{records}', (modified->'records') || jsonb_build_array(journal_record));
  perform public.save_school_context(modified, (context->>'updated_at')::timestamptz);
  reloaded := public.get_school_context();
  if not (reloaded->'payload'->'records' @> jsonb_build_array(journal_record)) then
    raise exception 'Dated correction or pupil grades did not survive save/reload';
  end if;
  journal_record := jsonb_set(journal_record, '{participantIds}', jsonb_build_array(group_row->'studentIds'->0));
  select jsonb_agg(case when item->>'id' = journal_record->>'id' then journal_record else item end)
    into modified from jsonb_array_elements(reloaded->'payload'->'records') item;
  perform public.save_school_context(jsonb_set(reloaded->'payload', '{records}', modified), (reloaded->>'updated_at')::timestamptz);
  reloaded := public.get_school_context();
  if not (reloaded->'payload'->'records' @> jsonb_build_array(journal_record)) then
    raise exception 'Smaller corrected roster or retained grades did not survive save/reload';
  end if;
end;
$roundtrip$;
select 'PASS: dated rosters, per-pupil grades, validation and teacher RPC roundtrip; all test writes roll back' as result;
rollback;
