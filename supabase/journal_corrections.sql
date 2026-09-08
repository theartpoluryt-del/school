-- Existing deployments: apply after lesson_members.sql. Updates validation only; no pupil data is rewritten.
begin;

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
  pupil_grade record;
  roster_source jsonb := case when admin_access then incoming else source end;
begin
  foreach collection in array array['schedule', 'records'] loop
    for lesson in select value from jsonb_array_elements(coalesce(incoming->collection, '[]'::jsonb)) loop
      if not admin_access and lesson->>'employeeId' is distinct from teacher_id then continue; end if;
      if lesson ? 'rosterOverride' then
        if collection <> 'records' or jsonb_typeof(lesson->'rosterOverride') is distinct from 'boolean'
          or not (lesson ? 'participantIds') then
          raise exception 'Invalid dated lesson roster override' using errcode = '22023';
        end if;
      end if;
      if lesson ? 'studentGrades' then
        if collection <> 'records' or jsonb_typeof(lesson->'studentGrades') is distinct from 'object'
          or not (lesson ? 'participantIds') then
          raise exception 'Pupil grades require a lesson roster and object' using errcode = '22023';
        end if;
      end if;
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
      if lesson ? 'studentGrades' then
        for pupil_grade in select key, value from jsonb_each(lesson->'studentGrades') loop
          if pupil_grade.key = '' or jsonb_typeof(pupil_grade.value) is distinct from 'string'
            or (pupil_grade.value #>> '{}') not in ('', '2-', '2', '2+', '3-', '3', '3+', '4-', '4', '4+', '5-', '5', '5+') then
            raise exception 'Invalid pupil grade' using errcode = '22023';
          end if;
          -- A pupil may be graded and removed in one debounced save. Keep grades for
          -- this lesson's prior roster or pupils available to the teacher's group.
          if not ((lesson->'participantIds') ? pupil_grade.key) and not (
            coalesce((prior->'studentGrades') ? pupil_grade.key, false)
            and (prior->'studentGrades'->pupil_grade.key) = pupil_grade.value
          ) and not (coalesce(prior->'participantIds', '[]'::jsonb) ? pupil_grade.key)
          and not (coalesce(prior_schedule->'participantIds', '[]'::jsonb) ? pupil_grade.key)
          and not exists (
            select 1 from jsonb_array_elements(coalesce(roster_source->'students', '[]'::jsonb)) s
            where s->>'id' = pupil_grade.key and (
              (group_row is null and s->>'id' = lesson->>'studentId')
              or (group_row is not null and (admin_access
                or coalesce(group_row->'studentIds', '[]'::jsonb) ? pupil_grade.key
                or coalesce(s->'assignedEmployeeIds', '[]'::jsonb) ? teacher_id))
            )
          ) then
            raise exception 'Pupil grade is outside this lesson roster' using errcode = '42501';
          end if;
        end loop;
      end if;
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

revoke all on function public.validate_school_lesson_members(jsonb, jsonb, text, boolean) from public, anon, authenticated;
commit;
