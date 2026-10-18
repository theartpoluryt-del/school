-- After accompanist_roster.sql. No historical schedule or marks are rewritten.
begin;
set local lock_timeout='3s';
insert into school_sync.function_backups(migration_id,signature,definition)
select 'kc-kinds-assessments-20261018',signature,pg_get_functiondef(signature::regprocedure)
from unnest(array['public.accompanist_schedule_rows(jsonb,text,date)',
 'public.school_kc_lesson_allowed(jsonb,text,jsonb)',
 'public.validate_school_lesson_members(jsonb,jsonb,text,boolean)']) signature
on conflict do nothing;

create or replace function public.is_school_kc_lesson(lesson jsonb)
returns boolean language sql immutable set search_path=public,pg_temp as $$
 select coalesce(lesson->>'type'='КЦ' or (lesson->>'type'='Концертмейстер' and lesson->>'kcKind' is distinct from 'pedagogical'),false);
$$;
create or replace function public.school_kc_collective_name(participant text)
returns text language sql immutable set search_path=public,pg_temp as $$
 select case participant when 'kc-collective-music' then 'Коллективное музицирование'
 when 'kc-choir-io' then 'Хор ИО' when 'kc-choir-ho' then 'Хор ХО' end;
$$;
revoke all on function public.is_school_kc_lesson(jsonb) from public,anon,authenticated;
revoke all on function public.school_kc_collective_name(text) from public,anon,authenticated;

create or replace function public.school_kc_lesson_allowed(source jsonb,employee_id text,lesson jsonb)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(public.is_school_kc_lesson(lesson) and lesson->>'employeeId'=employee_id
 and exists(select 1 from public.school_accompanists a where a.employee_id=school_kc_lesson_allowed.employee_id and a.enabled)
 and (public.school_kc_collective_name(lesson->>'studentId') is not null or exists(
 select 1 from jsonb_array_elements(coalesce(source->'students','[]')) s
 where s->>'id'=lesson->>'studentId' and coalesce(s->>'isArchived','false')<>'true')),false);
$$;
revoke all on function public.school_kc_lesson_allowed(jsonb,text,jsonb) from public,anon,authenticated;

