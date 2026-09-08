-- Apply after schema.sql. Does not rewrite school data.
-- Expand only the roster of a teacher's own groups; validate new lesson fields.
begin;

create or replace function public.school_teacher_students(source jsonb, teacher_id text)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(case
    when coalesce(s->'assignedEmployeeIds', '[]'::jsonb) ? teacher_id then s
    else jsonb_build_object('id', s->'id', 'name', s->'name',
      'className', s->'className', 'educationForm', s->'educationForm',
      'isArchived', coalesce(s->'isArchived', 'false'::jsonb),
      'assignedEmployeeIds', '[]'::jsonb, 'enrollments', '[]'::jsonb)
    end), '[]'::jsonb)
  from jsonb_array_elements(coalesce(source->'students', '[]'::jsonb)) s
  where coalesce(s->'assignedEmployeeIds', '[]'::jsonb) ? teacher_id
    or exists (
      select 1 from jsonb_array_elements(coalesce(source->'groups', '[]'::jsonb)) g
      where coalesce(g->'assignedEmployeeIds', '[]'::jsonb) ? teacher_id
        and coalesce(g->'studentIds', '[]'::jsonb) ? (s->>'id')
    );
$$;

create or replace function public.validate_school_lesson_members(
  source jsonb, incoming jsonb, teacher_id text, admin_access boolean
) returns void language plpgsql set search_path = public, pg_temp as $$
declare
  collection text;
  lesson jsonb;
  prior jsonb;
  prior_schedule jsonb;
  member jsonb;
  group_row jsonb;
  roster_source jsonb := case when admin_access then incoming else source end;
begin
  foreach collection in array array['schedule', 'records'] loop
    for lesson in select value from jsonb_array_elements(coalesce(incoming->collection, '[]'::jsonb)) loop
      if not admin_access and lesson->>'employeeId' is distinct from teacher_id then continue; end if;
      if not (lesson ? 'participantIds') then
        if lesson ? 'presentStudentIds' then
          raise exception 'Attendance requires a lesson roster' using errcode = '22023';
        end if;
        continue;
      end if;
      if jsonb_typeof(lesson->'participantIds') is distinct from 'array' then
        raise exception 'Invalid lesson roster' using errcode = '22023';
      end if;
      if (select count(*) <> count(distinct value) from jsonb_array_elements(lesson->'participantIds')) then
        raise exception 'Duplicate lesson members' using errcode = '22023';
      end if;
      select value into prior from jsonb_array_elements(coalesce(source->collection, '[]'::jsonb))
        where value->>'id' = lesson->>'id' and value->>'employeeId' = lesson->>'employeeId'
          and value->>'studentId' = lesson->>'studentId' limit 1;
      select value into prior_schedule from jsonb_array_elements(coalesce(source->'schedule', '[]'::jsonb))
        where collection = 'records' and value->>'id' = lesson->>'scheduleId'
          and value->>'employeeId' = lesson->>'employeeId' and value->>'studentId' = lesson->>'studentId' limit 1;
      select value into group_row from jsonb_array_elements(coalesce(roster_source->'groups', '[]'::jsonb))
        where value->>'id' = lesson->>'studentId' limit 1;
      for member in select value from jsonb_array_elements(lesson->'participantIds') loop
        if jsonb_typeof(member) <> 'string' or member = '""'::jsonb then
          raise exception 'Invalid lesson member ID' using errcode = '22023';
        end if;
        -- Historical snapshots may retain pupils who subsequently left a group.
        if coalesce(prior->'participantIds', '[]'::jsonb) @> jsonb_build_array(member)
          or coalesce(prior_schedule->'participantIds', '[]'::jsonb) @> jsonb_build_array(member) then continue; end if;
        if not exists (
          select 1 from jsonb_array_elements(coalesce(roster_source->'students', '[]'::jsonb)) s
          where s->'id' = member and (
            (group_row is null and s->>'id' = lesson->>'studentId')
            or (group_row is not null and (admin_access
              or coalesce(group_row->'studentIds', '[]'::jsonb) @> jsonb_build_array(member)
              or coalesce(s->'assignedEmployeeIds', '[]'::jsonb) ? teacher_id))
          )
        ) then raise exception 'Pupil is not available for this lesson' using errcode = '42501'; end if;
      end loop;
      if lesson ? 'presentStudentIds' then
        if jsonb_typeof(lesson->'presentStudentIds') is distinct from 'array' then
          raise exception 'Invalid attendance' using errcode = '22023';
        end if;
        if not ((lesson->'participantIds') @> (lesson->'presentStudentIds'))
          or (select count(*) <> count(distinct value) from jsonb_array_elements(lesson->'presentStudentIds')) then
          raise exception 'Attendance must be a subset of the lesson roster' using errcode = '22023';
        end if;
      end if;
      if lesson ? 'attendanceLessonHours' then
        if jsonb_typeof(lesson->'attendanceLessonHours') is distinct from 'number' then
          raise exception 'Invalid attendance hours' using errcode = '22023';
        end if;
        if (lesson->>'attendanceLessonHours')::numeric < 0 or (lesson->>'attendanceLessonHours')::numeric > 36 then
          raise exception 'Invalid attendance hours' using errcode = '22023';
        end if;
      end if;
    end loop;
  end loop;
end;
$$;

revoke all on function public.school_teacher_students(jsonb, text) from public, anon, authenticated;
revoke all on function public.validate_school_lesson_members(jsonb, jsonb, text, boolean) from public, anon, authenticated;

-- Guarded, idempotent changes preserve other deployed authentication logic.
do $migration$
declare
  definition text;
  old_fragment text := $old$'students', coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(clean_payload->'students', '[]'::jsonb)) item where coalesce(item->'assignedEmployeeIds', '[]'::jsonb) ? employee_id), '[]'::jsonb)$old$;
  new_fragment text := $new$'students', public.school_teacher_students(clean_payload, employee_id)$new$;
  save_marker text := '  if public.is_school_admin() then';
begin
  definition := pg_get_functiondef('public.get_school_context()'::regprocedure);
  if strpos(definition, new_fragment) = 0 then
    if strpos(definition, old_fragment) = 0 then raise exception 'Unrecognized get_school_context; inspect before applying'; end if;
    execute replace(definition, old_fragment, new_fragment);
  end if;
  definition := pg_get_functiondef('public.save_school_context(jsonb,timestamptz)'::regprocedure);
  if strpos(definition, 'perform public.validate_school_lesson_members') = 0 then
    if strpos(definition, save_marker) = 0 then raise exception 'Unrecognized save_school_context; inspect before applying'; end if;
    execute replace(definition, save_marker,
      E'  perform public.validate_school_lesson_members(state_row.payload, clean_payload, employee_id, public.is_school_admin());\n\n' || save_marker);
  end if;
end;
$migration$;
commit;
