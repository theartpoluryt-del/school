-- Index prior assessment rows once instead of scanning the full school for
-- every lesson. Keep the first matching ID/employee, as the old LIMIT 1 did.
begin;
set local lock_timeout='3s';
insert into school_sync.function_backups(migration_id,signature,definition)
values('assessment-performance-20261022','public.validate_school_assessments(jsonb,jsonb,text,boolean)',
 pg_get_functiondef('public.validate_school_assessments(jsonb,jsonb,text,boolean)'::regprocedure)) on conflict do nothing;
do $migration$
declare def text:=pg_get_functiondef('public.validate_school_assessments(jsonb,jsonb,text,boolean)'::regprocedure); marker text;
begin
 if strpos(def,'prior_assessments_by_key')>0 then return; end if;
 marker:='declare lesson jsonb; prior jsonb; field text; item record; mark jsonb; marks jsonb;';
 if strpos(def,marker)=0 then raise exception 'Unexpected assessment declarations'; end if;
 def:=replace(def,marker,marker||E'\n prior_assessments_by_key jsonb;');
 marker:=$old$ for lesson in select value from jsonb_array_elements(coalesce(incoming->'records','[]')) loop$old$;
 if strpos(def,marker)=0 then raise exception 'Unexpected assessment loop'; end if;
 def:=replace(def,marker,$new$
 select coalesce(jsonb_object_agg(jsonb_build_array(value->>'id',value->>'employeeId')::text,value order by ord desc),'{}'::jsonb)
 into prior_assessments_by_key from jsonb_array_elements(coalesce(source->'records','[]')) with ordinality x(value,ord);
$new$||marker);
 marker:=$old$  select value into prior from jsonb_array_elements(coalesce(source->'records','[]'))
    where value->>'id'=lesson->>'id' and value->>'employeeId'=lesson->>'employeeId' limit 1;$old$;
 if strpos(def,marker)=0 then raise exception 'Unexpected assessment lookup'; end if;
 def:=replace(def,marker,$new$
  if not (lesson ? 'quarterGrades' or lesson ? 'extraGrades') then continue; end if;
  prior:=case when lesson->>'id' is not null and lesson->>'employeeId' is not null
    then prior_assessments_by_key->jsonb_build_array(lesson->>'id',lesson->>'employeeId')::text end;
$new$);
 execute def;
end $migration$;
commit;
