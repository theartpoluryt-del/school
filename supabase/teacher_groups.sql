-- Apply after lesson_members.sql and journal_corrections.sql.
-- Merge teacher-owned teaching groups before validating/saving lessons.
begin;
create or replace function public.merge_school_teacher_groups(source jsonb, incoming jsonb, teacher_id text)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare
  result jsonb := coalesce(source->'groups','[]'::jsonb);
  g jsonb; prior jsonb; member jsonb; normalized jsonb;
begin
  if jsonb_typeof(incoming->'groups') is distinct from 'array' then
    raise exception 'Groups must be an array' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(incoming->'groups') x
    group by x->>'id' having count(*) > 1) then
    raise exception 'Duplicate group IDs' using errcode='22023';
  end if;
  for g in select value from jsonb_array_elements(incoming->'groups') loop
    select value into prior from jsonb_array_elements(result) where value->>'id'=g->>'id';
    -- Imported/admin/shared groups are never writable through this path.
    if prior is not null and (prior->>'ownerEmployeeId' is distinct from teacher_id
      or prior->'assignedEmployeeIds' is distinct from jsonb_build_array(teacher_id)
      or prior->>'isArchived'='true') then continue; end if;
    if jsonb_typeof(g->'id') is distinct from 'string' or coalesce(g->>'id','')=''
      or g->>'ownerEmployeeId' is distinct from teacher_id
      or g->'assignedEmployeeIds' is distinct from jsonb_build_array(teacher_id) then
      raise exception 'Group ownership cannot be changed' using errcode='42501';
    end if;
    if exists(select 1 from jsonb_array_elements(coalesce(source->'students','[]'::jsonb)) s where s->>'id'=g->>'id') then
      raise exception 'Group ID conflicts with pupil' using errcode='22023';
    end if;
    if jsonb_typeof(g->'name') is distinct from 'string' or length(btrim(g->>'name')) not between 1 and 200
      or jsonb_typeof(g->'studentIds') is distinct from 'array' then
      raise exception 'Invalid group name or roster' using errcode='22023';
    end if;
    if jsonb_array_length(g->'studentIds')=0 or exists(
      select 1 from jsonb_array_elements(g->'studentIds') x group by x having count(*)>1
    ) then raise exception 'Choose distinct group pupils' using errcode='22023'; end if;
    for member in select value from jsonb_array_elements(g->'studentIds') loop
      if jsonb_typeof(member) is distinct from 'string' then
        raise exception 'Invalid pupil ID' using errcode='22023';
      end if;
      if coalesce(prior->'studentIds','[]'::jsonb) @> jsonb_build_array(member) then continue; end if;
      if not exists(select 1 from jsonb_array_elements(coalesce(source->'students','[]'::jsonb)) s
        where s->'id'=member and coalesce(s->>'isArchived','false')<>'true'
          and coalesce(s->'assignedEmployeeIds','[]'::jsonb) ? teacher_id) then
        raise exception 'Only assigned pupils can join your group' using errcode='42501';
      end if;
    end loop;
    -- Whitelist editable fields. Preserve every other field on existing groups.
    normalized := coalesce(prior, jsonb_build_object('id',g->>'id', 'ownerEmployeeId',teacher_id,
      'assignedEmployeeIds',jsonb_build_array(teacher_id))) || jsonb_build_object(
      'name',btrim(g->>'name'), 'studentIds',g->'studentIds',
      'className',coalesce(prior->>'className',left(coalesce(g->>'className','группа'),100)),
      'externalId',coalesce(prior->>'externalId',g->>'id'),
      'educationForm',case when g->>'educationForm' in ('ДПП','ДОП') then g->>'educationForm' else 'ДПП' end);
    if prior is null then result := result || jsonb_build_array(normalized);
    else select jsonb_agg(case when x->>'id'=g->>'id' then normalized else x end order by ord)
      into result from jsonb_array_elements(result) with ordinality a(x,ord);
    end if;
  end loop;
  -- Omission cannot delete a group or its history.
  return result;
end;
$$;
revoke all on function public.merge_school_teacher_groups(jsonb,jsonb,text) from public,anon,authenticated;

do $migration$
declare definition text;
  marker text := '  perform public.validate_school_lesson_members';
  context_marker text := '  clean_payload := public.strip_school_secrets(state_row.payload);';
begin
  definition := pg_get_functiondef('public.save_school_context(jsonb,timestamptz)'::regprocedure);
  if strpos(definition,'public.merge_school_teacher_groups')=0 then
    if strpos(definition,marker)=0 then raise exception 'Unknown save function: inspect deployed definition'; end if;
    execute replace(definition, marker,
      E'  if not public.is_school_admin() then\n    state_row.payload := jsonb_set(state_row.payload, ''{groups}'', public.merge_school_teacher_groups(state_row.payload, clean_payload, employee_id));\n  end if;\n\n' || marker);
  end if;
  definition := pg_get_functiondef('public.get_school_context()'::regprocedure);
  if strpos(definition,'''teacherGroupsEnabled''')=0 then
    if strpos(definition,context_marker)=0 then raise exception 'Unknown context function: inspect deployed definition'; end if;
    execute replace(definition,context_marker,context_marker || E'\n  clean_payload := clean_payload || jsonb_build_object(''teacherGroupsEnabled'', true);');
  end if;
end;
$migration$;
commit;
