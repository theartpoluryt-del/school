-- Independent, server-owned absence ledger; normal school saves cannot overwrite it.
begin;
create table if not exists public.school_absences (
 id uuid primary key default gen_random_uuid(), source_employee text not null,
 substitute_employee text, starts_on date not null, ends_on date not null,
 reason text not null default 'Отсутствие', lessons jsonb not null default '[]',
 cancelled boolean not null default false, created_by uuid not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(ends_on>=starts_on and ends_on-starts_on<=366)
);
alter table public.school_absences enable row level security;
revoke all on public.school_absences from public,anon,authenticated;

create or replace function public.school_absence_context(source jsonb)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('absencesEnabled',true,
 'substituteTeachers',coalesce((select jsonb_agg(jsonb_build_object('id',e->>'id','name',e->>'name')) from jsonb_array_elements(source->'employees') e),'[]'::jsonb),
 'absenceRows',coalesce((select jsonb_agg(case when public.is_school_admin() or a.source_employee=public.school_employee_id(source)
   then to_jsonb(a)-'created_by' else (to_jsonb(a)-'created_by')||jsonb_build_object('reason','Замещение') end)
   from public.school_absences a where public.is_school_admin() or public.school_employee_id(source) in(a.source_employee,a.substitute_employee)),'[]'::jsonb));
$$;
revoke all on function public.school_absence_context(jsonb) from public,anon,authenticated;

