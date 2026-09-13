-- Independent paid-services journal. Apply after schema.sql.
-- No pupils, credentials or other production data belong in this file.
begin;

create table if not exists public.paid_school_courses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  subject text not null check (length(btrim(subject)) between 1 and 120),
  age_label text not null default '',
  teacher_ids text[] not null default '{}',
  accompanist_ids text[] not null default '{}',
  students jsonb not null default '[]' check (jsonb_typeof(students) = 'array'),
  weekly_hours numeric check (weekly_hours > 0 and weekly_hours <= 40),
  starts_on date not null,
  archived boolean not null default false,
  updated_at timestamptz not null default clock_timestamp()
);
create table if not exists public.paid_school_lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.paid_school_courses(id),
  employee_id text not null,
  lesson_date date not null,
  hours numeric not null check (hours > 0 and hours <= 24 and hours * 4 = trunc(hours * 4)),
  completed boolean not null default false,
  students jsonb not null default '[]' check (jsonb_typeof(students) = 'array'),
  present_student_ids text[] not null default '{}',
  grades jsonb not null default '{}' check (jsonb_typeof(grades) = 'object'),
  deleted boolean not null default false,
  updated_at timestamptz not null default clock_timestamp()
);
create unique index if not exists paid_school_lesson_day
  on public.paid_school_lessons(course_id, employee_id, lesson_date) where not deleted;
create index if not exists paid_school_lesson_month
  on public.paid_school_lessons(employee_id, lesson_date) where not deleted;
alter table public.paid_school_courses enable row level security;
alter table public.paid_school_lessons enable row level security;
revoke all on public.paid_school_courses, public.paid_school_lessons from anon, authenticated;

