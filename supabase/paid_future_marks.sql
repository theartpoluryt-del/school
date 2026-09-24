-- Allow explicit advance marking; retain ownership, roster and stale-write checks.
begin;
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
commit;