-- Validate the added marks without granting any new employee/student access.
create or replace function public.validate_school_assessments(source jsonb, incoming jsonb, teacher_id text, admin_access boolean)
returns void language plpgsql set search_path=public,pg_temp as $$
declare lesson jsonb; prior jsonb; field text; item record; mark jsonb; marks jsonb;
begin
 for lesson in select value from jsonb_array_elements(coalesce(incoming->'records','[]')) loop
  if not admin_access and lesson->>'employeeId' is distinct from teacher_id then continue; end if;
  select value into prior from jsonb_array_elements(coalesce(source->'records','[]'))
    where value->>'id'=lesson->>'id' and value->>'employeeId'=lesson->>'employeeId' limit 1;
  foreach field in array array['quarterGrades','extraGrades'] loop
   if not lesson ? field then continue; end if;
   if jsonb_typeof(lesson->field) is distinct from 'object' then raise exception 'Invalid assessment object' using errcode='22023'; end if;
   for item in select key,value from jsonb_each(lesson->field) loop
    if item.key is distinct from lesson->>'studentId' and not coalesce(lesson->'participantIds','[]') ? item.key
      and not (coalesce(prior->field->item.key = item.value,false))
      and not coalesce(prior->'participantIds','[]') ? item.key then
      raise exception 'Assessment pupil outside lesson roster' using errcode='42501'; end if;
    if field='quarterGrades' then marks:=jsonb_build_array(item.value);
    else
      if jsonb_typeof(item.value) is distinct from 'array' then raise exception 'Invalid extra marks' using errcode='22023'; end if;
      if jsonb_array_length(item.value)<>4 then raise exception 'Expected four extra marks' using errcode='22023'; end if;
      marks:=item.value;
    end if;
    for mark in select value from jsonb_array_elements(marks) loop
      if jsonb_typeof(mark) is distinct from 'string' or (mark #>> '{}') not in ('','2-','2','2+','3-','3','3+','4-','4','4+','5-','5','5+') then
        raise exception 'Invalid assessment mark' using errcode='22023'; end if;
    end loop;
   end loop;
  end loop;
 end loop;
end $$;
revoke all on function public.validate_school_assessments(jsonb,jsonb,text,boolean) from public,anon,authenticated;

do $migration$
declare def text; marker text;
begin
 def:=pg_get_functiondef('public.accompanist_schedule_rows(jsonb,text,date)'::regprocedure);
 if strpos(def,'public.is_school_kc_lesson')=0 then
  if strpos(def,$s$r->>'type'='Концертмейстер'$s$)=0 then raise exception 'Unknown KC source'; end if;
  def:=replace(def,$s$r->>'type'='Концертмейстер'$s$,'public.is_school_kc_lesson(r)');
  def:=replace(def,$s$coalesce(s->>'name',names->>id,'Ученик')$s$,$s$coalesce(s->>'name',public.school_kc_collective_name(id),names->>id,'Ученик')$s$);
  marker:=$s$jsonb_array_elements_text(ids)$s$;
  if strpos(def,marker)=0 then raise exception 'Unknown KC roster'; end if;
  def:=replace(def,marker,$s$jsonb_array_elements_text(case when public.school_kc_collective_name(r->>'studentId') is not null then jsonb_build_array(r->>'studentId') else ids end)$s$);
  def:=replace(def,$s$'subject','Концертмейстер'||case$s$,$s$'subject',case when public.school_kc_collective_name(r->>'studentId') is not null then '—' when r->>'type'='Концертмейстер' then 'Концертмейстер' else 'КЦ' end||case$s$);
  def:=replace(def,$s$when coalesce(r->>'instrument','')<>'' then$s$,$s$when public.school_kc_collective_name(r->>'studentId') is null and coalesce(r->>'instrument','')<>'' then$s$);
  def:=replace(def,$s$'termYears',term_years$s$,$s$'termYears',case when public.school_kc_collective_name(r->>'studentId') is not null then '' else term_years end,'collective',public.school_kc_collective_name(r->>'studentId') is not null,'legacyKind',r->>'type'='Концертмейстер'$s$);
  -- Preserve hashes of ambiguous legacy rows, including their manual hour corrections.
  def:=replace(def,'md5(item::text)', $s$md5((case when item->>'legacyKind'='true' then item-'collective'-'legacyKind' else item end)::text)$s$);
  execute def;
 end if;
 def:=pg_get_functiondef('public.validate_school_lesson_members(jsonb,jsonb,text,boolean)'::regprocedure);
 if strpos(def,'public.validate_school_assessments')=0 then
  def:=replace(def,$s$lesson->>'type' is distinct from 'Концертмейстер'$s$,'not public.is_school_kc_lesson(lesson)');
  def:=replace(def,$s$old->>'type'='Концертмейстер'$s$,'public.is_school_kc_lesson(old)');
  marker:=$s$  foreach collection in array array['schedule', 'records'] loop$s$;
  if strpos(def,marker)=0 then raise exception 'Unknown lesson validator'; end if;
  def:=replace(def,marker,'  perform public.validate_school_assessments(source,incoming,teacher_id,admin_access);'||E'\n'||marker);
  marker:=$s$      if lesson ? 'rosterOverride' then$s$;
  if strpos(def,marker)=0 then raise exception 'Unknown roster validator'; end if;
  def:=replace(def,marker,$s$
      if public.school_kc_collective_name(lesson->>'studentId') is not null and (
        lesson->>'type' is distinct from 'КЦ' or length(coalesce(lesson->>'className',''))>80
        or coalesce(lesson->>'instrument','')<>'' or coalesce(lesson->>'enrollmentId','')<>''
        or coalesce(lesson->'participantIds','[]')<>'[]'::jsonb) then
        raise exception 'Invalid KC collective lesson' using errcode='22023';
      end if;
$s$||marker);
  execute def;
 end if;
end $migration$;
notify pgrst,'reload schema';
commit;
