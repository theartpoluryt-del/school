-- Real authenticated writer, with every fixture and receipt rolled back.
begin;
set local statement_timeout='30s';
select set_config('request.jwt.claims',jsonb_build_object('sub',(
  select p.id from school_profiles p,school_state st
  where not p.is_admin and exists(select 1 from jsonb_array_elements(st.payload->'employees') e
    join jsonb_array_elements(st.payload->'schedule') s on s->>'employeeId'=e->>'id'
    where e->>'username'=p.username) limit 1),'role','authenticated')::text,true) is not null as actor_set;
set local role authenticated;
do $$
declare ctx jsonb; row_data jsonb; result jsonb; ops jsonb; rid uuid:=gen_random_uuid(); rejected boolean:=false;
begin
  ctx:=get_school_context();row_data:=ctx->'payload'->'schedule'->0;
  if row_data is null then raise exception 'Missing test schedule';end if;
  ops:=jsonb_build_array(jsonb_build_object('collection','schedule','id',row_data->>'id','before',row_data,'after',row_data||'{"room":"991"}'));
  result:=save_school_changes_compact(ops,rid);
  if result ? 'payload' or result->>'acknowledged_request_id'<>rid::text
    or jsonb_array_length(result->'applied_changes')<>1
    or result->'applied_changes'->0->'after'->>'room'<>'991' then raise exception 'Bad compact acknowledgment';end if;
  perform save_school_changes(jsonb_build_array(jsonb_build_object('collection','schedule','id',row_data->>'id',
    'before',row_data,'after',row_data||'{"time":"09:10-09:50"}')),gen_random_uuid());
  result:=save_school_changes_compact(ops,rid);
  if result->'applied_changes'->0->'after'->>'time'<>'09:10-09:50'
    or result->'applied_changes'->0->'after'->>'room'<>'991' then raise exception 'Retry lost a concurrent field';end if;
  begin
    perform save_school_changes_compact(jsonb_build_array(jsonb_build_object('collection','schedule','id',row_data->>'id',
      'before',row_data,'after',row_data||'{"room":"992"}')),gen_random_uuid());
  exception when sqlstate 'PT409' then rejected:=true;end;
  if not rejected then raise exception 'Compact wrapper bypassed conflict checks';end if;
  if has_function_privilege('anon','public.save_school_changes_compact(jsonb,uuid)','execute') then raise exception 'Anonymous access exposed';end if;
end $$;
rollback;
select 'PASS: authenticated compact receipt, current-row retry, conflicts, anonymous denial; all fixtures rolled back' as result;
