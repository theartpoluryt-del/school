-- Cache assignment/KC membership per save. Identical checks, no grants or data edits.
begin;
set local lock_timeout='3s';
insert into school_sync.function_backups(migration_id,signature,definition)
select 'roster-validation-performance-20261022',signature,pg_get_functiondef(signature::regprocedure)
from unnest(array['public.save_school_context(jsonb,timestamptz)',
 'public.validate_school_lesson_members(jsonb,jsonb,text,boolean)']) signature on conflict do nothing;
do $migration$
declare def text; marker text;
begin
 def:=pg_get_functiondef('public.save_school_context(jsonb,timestamptz)'::regprocedure);
 if strpos(def,'kc_allowed_student_ids')=0 then
  marker:='  allowed_participant_ids text[];';
  if strpos(def,marker)=0 then raise exception 'Unknown save declarations'; end if;
  def:=replace(def,marker,marker||E'\n  kc_allowed_student_ids text[]; kc_employee_enabled boolean; kc_validation_employee text;');
  marker:='  perform public.validate_school_lesson_members';
  if strpos(def,marker)=0 then raise exception 'Unknown save validation boundary'; end if;
  def:=replace(def,marker,$new$
  kc_validation_employee:=employee_id;
  select exists(select 1 from public.school_accompanists a where a.employee_id=kc_validation_employee and a.enabled)
    into kc_employee_enabled;
  select coalesce(array_agg(s->>'id'),array[]::text[]) into kc_allowed_student_ids
    from jsonb_array_elements(coalesce(state_row.payload->'students','[]')) s
    where s->>'id' is not null and coalesce(s->>'isArchived','false')<>'true';
$new$||marker);
  marker:='public.school_kc_lesson_allowed(state_row.payload,employee_id,item)';
  if (length(def)-length(replace(def,marker,'')))/length(marker)<>2 then raise exception 'Unexpected KC assignment checks'; end if;
  def:=replace(def,marker,$new$(coalesce(public.is_school_kc_lesson(item) and item->>'employeeId'=employee_id
    and kc_employee_enabled and (public.school_kc_collective_name(item->>'studentId') is not null
    or (item->>'studentId')=any(kc_allowed_student_ids)),false))$new$);
  execute def;
 end if;
 def:=pg_get_functiondef('public.validate_school_lesson_members(jsonb,jsonb,text,boolean)'::regprocedure);
 if strpos(def,'assigned_roster_ids')=0 then
  marker:='  collection text;';
  if strpos(def,marker)=0 then raise exception 'Unknown roster declarations'; end if;
  def:=replace(def,marker,marker||E'\n  assigned_roster_ids text[];');
  marker:='  perform public.validate_school_assessments';
  if strpos(def,marker)=0 then raise exception 'Unknown roster assessment boundary'; end if;
  def:=replace(def,marker,$new$
  select coalesce(array_agg(p->>'id'),array[]::text[]) into assigned_roster_ids
  from (select value p from jsonb_array_elements(coalesce(source->'students','[]'))
    union all select value p from jsonb_array_elements(coalesce(source->'groups','[]'))) participants
  where p->>'id' is not null and coalesce(p->'assignedEmployeeIds','[]') ? teacher_id;
$new$||marker);
  marker:=$old$public.is_school_participant_assigned(source,teacher_id,lesson->>'studentId')$old$;
  if strpos(def,marker)=0 then raise exception 'Unknown roster assignment check'; end if;
  def:=replace(def,marker,$new$coalesce((lesson->>'studentId')=any(assigned_roster_ids),false)$new$);
  execute def;
 end if;
end $migration$;
commit;
