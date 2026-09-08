-- Use an HTTP conflict, not serialization_failure: older PostgREST versions
-- retry SQLSTATE 40001 indefinitely, even though a stale version cannot succeed.
begin;
do $migration$
declare
  definition text := pg_get_functiondef('public.save_school_context(jsonb,timestamptz)'::regprocedure);
  original text := $old$raise exception 'School state was changed by another user' using errcode = '40001';$old$;
  replacement text := $new$raise exception 'School state was changed by another user' using errcode = 'PT409';$new$;
begin
  if strpos(definition, replacement) = 0 then
    if strpos(definition, original) = 0 then raise exception 'Unknown save_school_context conflict check'; end if;
    execute replace(definition, original, replacement);
  end if;
end;
$migration$;
notify pgrst, 'reload schema';
commit;
