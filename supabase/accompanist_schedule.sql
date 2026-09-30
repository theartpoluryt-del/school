-- Run after accompanist_journal.sql. Timetable is the source of KC lessons.
begin;
alter table public.accompanist_lessons add column if not exists source_key text;
alter table public.accompanist_lessons add column if not exists source_hash text;
create unique index if not exists accompanist_source_key on public.accompanist_lessons(employee_id,source_key) where source_key is not null;

-- Admins retain their teaching roles and also have their own KC journal.
insert into public.school_accompanists(employee_id,enabled)
select distinct e->>'id',true from public.school_state s,
  jsonb_array_elements(s.payload->'employees') e,public.school_profiles p
where p.is_admin and lower(p.username)=lower(e->>'username')
on conflict(employee_id) do update set enabled=true;

create or replace function public.accompanist_schedule_rows(school jsonb,target_employee text,month_start date)
returns setof jsonb language sql stable security definer set search_path=public,pg_temp as $$
with dates as (
 select d::date as lesson_day from generate_series(date_trunc('month',month_start),date_trunc('month',month_start)+interval '1 month - 1 day',interval '1 day') d
 where extract(dow from d)<>0 and not exists(select 1 from jsonb_array_elements(coalesce(school->'holidays','[]')) h where h->>'date'=d::date::text)
), scheduled as (
 select r,lesson_day,'schedule|'||(r->>'id')||'|'||lesson_day::text source_key
 from jsonb_array_elements(coalesce(school->'schedule','[]')) r join dates on (r->>'weekday')::int=extract(dow from lesson_day)
 where r->>'employeeId'=target_employee and r->>'type'='Концертмейстер'
 and coalesce(r->>'needsCourseSelection','false')<>'true'
 and coalesce(nullif(r->>'effectiveFrom',''),'2026-09-01')::date<=lesson_day
 and (nullif(r->>'effectiveTo','') is null or (r->>'effectiveTo')::date>=lesson_day)
 and not exists(select 1 from public.school_absences a where not a.cancelled and a.source_employee=target_employee and lesson_day between a.starts_on and a.ends_on)
), substitutions as (
 select r,(r->>'date')::date as lesson_day,'substitution|'||a.id::text||'|'||(r->>'id') source_key
 from public.school_absences a cross join lateral jsonb_array_elements(a.lessons) r
 where not a.cancelled and a.substitute_employee=target_employee and r->>'type'='Концертмейстер'
 and (r->>'date')::date>=date_trunc('month',month_start)::date and (r->>'date')::date<(date_trunc('month',month_start)+interval '1 month')::date
 and not exists(select 1 from public.school_absences own_abs where not own_abs.cancelled and own_abs.source_employee=target_employee and (r->>'date')::date between own_abs.starts_on and own_abs.ends_on)
), source as (
 select * from scheduled union all select * from substitutions
), members as (
 select x.*,coalesce(case when prior->>'rosterOverride'='true' or nullif(r->>'archiveId','') is not null
   then coalesce(prior->'participantIds',r->'participantIds') else coalesce(r->'participantIds',prior->'participantIds') end,
   g->'studentIds',jsonb_build_array(r->>'studentId')) ids,coalesce(prior->'participantNames','{}')||coalesce(r->'participantNames','{}') names,
   coalesce(nullif(r->>'termYears',''),nullif(g->>'termYears',''),(select e->>'termYears'
     from jsonb_array_elements(coalesce(school->'students','[]')) s cross join lateral jsonb_array_elements(coalesce(s->'enrollments','[]')) e
     where s->>'id'=r->>'studentId' and (e->>'id'=r->>'enrollmentId' or (e->>'instrument'=r->>'instrument' and e->>'className'=r->>'className')) limit 1),'') term_years
 from source x
 left join lateral (select value prior from jsonb_array_elements(coalesce(school->'records','[]')) where value->>'employeeId'=target_employee and value->>'scheduleId'=r->>'id' and value->>'date'=lesson_day::text limit 1) p on true
 left join lateral (select value g from jsonb_array_elements(coalesce(school->'groups','[]')) where value->>'id'=r->>'studentId' limit 1) groups on true
), details as (
 select m.*,coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',coalesce(s->>'name',names->>id,'Ученик')) order by coalesce(s->>'name',names->>id,'Ученик'),id)
   from (select distinct value id from jsonb_array_elements_text(ids) where value is not null and value<>'') i
   left join lateral (select value s from jsonb_array_elements(coalesce(school->'students','[]')) where value->>'id'=id limit 1) pupils on true),'[]') roster,
 round(greatest(0,case
   when nullif(r->>'academicHours','') is not null then (r->>'academicHours')::numeric
   when coalesce(r->>'time','') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$' then
     (extract(epoch from (split_part(r->>'time','-',2)::time-split_part(r->>'time','-',1)::time))/2400)::numeric
   else coalesce(nullif(r->>'pedHours',''),'0')::numeric+coalesce(nullif(r->>'kcHours',''),'0')::numeric end)*2)/2 amount
 from members m
), lessons as (
 select jsonb_build_object('id',md5('kc|'||target_employee||'|'||source_key)::uuid,'employee_id',target_employee,
 'source_key',source_key,'lesson_date',lesson_day,'subject','Концертмейстер'||case when coalesce(r->>'instrument','')<>'' then ': '||(r->>'instrument') else '' end,
 'students',roster,'hours',amount,'time',coalesce(r->>'time',''),'className',coalesce(r->>'className',''),
 'termYears',term_years,'deleted',false,'updated_at',null) item
 from details where amount between 0.5 and 24 and jsonb_array_length(roster)>0
)
select item||jsonb_build_object('source_hash',md5(item::text)) from lessons;
$$;
revoke all on function public.accompanist_schedule_rows(jsonb,text,date) from public,anon,authenticated;

