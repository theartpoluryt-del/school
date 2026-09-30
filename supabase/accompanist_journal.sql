-- Separate KC journal. Staff membership is configured privately, not in this repository.
begin;
create table if not exists public.school_accompanists (
  employee_id text primary key,
  enabled boolean not null default true
);
create table if not exists public.accompanist_lessons (
  id uuid primary key,
  employee_id text not null references public.school_accompanists(employee_id),
  lesson_date date not null,
  subject text not null check(length(btrim(subject)) between 1 and 120),
  students jsonb not null check(jsonb_typeof(students)='array' and jsonb_array_length(students)>0),
  hours numeric not null check(hours between 0.5 and 24 and hours*2=trunc(hours*2)),
  deleted boolean not null default false,
  updated_at timestamptz not null default clock_timestamp()
);
create index if not exists accompanist_lessons_month on public.accompanist_lessons(employee_id,lesson_date) where not deleted;
alter table public.school_accompanists enable row level security;
alter table public.accompanist_lessons enable row level security;
revoke all on public.school_accompanists,public.accompanist_lessons from anon,authenticated;

create or replace function public.get_accompanist_access()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare school jsonb; own text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select payload into school from public.school_state order by updated_at desc limit 1;
  own:=public.school_employee_id(school);
  if own is null then raise exception 'Employee access denied' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',e->>'id','name',e->>'name') order by e->>'name')
    from jsonb_array_elements(school->'employees') e join public.school_accompanists a on a.employee_id=e->>'id'
    where a.enabled and (public.is_school_admin() or a.employee_id=own)),'[]'::jsonb);
end $$;

create or replace function public.get_accompanist_journal(target_employee text,month_start date)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare school jsonb; own text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select payload into school from public.school_state order by updated_at desc limit 1;
  own:=public.school_employee_id(school);
  if own is null or (not public.is_school_admin() and target_employee is distinct from own)
    or not exists(select 1 from public.school_accompanists where employee_id=target_employee and enabled) then
    raise exception 'Accompanist access denied' using errcode='42501';
  end if;
  if month_start is null then raise exception 'Month required' using errcode='22023'; end if;
  month_start:=date_trunc('month',month_start)::date;
  return jsonb_build_object(
    -- Only the roster needed for selection, never other teachers' grades or credentials.
    'students',coalesce((select jsonb_agg(jsonb_build_object('id',s->>'id','name',s->>'name','className',s->>'className',
      'courses',coalesce((select jsonb_agg(distinct jsonb_build_object('className',e->>'className','termYears',e->>'termYears','program',e->>'program','instrument',e->>'instrument'))
        from jsonb_array_elements(coalesce(s->'enrollments','[]')) e),'[]'::jsonb)) order by s->>'name')
      from jsonb_array_elements(school->'students') s),'[]'::jsonb),
    'lessons',coalesce((select jsonb_agg(to_jsonb(l) order by lesson_date,id) from public.accompanist_lessons l
      where employee_id=target_employee and not deleted and lesson_date>=month_start and lesson_date<month_start+interval '1 month'),'[]'::jsonb));
end $$;

create or replace function public.save_accompanist_lesson(lesson jsonb,expected_updated_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare school jsonb; own text; target text:=lesson->>'employee_id'; lid uuid:=(lesson->>'id')::uuid;
  old_row public.accompanist_lessons; saved public.accompanist_lessons; roster jsonb; ids jsonb:=lesson->'student_ids';
  amount numeric:=(lesson->>'hours')::numeric; lesson_day date:=(lesson->>'lesson_date')::date;
  lesson_subject text:=btrim(lesson->>'subject'); removing boolean:=coalesce((lesson->>'deleted')::boolean,false);
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select payload into school from public.school_state order by updated_at desc limit 1;
  own:=public.school_employee_id(school);
  if own is null or (not public.is_school_admin() and target is distinct from own)
    or not exists(select 1 from public.school_accompanists where employee_id=target and enabled) then
    raise exception 'Accompanist access denied' using errcode='42501';
  end if;
  if lid is null then raise exception 'Stable lesson id required' using errcode='22023'; end if;
  -- Serializes a retried insertion as well as edits; prevents duplicates after lost responses.
  perform pg_advisory_xact_lock(hashtextextended(lid::text,0));
  select * into old_row from public.accompanist_lessons where id=lid for update;
  if old_row.id is not null and old_row.employee_id is distinct from target then
    raise exception 'Owner cannot be changed' using errcode='42501';
  end if;
  if ids is null or jsonb_typeof(ids)<>'array' or jsonb_array_length(ids)=0 then
    raise exception 'Select pupils' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(ids) x where jsonb_typeof(x)<>'string')
    or jsonb_array_length(ids)<>(select count(distinct value) from jsonb_array_elements_text(ids)) then
    raise exception 'Invalid pupils' using errcode='22023';
  end if;
  select jsonb_agg(pupil order by pupil->>'name',pupil->>'id') into roster from (
    select coalesce((select jsonb_build_object('id',s->>'id','name',s->>'name') from jsonb_array_elements(school->'students') s where s->>'id'=wanted),
      (select s from jsonb_array_elements(coalesce(old_row.students,'[]')) s where s->>'id'=wanted)) pupil
    from jsonb_array_elements_text(ids) wanted
  ) pupils;
  if exists(select 1 from jsonb_array_elements(roster) x where x='null'::jsonb) then
    raise exception 'Unknown pupil' using errcode='22023';
  end if;
  if amount is null or amount<0.5 or amount>24 or amount*2<>trunc(amount*2)
    or lesson_day is null or lesson_subject is null or length(lesson_subject) not between 1 and 120 then
    raise exception 'Invalid date, subject or hours (step 0.5)' using errcode='22023';
  end if;
  if old_row.id is not null then
    if old_row.lesson_date=lesson_day and old_row.subject=lesson_subject and old_row.students=roster
      and old_row.hours=amount and old_row.deleted=removing then return to_jsonb(old_row); end if;
    if old_row.deleted or old_row.updated_at is distinct from expected_updated_at then
      raise exception 'Lesson changed in another session. Reload.' using errcode='PT409';
    end if;
    update public.accompanist_lessons set lesson_date=lesson_day,subject=lesson_subject,students=roster,
      hours=amount,deleted=removing,updated_at=clock_timestamp() where id=lid returning * into saved;
  else
    if expected_updated_at is not null or removing then raise exception 'Lesson not found' using errcode='PT409'; end if;
    insert into public.accompanist_lessons(id,employee_id,lesson_date,subject,students,hours)
      values(lid,target,lesson_day,lesson_subject,roster,amount) returning * into saved;
  end if;
  return to_jsonb(saved);
end $$;
revoke all on function public.get_accompanist_access() from public,anon;
revoke all on function public.get_accompanist_journal(text,date) from public,anon;
revoke all on function public.save_accompanist_lesson(jsonb,timestamptz) from public,anon;
grant execute on function public.get_accompanist_access() to authenticated;
grant execute on function public.get_accompanist_journal(text,date) to authenticated;
grant execute on function public.save_accompanist_lesson(jsonb,timestamptz) to authenticated;
commit;