create or replace function public.get_paid_journal(target_employee text, month_start date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare own_employee text; result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select public.school_employee_id(payload) into own_employee from public.school_state order by updated_at desc limit 1;
  if own_employee is null or (not public.is_school_admin() and target_employee is distinct from own_employee) then
    raise exception 'Employee access denied' using errcode='42501';
  end if;
  if month_start is null then raise exception 'Month is required' using errcode='22023'; end if;
  month_start := date_trunc('month', month_start)::date;
  select jsonb_build_object(
    'courses', coalesce((select jsonb_agg(case
      when public.is_school_admin() or target_employee = any(c.teacher_ids || c.accompanist_ids) then to_jsonb(c)
      else to_jsonb(c) || jsonb_build_object('archived',true,'teacher_ids','[]'::jsonb,'accompanist_ids','[]'::jsonb,
        'students',coalesce((select jsonb_agg(pupil) from (
          select distinct on (s->>'id') s pupil from public.paid_school_lessons history
          cross join jsonb_array_elements(history.students) s
          where history.course_id=c.id and history.employee_id=target_employee and not history.deleted
          order by s->>'id',history.lesson_date desc
        ) own_pupils),'[]'::jsonb)) end order by c.name) from public.paid_school_courses c
      where target_employee = any(c.teacher_ids || c.accompanist_ids)
        or exists(select 1 from public.paid_school_lessons l where l.course_id=c.id and l.employee_id=target_employee and not l.deleted)), '[]'),
    'lessons', coalesce((select jsonb_agg(to_jsonb(l) order by l.lesson_date) from public.paid_school_lessons l
      where l.employee_id=target_employee and not l.deleted and l.lesson_date >= month_start
        and l.lesson_date < month_start + interval '1 month'), '[]')
  ) into result;
  return result;
end;
$$;

create or replace function public.save_paid_lesson(lesson jsonb, expected_updated_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  own_employee text; admin_access boolean; old_row public.paid_school_lessons;
  course public.paid_school_courses; saved public.paid_school_lessons;
  lesson_id uuid := coalesce(nullif(lesson->>'id','')::uuid,gen_random_uuid());
  target_employee text := lesson->>'employee_id';
  roster jsonb; present_ids text[]; grade_values jsonb := coalesce(lesson->'grades','{}');
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select public.school_employee_id(payload) into own_employee from public.school_state order by updated_at desc limit 1;
  admin_access := public.is_school_admin();
  if own_employee is null or (not admin_access and target_employee is distinct from own_employee) then
    raise exception 'Employee access denied' using errcode='42501';
  end if;
  select * into old_row from public.paid_school_lessons where id=lesson_id for update;
  if found then
    if old_row.employee_id is distinct from target_employee or old_row.course_id is distinct from (lesson->>'course_id')::uuid then
      raise exception 'Lesson owner cannot be changed' using errcode='42501';
    end if;
    if old_row.updated_at is distinct from expected_updated_at or old_row.deleted then
      raise exception 'Lesson changed in another session. Reload the journal.' using errcode='PT409';
    end if;
  elsif expected_updated_at is not null then
    raise exception 'Lesson was not found' using errcode='PT409';
  end if;
  select * into course from public.paid_school_courses where id=(lesson->>'course_id')::uuid for share;
  if not found then raise exception 'Course was not found' using errcode='22023'; end if;
  if old_row.id is null and (course.archived or not (target_employee = any(course.teacher_ids || course.accompanist_ids))) then
    raise exception 'Employee is not assigned to this course' using errcode='42501';
  end if;
  if (lesson->>'lesson_date')::date < course.starts_on then
    raise exception 'Lesson precedes course start' using errcode='22023';
  end if;
  if coalesce((lesson->>'completed')::boolean,false) and (lesson->>'lesson_date')::date > (now() at time zone 'Asia/Yekaterinburg')::date then
    raise exception 'A future lesson cannot be completed' using errcode='22023';
  end if;
  -- Retain the actual roster of an existing lesson even after a course is edited.
  roster := coalesce(old_row.students,course.students);
  select coalesce(array_agg(value),'{}') into present_ids from jsonb_array_elements_text(coalesce(lesson->'present_student_ids','[]'));
  if exists(select 1 from unnest(present_ids) p where not exists(select 1 from jsonb_array_elements(roster) s where s->>'id'=p))
    or cardinality(present_ids) <> (select count(distinct p) from unnest(present_ids) p) then
    raise exception 'Invalid attendance roster' using errcode='22023';
  end if;
  if jsonb_typeof(grade_values) <> 'object' then raise exception 'Invalid grades' using errcode='22023'; end if;
  if exists(select 1 from jsonb_each_text(grade_values) g where g.value is null or g.value not in ('2-','2','2+','3-','3','3+','4-','4','4+','5-','5','5+')
    or not exists(select 1 from jsonb_array_elements(roster) s where s->>'id'=g.key)) then
    raise exception 'Invalid pupil grade' using errcode='22023';
  end if;
  if (cardinality(present_ids)>0 or grade_values<>'{}'::jsonb) and (lesson->>'lesson_date')::date > (now() at time zone 'Asia/Yekaterinburg')::date then
    raise exception 'A future lesson cannot be marked' using errcode='22023';
  end if;
  if old_row.id is not null then
    update public.paid_school_lessons set lesson_date=(lesson->>'lesson_date')::date,hours=(lesson->>'hours')::numeric,
      completed=coalesce((lesson->>'completed')::boolean,false),present_student_ids=present_ids,grades=grade_values,
      deleted=coalesce((lesson->>'deleted')::boolean,false),updated_at=clock_timestamp()
    where id=old_row.id returning * into saved;
  else
  insert into public.paid_school_lessons(id,course_id,employee_id,lesson_date,hours,completed,students,present_student_ids,grades,deleted,updated_at)
  values(lesson_id,course.id,target_employee,(lesson->>'lesson_date')::date,(lesson->>'hours')::numeric,
    coalesce((lesson->>'completed')::boolean,false),roster,present_ids,grade_values,coalesce((lesson->>'deleted')::boolean,false),clock_timestamp())
  returning * into saved;
  end if;
  return to_jsonb(saved);
end;
$$;

create or replace function public.save_paid_course(course jsonb, expected_updated_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  course_id uuid := coalesce(nullif(course->>'id','')::uuid,gen_random_uuid());
  old_row public.paid_school_courses; saved public.paid_school_courses;
  teachers text[]; accompanists text[]; school jsonb; roster jsonb := course->'students';
begin
  if auth.uid() is null or not public.is_school_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  select * into old_row from public.paid_school_courses where id=course_id for update;
  if (old_row.id is not null and old_row.updated_at is distinct from expected_updated_at)
    or (old_row.id is null and expected_updated_at is not null) then
    raise exception 'Course changed in another session. Reload the journal.' using errcode='PT409';
  end if;
  select payload into school from public.school_state order by updated_at desc limit 1;
  select coalesce(array_agg(value),'{}') into teachers from jsonb_array_elements_text(coalesce(course->'teacher_ids','[]'));
  select coalesce(array_agg(value),'{}') into accompanists from jsonb_array_elements_text(coalesce(course->'accompanist_ids','[]'));
  if cardinality(teachers || accompanists)=0 or exists(select 1 from unnest(teachers || accompanists) p
    where not exists(select 1 from jsonb_array_elements(school->'employees') e where e->>'id'=p)) then
    raise exception 'Invalid course employees' using errcode='22023';
  end if;
  if roster is null or jsonb_typeof(roster)<>'array' or jsonb_array_length(roster)=0 then
    raise exception 'Pupils are required' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(roster) s where nullif(btrim(s->>'id'),'') is null or nullif(btrim(s->>'name'),'') is null)
    or (select count(*)<>count(distinct s->>'id') from jsonb_array_elements(roster) s) then
    raise exception 'Invalid pupil roster' using errcode='22023';
  end if;
  insert into public.paid_school_courses(id,name,subject,age_label,teacher_ids,accompanist_ids,students,weekly_hours,starts_on,archived,updated_at)
  values(course_id,btrim(course->>'name'),btrim(course->>'subject'),coalesce(course->>'age_label',''),teachers,accompanists,roster,
    nullif(course->>'weekly_hours','')::numeric,(course->>'starts_on')::date,coalesce((course->>'archived')::boolean,false),clock_timestamp())
  on conflict(id) do update set name=excluded.name,subject=excluded.subject,age_label=excluded.age_label,teacher_ids=excluded.teacher_ids,
    accompanist_ids=excluded.accompanist_ids,students=excluded.students,weekly_hours=excluded.weekly_hours,starts_on=excluded.starts_on,
    archived=excluded.archived,updated_at=excluded.updated_at returning * into saved;
  return to_jsonb(saved);
end;
$$;

revoke all on function public.get_paid_journal(text,date), public.save_paid_lesson(jsonb,timestamptz), public.save_paid_course(jsonb,timestamptz) from public, anon;
grant execute on function public.get_paid_journal(text,date), public.save_paid_lesson(jsonb,timestamptz), public.save_paid_course(jsonb,timestamptz) to authenticated;
commit;