create or replace function public.school_absence_action(action text, args jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare st public.school_state%rowtype; me text; src text; sub text; first_day date; last_day date;
 a public.school_absences%rowtype; d date; r jsonb; prior jsonb; item jsonb; participant jsonb; ids jsonb; names jsonb;
 snapshots jsonb:='[]'; lesson_id text; pupil_id text; grade text;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into strict st from public.school_state order by updated_at desc limit 1 for update;
 me:=public.school_employee_id(st.payload);
 if me is null then raise exception 'Employee required' using errcode='42501'; end if;
 if action='create' then
   if (args->>'expectedVersion')::timestamptz is distinct from st.updated_at then raise exception 'Reload before creating absence' using errcode='PT409'; end if;
   src:=args->>'employeeId'; sub:=nullif(args->>'substituteId','');
   if src is distinct from me and not public.is_school_admin() then raise exception 'Only your own absence' using errcode='42501'; end if;
   if not exists(select 1 from jsonb_array_elements(st.payload->'employees') e where e->>'id'=src)
      or sub=src or (sub is not null and not exists(select 1 from jsonb_array_elements(st.payload->'employees') e where e->>'id'=sub)) then raise exception 'Invalid employees' using errcode='22023'; end if;
   first_day:=(args->>'from')::date; last_day:=(args->>'to')::date;
   if first_day is null or last_day is null or last_day<first_day or last_day-first_day>366 then raise exception 'Invalid period' using errcode='22023'; end if;
   if exists(select 1 from public.school_absences x where not x.cancelled and x.source_employee=src and x.starts_on<=last_day and x.ends_on>=first_day) then raise exception 'Absence overlaps an existing period' using errcode='22023'; end if;
   if exists(select 1 from public.school_absences x where not x.cancelled and x.source_employee=sub and x.starts_on<=last_day and x.ends_on>=first_day) then raise exception 'Substitute is absent during this period' using errcode='22023'; end if;
   if exists(select 1 from public.school_absences x where not x.cancelled and x.substitute_employee=src and x.starts_on<=last_day and x.ends_on>=first_day) then raise exception 'Reassign your existing substitutions first' using errcode='22023'; end if;
   d:=first_day;
   while d<=last_day loop
    if extract(dow from d)<>0 and not exists(select 1 from jsonb_array_elements(coalesce(st.payload->'holidays','[]')) h where h->>'date'=d::text) then
     for r in select value from jsonb_array_elements(st.payload->'schedule') where value->>'employeeId'=src
       and (value->>'weekday')::int=extract(dow from d) and coalesce(nullif(value->>'effectiveFrom',''),'2026-09-01')::date<=d
       and (nullif(value->>'effectiveTo','') is null or (value->>'effectiveTo')::date>=d) loop
      if coalesce(r->>'needsCourseSelection','false')='true' then raise exception 'Resolve ambiguous course before absence'; end if;
      select value into prior from jsonb_array_elements(st.payload->'records') where value->>'employeeId'=src and value->>'scheduleId'=r->>'id' and value->>'date'=d::text limit 1;
      select value into participant from jsonb_array_elements(coalesce(st.payload->'groups','[]')||coalesce(st.payload->'students','[]')) where value->>'id'=r->>'studentId' limit 1;
      ids:=case when prior->>'rosterOverride'='true' or coalesce(r->>'archiveId','')<>'' then coalesce(prior->'participantIds',r->'participantIds') else coalesce(r->'participantIds',prior->'participantIds') end;
      ids:=coalesce(ids,participant->'studentIds',jsonb_build_array(r->>'studentId'));
      if jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids)=0
        or exists(select 1 from jsonb_array_elements(ids) p where jsonb_typeof(p)<>'string') then
        raise exception 'Choose lesson pupils before absence' using errcode='22023'; end if;
      if coalesce(r->>'time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$'
        or split_part(r->>'time','-',1)>=split_part(r->>'time','-',2) then
        raise exception 'Set valid lesson times before absence' using errcode='22023'; end if;
      select coalesce(jsonb_object_agg(p->>'id',p->>'name'),'{}') into names from jsonb_array_elements(st.payload->'students') p where ids ? (p->>'id');
      if sub is not null and exists(select 1 from jsonb_array_elements(st.payload->'schedule') x where x->>'employeeId'=sub and (x->>'weekday')::int=extract(dow from d)
        and coalesce(nullif(x->>'effectiveFrom',''),'2026-09-01')::date<=d and (nullif(x->>'effectiveTo','') is null or (x->>'effectiveTo')::date>=d)
        and x->>'time' ~ '^\d{2}:\d{2}-\d{2}:\d{2}$' and r->>'time' ~ '^\d{2}:\d{2}-\d{2}:\d{2}$'
        and split_part(x->>'time','-',1)<split_part(r->>'time','-',2) and split_part(x->>'time','-',2)>split_part(r->>'time','-',1)) then raise exception 'Substitute timetable overlaps lessons' using errcode='22023'; end if;
      if sub is not null and exists(select 1 from public.school_absences other_absence,
        jsonb_array_elements(other_absence.lessons) x where not other_absence.cancelled
        and other_absence.substitute_employee=sub and x->>'date'=d::text
        and split_part(x->>'time','-',1)<split_part(r->>'time','-',2)
        and split_part(x->>'time','-',2)>split_part(r->>'time','-',1)) then
        raise exception 'Substitute timetable overlaps lessons' using errcode='22023'; end if;
      item:=jsonb_build_object('id','sub-'||gen_random_uuid()::text,'sourceScheduleId',r->>'id','sourceRecordId',prior->>'id','date',d::text,
        'employeeId',sub,'sourceEmployeeId',src,'studentId',r->>'studentId','studentName',coalesce(prior->>'studentName',participant->>'name','Ученик / группа'),
        'participantKind',case when participant ? 'studentIds' or r->>'participantKind'='group' then 'group' else 'student' end,
        'participantIds',ids,'participantNames',coalesce(prior->'participantNames','{}')||names,
        'type',r->>'type','className',r->>'className','instrument',r->>'instrument','educationForm',coalesce(r->>'educationForm',participant->>'educationForm','ДПП'),
        'time',r->>'time','pedHours',coalesce(prior->'pedHours',r->'pedHours','0'),'kcHours',coalesce(prior->'kcHours',r->'kcHours','0'),
        'academicHours',coalesce(prior->'academicHours',r->'academicHours'),'grade','','studentGrades','{}'::jsonb,'topic','','status','planned','isSubstitution',true);
      snapshots:=snapshots||jsonb_build_array(item);
     end loop;
    end if;
    d:=d+1;
   end loop;
   if jsonb_array_length(snapshots)=0 then raise exception 'No scheduled lessons in this period' using errcode='22023'; end if;
   insert into public.school_absences(source_employee,substitute_employee,starts_on,ends_on,reason,lessons,created_by)
     values(src,sub,first_day,last_day,case when args->>'reason'='Больничный' then 'Больничный' else 'Отсутствие' end,snapshots,auth.uid());
 elsif action in ('cancel','grade','topic') then
   select * into strict a from public.school_absences where id=(args->>'absenceId')::uuid for update;
   if action='cancel' then
     if me<>a.source_employee and not public.is_school_admin() then raise exception 'Not your absence' using errcode='42501'; end if;
     update public.school_absences set cancelled=true,updated_at=clock_timestamp() where id=a.id;
   else
     if a.cancelled or (me is distinct from a.substitute_employee and not public.is_school_admin()) then raise exception 'Not your substitution' using errcode='42501'; end if;
     lesson_id:=args->>'lessonId'; pupil_id:=args->>'pupilId'; grade:=args->>'grade';
     select value into strict item from jsonb_array_elements(a.lessons) where value->>'id'=lesson_id;
     if action='grade' then
       if grade is null or grade not in ('','2-','2','2+','3-','3','3+','4-','4','4+','5-','5','5+') or not (item->'participantIds' ? pupil_id) then raise exception 'Invalid pupil/grade' using errcode='22023'; end if;
       if item->>'participantKind'='group' then item:=jsonb_set(item,array['studentGrades',pupil_id],to_jsonb(grade));
       else item:=jsonb_set(item,'{grade}',to_jsonb(grade)); end if;
     else
       if jsonb_array_length(item->'participantIds')<8 or length(coalesce(args->>'topic',''))>2000 then raise exception 'Topics require eight pupils' using errcode='22023'; end if;
       item:=jsonb_set(item,'{topic}',to_jsonb(coalesce(args->>'topic','')));
     end if;
     select jsonb_agg(case when x->>'id'=lesson_id then item else x end order by n) into snapshots from jsonb_array_elements(a.lessons) with ordinality l(x,n);
     update public.school_absences set lessons=snapshots,updated_at=clock_timestamp() where id=a.id;
   end if;
 else raise exception 'Invalid action' using errcode='22023'; end if;
 -- Invalidate stale clients before any further main-context save.
 update public.school_state set updated_at=clock_timestamp() where id=st.id;
 return public.get_school_context();
end;
$$;
revoke all on function public.school_absence_action(text,jsonb) from public,anon;
grant execute on function public.school_absence_action(text,jsonb) to authenticated;
do $migration$
declare def text; marker text:='  clean_payload := public.strip_school_secrets(state_row.payload);';
begin
 def:=pg_get_functiondef('public.strip_school_secrets(jsonb)'::regprocedure);
 if strpos(def,'''absenceRows''')=0 then
  if strpos(def,$s$- 'sessionEmployeeId'$s$)=0 then raise exception 'Unknown sanitizer'; end if;
  execute replace(def,$s$- 'sessionEmployeeId'$s$,$s$- 'sessionEmployeeId' - 'absenceRows' - 'absencesEnabled' - 'substituteTeachers'$s$);
 end if;
 def:=pg_get_functiondef('public.get_school_context()'::regprocedure);
 if strpos(def,'public.school_absence_context')=0 then
  if strpos(def,marker)=0 then raise exception 'Unknown getter'; end if;
  execute replace(def,marker,marker||E'\n  clean_payload := clean_payload || public.school_absence_context(state_row.payload);');
 end if;
end;
$migration$;
commit;
