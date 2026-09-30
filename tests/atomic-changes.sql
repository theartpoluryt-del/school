-- Run the entire file. All test changes and request receipts roll back.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $test$
declare uid_a uuid;uid_b uuid; a jsonb;b jsonb; row_a jsonb;row_b jsonb; original jsonb; result jsonb;
 ops jsonb; request uuid:=gen_random_uuid(); rejected boolean; after_state jsonb;
begin
 select payload into original from public.school_state order by updated_at desc limit 1;
 select p.id into strict uid_a from public.school_profiles p
 where not p.is_admin and exists(select 1 from jsonb_array_elements(original->'employees') e
   join jsonb_array_elements(original->'schedule') s on s->>'employeeId'=e->>'id'
   where e->>'username'=p.username) order by p.id limit 1;
 select p.id into strict uid_b from public.school_profiles p
 where not p.is_admin and p.id<>uid_a and exists(select 1 from jsonb_array_elements(original->'employees') e
   join jsonb_array_elements(original->'schedule') s on s->>'employeeId'=e->>'id'
   where e->>'username'=p.username) order by p.id limit 1;
 perform set_config('request.jwt.claim.sub',uid_a::text,true);
 a:=public.get_school_context();row_a:=a->'payload'->'schedule'->0;
 perform set_config('request.jwt.claim.sub',uid_b::text,true);
 b:=public.get_school_context();row_b:=b->'payload'->'schedule'->0;
 if a->'patch_save' is distinct from 'true'::jsonb then raise exception 'Incremental saves not enabled'; end if;
 perform set_config('request.jwt.claim.sub',uid_a::text,true);
 ops:=jsonb_build_array(jsonb_build_object('collection','schedule','id',row_a->>'id','before',row_a,'after',row_a||'{"room":"991"}'));
 result:=public.save_school_changes(ops,request);
 if result->>'acknowledged_request_id'<>request::text then raise exception 'Missing receipt'; end if;
 perform set_config('request.jwt.claim.sub',uid_b::text,true);
 result:=public.save_school_changes(jsonb_build_array(jsonb_build_object('collection','schedule','id',row_b->>'id','before',row_b,'after',row_b||'{"room":"992"}')),gen_random_uuid());
 perform set_config('request.jwt.claim.sub',uid_a::text,true);
 -- Stale snapshot, different field on the same row: merge automatically.
 result:=public.save_school_changes(jsonb_build_array(jsonb_build_object('collection','schedule','id',row_a->>'id','before',row_a,'after',row_a||'{"time":"09:10-09:50"}')),gen_random_uuid());
 result:=public.save_school_changes(ops,request);
 if not exists(select 1 from jsonb_array_elements(result->'payload'->'schedule') s where s->>'id'=row_a->>'id' and s->>'room'='991' and s->>'time'='09:10-09:50') then raise exception 'Replay lost independent edit'; end if;
 rejected:=false;
 begin perform public.save_school_changes(jsonb_build_array(jsonb_build_object('collection','schedule','id',row_a->>'id','before',row_a,'after',row_a||'{"room":"993"}')),gen_random_uuid());
 exception when sqlstate 'PT409' then rejected:=true;end;
 if not rejected then raise exception 'Real conflict overwritten';end if;
 rejected:=false;
 begin perform public.save_school_changes(jsonb_build_array(jsonb_build_object('collection','schedule','id',row_b->>'id','before',row_b,'after',row_b||'{"room":"994"}')),gen_random_uuid());
 exception when insufficient_privilege then rejected:=true;end;
 if not rejected then raise exception 'Foreign schedule accepted';end if;
 rejected:=false;
 begin perform public.save_school_changes('[]',request); exception when invalid_parameter_value then rejected:=true;end;
 if not rejected then raise exception 'Request ID reuse accepted';end if;
 select payload into after_state from public.school_state order by updated_at desc limit 1;
 if (select count(*) from jsonb_array_elements(after_state->'records'))<>(select count(*) from jsonb_array_elements(original->'records'))
   or exists(select 1 from jsonb_array_elements(original->'records') r where not after_state->'records' @> jsonb_build_array(r)) then
   raise exception 'Existing journal changed';end if;
 if has_function_privilege('anon','public.save_school_changes(jsonb,uuid)','execute')
   or has_table_privilege('authenticated','school_sync.receipts','select')
   or case when to_regnamespace('school_backup') is not null then has_schema_privilege('authenticated','school_backup','usage') else false end then raise exception 'Private data exposed';end if;
end;
$test$;
set local role authenticated;
do $teacher$
declare ctx jsonb;
begin
 ctx:=public.save_school_changes('[]',gen_random_uuid());
 if ctx->'patch_save' is distinct from 'true'::jsonb then raise exception 'Teacher RPC unavailable';end if;
end;
$teacher$;
reset role;
rollback;
select 'PASS: independent teacher saves, independent fields, idempotent retry, real conflict protection, own-only access, unchanged grades, authenticated role; test changes rolled back' as result;