-- Keep old saved/manual records and their tested optimistic locking routine.
do $$ begin
 if to_regprocedure('public.get_accompanist_journal_manual(text,date)') is null then
   alter function public.get_accompanist_journal(text,date) rename to get_accompanist_journal_manual;
 end if;
 if to_regprocedure('public.save_accompanist_lesson_manual(jsonb,timestamptz)') is null then
   alter function public.save_accompanist_lesson(jsonb,timestamptz) rename to save_accompanist_lesson_manual;
 end if;
end $$;
revoke all on function public.get_accompanist_journal_manual(text,date) from public,anon,authenticated;
revoke all on function public.save_accompanist_lesson_manual(jsonb,timestamptz) from public,anon,authenticated;

create or replace function public.get_accompanist_journal(target_employee text,month_start date)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb; school jsonb; entries jsonb;
begin
 -- Authorizes before reading the full school payload or deriving other journals.
 result:=public.get_accompanist_journal_manual(target_employee,month_start);
 select payload into school from public.school_state order by updated_at desc limit 1;
 select coalesce(jsonb_agg(item order by item->>'lesson_date',item->>'time',item->>'id'),'[]') into entries from (
   select s||jsonb_build_object('hours',case when l.source_hash=s->>'source_hash' then l.hours else (s->>'hours')::numeric end,
     'updated_at',l.updated_at) item
   from public.accompanist_schedule_rows(school,target_employee,month_start) s
   left join public.accompanist_lessons l on l.id=(s->>'id')::uuid and l.employee_id=target_employee
   where not coalesce(l.deleted,false)
   union all
   select to_jsonb(l) from public.accompanist_lessons l where l.employee_id=target_employee and l.source_key is null and not l.deleted
   and l.lesson_date>=date_trunc('month',month_start)::date and l.lesson_date<(date_trunc('month',month_start)+interval '1 month')::date
 ) journal_rows;
 return result||jsonb_build_object('lessons',entries);
end $$;

create or replace function public.save_accompanist_lesson(lesson jsonb,expected_updated_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare school jsonb; own text; src jsonb; old_row public.accompanist_lessons; saved public.accompanist_lessons;
 target text:=lesson->>'employee_id'; lid uuid:=(lesson->>'id')::uuid;
 amount numeric:=(lesson->>'hours')::numeric; removing boolean:=coalesce((lesson->>'deleted')::boolean,false);
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select payload into school from public.school_state order by updated_at desc limit 1 for share;
 own:=public.school_employee_id(school);
 if own is null or (not public.is_school_admin() and target is distinct from own)
   or not exists(select 1 from public.school_accompanists where employee_id=target and enabled) then
   raise exception 'Accompanist access denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(lid::text,0));
 select * into old_row from public.accompanist_lessons where id=lid for update;
 if old_row.id is not null and old_row.employee_id is distinct from target then raise exception 'Owner cannot be changed' using errcode='42501'; end if;
 if nullif(lesson->>'source_key','') is null then
   if old_row.source_key is not null then raise exception 'Timetable source cannot be removed' using errcode='22023'; end if;
   -- No new independent lessons: create them in the timetable instead.
   if old_row.id is null then raise exception 'Add a KC lesson in the timetable' using errcode='22023'; end if;
   return public.save_accompanist_lesson_manual(lesson,expected_updated_at);
 end if;
 select s into src from public.accompanist_schedule_rows(school,target,(lesson->>'lesson_date')::date) s where s->>'id'=lid::text;
 if src is null or src->>'source_key' is distinct from lesson->>'source_key' or src->>'source_hash' is distinct from lesson->>'source_hash' then
   raise exception 'Timetable changed. Reload the journal.' using errcode='PT409'; end if;
 if old_row.id is not null and old_row.source_key is distinct from src->>'source_key' then raise exception 'Invalid source' using errcode='22023'; end if;
 if amount is null or amount<0.5 or amount>24 or amount*2<>trunc(amount*2) then raise exception 'Invalid KC hours' using errcode='22023'; end if;
 if old_row.id is null then
   if expected_updated_at is not null then raise exception 'Stale lesson' using errcode='PT409'; end if;
   insert into public.accompanist_lessons(id,employee_id,lesson_date,subject,students,hours,deleted,source_key,source_hash)
   values(lid,target,(src->>'lesson_date')::date,src->>'subject',src->'students',amount,removing,src->>'source_key',src->>'source_hash') returning * into saved;
 else
   if old_row.source_hash=src->>'source_hash' and old_row.hours=amount and old_row.deleted=removing then saved:=old_row;
   else
     if old_row.deleted or old_row.updated_at is distinct from expected_updated_at then raise exception 'Lesson changed in another session. Reload.' using errcode='PT409'; end if;
     update public.accompanist_lessons set lesson_date=(src->>'lesson_date')::date,subject=src->>'subject',students=src->'students',
       hours=amount,deleted=removing,source_hash=src->>'source_hash',updated_at=clock_timestamp() where id=lid returning * into saved;
   end if;
 end if;
 return to_jsonb(saved)||jsonb_build_object('time',src->>'time','className',src->>'className','termYears',src->>'termYears');
end $$;
revoke all on function public.get_accompanist_journal(text,date) from public,anon;
revoke all on function public.save_accompanist_lesson(jsonb,timestamptz) from public,anon;
grant execute on function public.get_accompanist_journal(text,date) to authenticated;
grant execute on function public.save_accompanist_lesson(jsonb,timestamptz) to authenticated;
commit;
