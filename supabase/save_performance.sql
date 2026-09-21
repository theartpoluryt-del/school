-- After teacher_groups.sql. Same authorization and validation, indexed lookups.
-- No school data, privileges or function signatures change.
begin;
set local lock_timeout='3s';
do $migration$
declare definition text; old_fragment text; new_fragment text;
begin
  definition := pg_get_functiondef('public.save_school_context(jsonb,timestamptz)'::regprocedure);
  if strpos(definition, 'allowed_participant_ids')=0 then
    old_fragment := '  next_updated_at timestamptz;';
    if strpos(definition,old_fragment)=0 then raise exception 'Unknown save declaration'; end if;
    definition := replace(definition,old_fragment,old_fragment || E'\n  allowed_participant_ids text[];');
    old_fragment := '  perform public.validate_school_lesson_members';
    if strpos(definition,old_fragment)=0 then raise exception 'Unknown validation call'; end if;
    definition := replace(definition,old_fragment,$new$
  select coalesce(array_agg(p->>'id'),array[]::text[]) into allowed_participant_ids
  from (
    select value p from jsonb_array_elements(coalesce(state_row.payload->'students','[]'::jsonb))
    union all
    select value p from jsonb_array_elements(coalesce(state_row.payload->'groups','[]'::jsonb))
  ) participants where coalesce(p->'assignedEmployeeIds','[]'::jsonb) ? employee_id;
  perform public.validate_school_lesson_members$new$);
    old_fragment := 'public.is_school_participant_assigned(state_row.payload, employee_id, item->>''studentId'')';
    if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment) <> 2 then
      raise exception 'Unknown participant authorization checks';
    end if;
    definition := replace(definition,old_fragment,'(item->>''studentId'') = any(allowed_participant_ids)');
    execute definition;
  end if;

  definition := pg_get_functiondef('public.validate_school_lesson_members(jsonb,jsonb,text,boolean)'::regprocedure);
  if strpos(definition,'prior_by_key')=0 then
    old_fragment := '  collection text;';
    if strpos(definition,old_fragment)=0 then raise exception 'Unknown validator declaration'; end if;
    definition := replace(definition,old_fragment,old_fragment || E'\n  prior_by_key jsonb;\n  schedule_by_key jsonb;\n  groups_by_id jsonb;');
    old_fragment := '  foreach collection in array array[''schedule'', ''records''] loop';
    if strpos(definition,old_fragment)=0 then raise exception 'Unknown validator loop'; end if;
    definition := replace(definition,old_fragment,$new$
  select coalesce(jsonb_object_agg(jsonb_build_array(value->>'id',value->>'employeeId',value->>'studentId')::text,value order by ord desc),'{}'::jsonb)
    into schedule_by_key from jsonb_array_elements(coalesce(source->'schedule','[]'::jsonb)) with ordinality a(value,ord);
  select coalesce(jsonb_object_agg(value->>'id',value order by ord desc),'{}'::jsonb)
    into groups_by_id from jsonb_array_elements(coalesce(roster_source->'groups','[]'::jsonb)) with ordinality a(value,ord)
    where value->>'id' is not null;
  foreach collection in array array['schedule', 'records'] loop
    select coalesce(jsonb_object_agg(jsonb_build_array(value->>'id',value->>'employeeId',value->>'studentId')::text,value order by ord desc),'{}'::jsonb)
      into prior_by_key from jsonb_array_elements(coalesce(source->collection,'[]'::jsonb)) with ordinality a(value,ord);
$new$);
    old_fragment := $old$      select value into prior from jsonb_array_elements(coalesce(source->collection, '[]'::jsonb))
        where value->>'id' = lesson->>'id' and value->>'employeeId' = lesson->>'employeeId'
          and value->>'studentId' = lesson->>'studentId' limit 1;
      select value into prior_schedule from jsonb_array_elements(coalesce(source->'schedule', '[]'::jsonb))
        where collection = 'records' and value->>'id' = lesson->>'scheduleId'
          and value->>'employeeId' = lesson->>'employeeId' and value->>'studentId' = lesson->>'studentId' limit 1;
      select value into group_row from jsonb_array_elements(coalesce(roster_source->'groups', '[]'::jsonb))
        where value->>'id' = lesson->>'studentId' limit 1;$old$;
    new_fragment := $new$      prior := case when lesson->>'id' is not null and lesson->>'employeeId' is not null and lesson->>'studentId' is not null
        then prior_by_key->(jsonb_build_array(lesson->>'id',lesson->>'employeeId',lesson->>'studentId')::text) end;
      prior_schedule := case when collection='records' and lesson->>'scheduleId' is not null and lesson->>'employeeId' is not null and lesson->>'studentId' is not null
        then schedule_by_key->(jsonb_build_array(lesson->>'scheduleId',lesson->>'employeeId',lesson->>'studentId')::text) end;
      group_row := groups_by_id->(lesson->>'studentId');$new$;
    if strpos(definition,old_fragment)=0 then raise exception 'Unknown prior lesson lookups'; end if;
    definition := replace(definition,old_fragment,new_fragment);
    execute definition;
  end if;
end;
$migration$;
commit;
