-- Same permissions and JSON result; avoid repeatedly copying the whole school.
-- No pupil, lesson, account or password changes. Existing definitions are retained.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
insert into school_sync.function_backups(migration_id,signature,definition)
select 'context-performance-20261022',signature,pg_get_functiondef(signature::regprocedure)
from unnest(array['public.strip_school_secrets(jsonb)','public.get_school_context()',
 'public.school_teacher_students(jsonb,text)']) signature
on conflict do nothing;

-- Capture every account's result before replacement, without exporting private data.
create temp table context_before_check on commit drop as
select id, null::text as digest from public.school_profiles;
do $$ declare u record; begin
 for u in select id from context_before_check loop
  perform set_config('request.jwt.claim.sub',u.id::text,true);
  update context_before_check set digest=md5(public.get_school_context()::text) where id=u.id;
 end loop;
 perform set_config('request.jwt.claim.sub','',true);
end $$;

create or replace function public.strip_school_secrets(source jsonb)
returns jsonb language sql immutable set search_path=public,pg_temp as $$
 select (coalesce(source,'{}'::jsonb) - array['sessionEmployeeId','kcScheduleStudents',
 'kcScheduleEmployeeIds','absenceRows','absencesEnabled','substituteTeachers'])
 || jsonb_build_object('employees',coalesce((select jsonb_agg(employee-'password')
 from jsonb_array_elements(coalesce(source->'employees','[]'::jsonb)) employee),'[]'::jsonb));
$$;

create or replace function public.school_teacher_students(source jsonb, teacher_id text)
returns jsonb language sql immutable set search_path=public,pg_temp as $$
 with members as materialized (
  select distinct member #>> '{}' as member
  from jsonb_array_elements(coalesce(source->'groups','[]'::jsonb)) g
  cross join lateral jsonb_array_elements(coalesce(g->'studentIds','[]'::jsonb)) member
  where coalesce(g->'assignedEmployeeIds','[]'::jsonb) ? teacher_id and jsonb_typeof(member)='string'
 )
 select coalesce(jsonb_agg(case when coalesce(s->'assignedEmployeeIds','[]'::jsonb) ? teacher_id then s
 else jsonb_build_object('id',s->'id','name',s->'name','className',s->'className',
 'educationForm',s->'educationForm','isArchived',coalesce(s->'isArchived','false'::jsonb),
 'assignedEmployeeIds','[]'::jsonb,'enrollments','[]'::jsonb) end order by ord),'[]'::jsonb)
 from jsonb_array_elements(coalesce(source->'students','[]'::jsonb)) with ordinality a(s,ord)
 where coalesce(s->'assignedEmployeeIds','[]'::jsonb) ? teacher_id
 or s->>'id' in (select member from members);
$$;

create or replace function public.get_school_context()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
 state_row public.school_state%rowtype;
 clean_payload jsonb;
 employee_id text;
 extras jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if not exists(select 1 from public.school_profiles where id=auth.uid()) then
  raise exception 'School profile not found' using errcode='42501';
 end if;
 select * into state_row from public.school_state order by updated_at desc limit 1;
 if state_row.id is null then raise exception 'School state is not initialized' using errcode='55000'; end if;
 extras:=public.school_kc_schedule_context(state_row.payload)
  || public.school_absence_context(state_row.payload) || jsonb_build_object('teacherGroupsEnabled',true);
 if public.is_school_admin() then
  clean_payload:=public.strip_school_secrets(state_row.payload) || extras;
 else
  employee_id:=public.school_employee_id(state_row.payload);
  if employee_id is null then raise exception 'Profile is not linked to an employee' using errcode='42501'; end if;
  -- Drop large collections BEFORE rebuilding the small teacher-specific payload.
  clean_payload:=public.strip_school_secrets((state_row.payload - array[
   'employees','students','groups','schedule','records','scheduleArchives']) || jsonb_build_object(
   'activeEmployeeId',employee_id,
   'employees',coalesce((select jsonb_agg(item) from jsonb_array_elements(state_row.payload->'employees') item where item->>'id'=employee_id),'[]'::jsonb),
   'students',public.school_teacher_students(state_row.payload,employee_id),
   'groups',coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(state_row.payload->'groups','[]'::jsonb)) item where coalesce(item->'assignedEmployeeIds','[]'::jsonb) ? employee_id),'[]'::jsonb),
   'schedule',coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(state_row.payload->'schedule','[]'::jsonb)) item where item->>'employeeId'=employee_id),'[]'::jsonb),
   'records',coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(state_row.payload->'records','[]'::jsonb)) item where item->>'employeeId'=employee_id),'[]'::jsonb),
   'scheduleArchives',coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(state_row.payload->'scheduleArchives','[]'::jsonb)) item where item->>'employeeId'=employee_id),'[]'::jsonb)
  )) || extras;
 end if;
 return jsonb_build_object('patch_save',true,'id',state_row.id,'updated_at',state_row.updated_at,'payload',clean_payload);
end;
$$;

-- Abort the entire migration if any account's returned data changes.
do $$ declare u record; begin
 for u in select * from context_before_check loop
  perform set_config('request.jwt.claim.sub',u.id::text,true);
  if md5(public.get_school_context()::text) is distinct from u.digest then
   raise exception 'Context equivalence check failed';
  end if;
 end loop;
 perform set_config('request.jwt.claim.sub','',true);
end $$;
select count(*) as accounts_verified from context_before_check;
commit;
