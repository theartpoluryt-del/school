-- After atomic_changes.sql and accompanist_schedule.sql. No assignments are rewritten.
begin;
set local lock_timeout='3s';

-- Retain the original implementations for rollback; no pupil payload is copied.
create table if not exists school_sync.function_backups (
 migration_id text not null, signature text not null, definition text not null,
 created_at timestamptz not null default clock_timestamp(), primary key(migration_id,signature)
);
revoke all on school_sync.function_backups from public,anon,authenticated;
insert into school_sync.function_backups(migration_id,signature,definition)
select 'kc-roster-20261009',signature,pg_get_functiondef(signature::regprocedure)
from unnest(array['public.strip_school_secrets(jsonb)','public.get_school_context()',
 'public.save_school_changes(jsonb,uuid)','public.save_school_context(jsonb,timestamptz)',
 'public.validate_school_lesson_members(jsonb,jsonb,text,boolean)']) signature
on conflict do nothing;

create or replace function public.school_kc_schedule_context(source jsonb)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare own text; staff jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 own:=public.school_employee_id(source);
 select coalesce(jsonb_agg(employee_id),'[]') into staff from public.school_accompanists
 where enabled and (employee_id=own or public.is_school_admin());
 return jsonb_build_object('kcScheduleEmployeeIds',staff,'kcScheduleStudents',case when jsonb_array_length(staff)=0 then '[]'::jsonb else
 coalesce((select jsonb_agg(jsonb_build_object('id',s->>'id','name',s->>'name','className',s->>'className',
 'educationForm',s->>'educationForm','enrollments',coalesce((select jsonb_agg(jsonb_build_object(
 'id',e->>'id','className',e->>'className','termYears',e->>'termYears','program',e->>'program',
 'instrument',e->>'instrument','educationForm',e->>'educationForm','subject',e->>'subject'))
 from jsonb_array_elements(coalesce(s->'enrollments','[]')) e),'[]')) order by s->>'name')
 from jsonb_array_elements(coalesce(source->'students','[]')) s where coalesce(s->>'isArchived','false')<>'true'),'[]') end);
end $$;

create or replace function public.school_kc_lesson_allowed(source jsonb,employee_id text,lesson jsonb)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(lesson->>'type'='Концертмейстер' and lesson->>'employeeId'=employee_id
 and exists(select 1 from public.school_accompanists a where a.employee_id=school_kc_lesson_allowed.employee_id and a.enabled)
 and exists(select 1 from jsonb_array_elements(coalesce(source->'students','[]')) s
   where s->>'id'=lesson->>'studentId' and coalesce(s->>'isArchived','false')<>'true'),false);
$$;
revoke all on function public.school_kc_schedule_context(jsonb) from public,anon,authenticated;
revoke all on function public.school_kc_lesson_allowed(jsonb,text,jsonb) from public,anon,authenticated;

do $migration$
declare def text; marker text;
begin
 def:=pg_get_functiondef('public.strip_school_secrets(jsonb)'::regprocedure);
 if strpos(def,'''kcScheduleStudents''')=0 then
  marker:=$s$- 'sessionEmployeeId'$s$;
  if strpos(def,marker)=0 then raise exception 'Unknown sanitizer'; end if;
  execute replace(def,marker,marker||$s$ - 'kcScheduleStudents' - 'kcScheduleEmployeeIds'$s$);
 end if;
 def:=pg_get_functiondef('public.get_school_context()'::regprocedure);
 if strpos(def,'public.school_kc_schedule_context')=0 then
  marker:='  clean_payload := public.strip_school_secrets(state_row.payload);';
  if strpos(def,marker)=0 then raise exception 'Unknown context getter'; end if;
  execute replace(def,marker,marker||E'\n  clean_payload := clean_payload || public.school_kc_schedule_context(state_row.payload);');
 end if;
 def:=pg_get_functiondef('public.save_school_changes(jsonb,uuid)'::regprocedure);
 if strpos(def,'public.school_kc_lesson_allowed')=0 then
  marker:='and not public.is_school_participant_assigned(candidate,me,incoming->>''studentId'')';
  if strpos(def,marker)=0 then raise exception 'Unknown patch assignment check'; end if;
  execute replace(def,marker,marker||E'\n      and not public.school_kc_lesson_allowed(st.payload,me,incoming)');
 end if;
 def:=pg_get_functiondef('public.save_school_context(jsonb,timestamptz)'::regprocedure);
 if strpos(def,'public.school_kc_lesson_allowed')=0 then
  marker:='(item->>''studentId'') = any(allowed_participant_ids)';
  if (length(def)-length(replace(def,marker,'')))/length(marker)<>2 then raise exception 'Unknown legacy assignment checks'; end if;
  execute replace(def,marker,'('||marker||' or public.school_kc_lesson_allowed(state_row.payload,employee_id,item))');
 end if;
 -- Existing KC identities must not grant a route to unassigned pedagogical lessons.
 -- This guard runs for legacy and atomic saves; existing pedagogical history stays editable.
 def:=pg_get_functiondef('public.validate_school_lesson_members(jsonb,jsonb,text,boolean)'::regprocedure);
 if strpos(def,'KC identity cannot grant pedagogical access')=0 then
  marker:='      if lesson ? ''rosterOverride'' then';
  if strpos(def,marker)=0 then raise exception 'Unknown lesson validator'; end if;
  execute replace(def,marker,$guard$
      if not admin_access and lesson->>'type' is distinct from 'Концертмейстер'
        and not public.is_school_participant_assigned(source,teacher_id,lesson->>'studentId')
        and exists(select 1 from jsonb_array_elements(coalesce(source->collection,'[]')) old
          where old->>'id'=lesson->>'id' and old->>'employeeId'=teacher_id and old->>'type'='Концертмейстер') then
        raise exception 'KC identity cannot grant pedagogical access' using errcode='42501';
      end if;
$guard$||marker);
 end if;
end;
$migration$;
notify pgrst,'reload schema';
commit;
