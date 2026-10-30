-- Respect dated course membership when creating lessons; retain saved snapshots.
begin;
insert into school_sync.function_backups(migration_id,signature,definition)
values('paid-roster-dates-20261030','public.save_paid_lesson(jsonb,timestamptz)',
 pg_get_functiondef('public.save_paid_lesson(jsonb,timestamptz)'::regprocedure)) on conflict do nothing;
do $$
declare def text:=pg_get_functiondef('public.save_paid_lesson(jsonb,timestamptz)'::regprocedure);
begin
 if strpos(def,'paid roster dates 20261030')=0 then
  if strpos(def,'roster := coalesce(old_row.students,course.students);')=0 then
   raise exception 'Unknown paid roster implementation';
  end if;
  def:=replace(def,'roster := coalesce(old_row.students,course.students);',$m$
  -- paid roster dates 20261030
  roster := coalesce(old_row.students,(select coalesce(jsonb_agg(s order by ord),'[]'::jsonb)
    from jsonb_array_elements(course.students) with ordinality z(s,ord)
    where coalesce(nullif(s->>'starts_on','')::date,course.starts_on)<=(lesson->>'lesson_date')::date
      and (nullif(s->>'ends_on','') is null or (s->>'ends_on')::date>=(lesson->>'lesson_date')::date)));
  $m$);
  execute def;
 end if;
end $$;
commit;
