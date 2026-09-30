-- Incremental saves. Existing RPC authorization/roster validation stays authoritative.
-- Compatible with old clients: their version-checked save RPC remains unchanged.
begin;
set local lock_timeout='3s';
create schema if not exists school_sync;
revoke all on schema school_sync from public,anon,authenticated;
create table if not exists school_sync.receipts (
 user_id uuid not null, request_id uuid not null, request_hash text not null,
 created_at timestamptz not null default clock_timestamp(), primary key(user_id,request_id)
);
alter table school_sync.receipts enable row level security;
revoke all on all tables in schema school_sync from public,anon,authenticated;

-- SQL NULL means an absent property/row; JSON null remains an actual value.
create or replace function school_sync.merge_value(base jsonb, incoming jsonb, current_value jsonb, field_path text)
returns jsonb language plpgsql set search_path=pg_catalog,pg_temp as $$
declare result jsonb; k text; v jsonb;
begin
 if incoming is not distinct from base then return current_value; end if;
 if current_value is not distinct from base or incoming is not distinct from current_value then return incoming; end if;
 if jsonb_typeof(base)='object' and jsonb_typeof(incoming)='object' and jsonb_typeof(current_value)='object' then
   result:='{}';
   for k in select jsonb_object_keys(base) union select jsonb_object_keys(incoming) union select jsonb_object_keys(current_value) loop
     v:=school_sync.merge_value(base->k,incoming->k,current_value->k,field_path||'/'||k);
     if v is not null then result:=result||jsonb_build_object(k,v); end if;
   end loop;
   return result;
 end if;
 raise exception 'The same field was changed in another session' using errcode='PT409',detail=field_path;
end;
$$;
revoke all on function school_sync.merge_value(jsonb,jsonb,jsonb,text) from public,anon,authenticated;

create or replace function public.save_school_changes(changes jsonb, request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 st public.school_state%rowtype; ctx jsonb; candidate jsonb; op jsonb; collection text; row_id text;
 base jsonb; incoming jsonb; current_value jsonb; merged jsonb; items jsonb; other jsonb;
 me text; admin_access boolean; existing_hash text; request_hash text; result jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if request_id is null or jsonb_typeof(changes) is distinct from 'array' or jsonb_array_length(changes)>30000 then
   raise exception 'Invalid change request' using errcode='22023'; end if;
 select * into st from public.school_state order by updated_at desc limit 1 for update;
 if st.id is null then raise exception 'School state is not initialized' using errcode='55000'; end if;
 me:=public.school_employee_id(st.payload); admin_access:=public.is_school_admin();
 if me is null then raise exception 'Profile is not linked to an employee' using errcode='42501'; end if;
 request_hash:=md5(changes::text);
 select r.request_hash into existing_hash from school_sync.receipts r where r.user_id=auth.uid() and r.request_id=save_school_changes.request_id;
 if existing_hash is not null then
   if existing_hash<>request_hash then raise exception 'Request ID reused with different changes' using errcode='22023'; end if;
   return public.get_school_context()||jsonb_build_object('acknowledged_request_id',request_id);
 end if;
 ctx:=public.get_school_context(); candidate:=ctx->'payload';
 for op in select value from jsonb_array_elements(changes) with ordinality x(value,ord)
   order by case when value->>'collection'='groups' then 0 else 1 end,ord loop
   collection:=op->>'collection'; row_id:=op->>'id';
   if not (op ? 'before') or not (op ? 'after') or collection is null then raise exception 'Invalid change' using errcode='22023'; end if;
   base:=nullif(op->'before','null'::jsonb); incoming:=nullif(op->'after','null'::jsonb);
   if collection='academicPlanVersion' and admin_access and row_id is null then
     merged:=school_sync.merge_value(base,incoming,candidate->collection,'/'||collection);
     if merged is null then candidate:=candidate-collection; else candidate:=jsonb_set(candidate,array[collection],merged); end if;
     continue;
   end if;
   if collection not in ('schedule','records','scheduleArchives','groups','students','employees','holidays')
      or (not admin_access and collection not in ('schedule','records','scheduleArchives','groups')) then
     raise exception 'Collection is not writable' using errcode='42501'; end if;
   if row_id is null or row_id='' or (base is not null and (jsonb_typeof(base)<>'object' or base->>'id' is distinct from row_id))
     or (incoming is not null and (jsonb_typeof(incoming)<>'object' or incoming->>'id' is distinct from row_id)) then
     raise exception 'Invalid row identity' using errcode='22023'; end if;
   items:=coalesce(candidate->collection,'[]');
   select value into current_value from jsonb_array_elements(items) where value->>'id'=row_id;
   -- Never allow ID spoofing against a row hidden by the caller's context.
   if current_value is null and exists(select 1 from jsonb_array_elements(coalesce(st.payload->collection,'[]')) x where x->>'id'=row_id) then
     raise exception 'Row is not accessible' using errcode='42501'; end if;
   if not admin_access then
     if collection='groups' then
       if (incoming is not null and (incoming->>'ownerEmployeeId' is distinct from me or incoming->'assignedEmployeeIds' is distinct from jsonb_build_array(me)))
          or (current_value is not null and (current_value->>'ownerEmployeeId' is distinct from me or current_value->'assignedEmployeeIds' is distinct from jsonb_build_array(me)))
          or incoming is null then raise exception 'Only your own groups can be edited' using errcode='42501'; end if;
     elsif (incoming is not null and incoming->>'employeeId' is distinct from me)
       or (current_value is not null and current_value->>'employeeId' is distinct from me) then
       raise exception 'Only your own lessons can be edited' using errcode='42501'; end if;
   end if;
   if not admin_access and collection in ('schedule','records') and incoming is not null
      and not public.is_school_participant_assigned(candidate,me,incoming->>'studentId')
      and not (current_value is not null and current_value->>'studentId'=incoming->>'studentId') then
     raise exception 'Pupil or group is not assigned to you' using errcode='42501'; end if;
   merged:=school_sync.merge_value(base,incoming,current_value,'/'||collection||'/'||row_id);
   -- Two tabs can independently generate the same occurrence with different UUIDs.
   if collection='records' and current_value is null and merged is not null and merged->>'scheduleId' is not null and merged->>'date' is not null then
     select value into other from jsonb_array_elements(items) x where x->>'employeeId'=merged->>'employeeId'
       and x->>'scheduleId'=merged->>'scheduleId' and x->>'date'=merged->>'date'
       and coalesce(x->>'scheduleSuperseded','false')<>'true' limit 1;
     if other is not null then
       if other-'id'=merged-'id' then continue; end if;
       raise exception 'Lesson occurrence already exists' using errcode='PT409',detail='/records/'||row_id;
     end if;
   end if;
   select coalesce(jsonb_agg(case when value->>'id'=row_id then merged else value end order by ord)
     filter(where value->>'id'<>row_id or merged is not null),'[]') into items
     from jsonb_array_elements(items) with ordinality x(value,ord);
   if current_value is null and merged is not null then items:=items||jsonb_build_array(merged); end if;
   candidate:=jsonb_set(candidate,array[collection],items);
 end loop;
 -- Validate once, under the same lock and against the current server version.
 -- The legacy writer enforces teacher scope, group membership, grades and secrets.
 if candidate is distinct from ctx->'payload' then
   perform public.save_school_context(candidate,st.updated_at);
 end if;
 insert into school_sync.receipts(user_id,request_id,request_hash) values(auth.uid(),save_school_changes.request_id,request_hash);
 result:=public.get_school_context();
 return result||jsonb_build_object('acknowledged_request_id',request_id);
end;
$$;
revoke all on function public.save_school_changes(jsonb,uuid) from public,anon;
grant execute on function public.save_school_changes(jsonb,uuid) to authenticated;

do $migration$
declare definition text; marker text; replacement text;
begin
 -- Old full-context saves must not silently drop historical lessons after a
 -- pupil is reassigned. Existing own lesson identities remain editable; new
 -- identities still require a current assignment and all roster validation.
 definition:=pg_get_functiondef('public.save_school_context(jsonb,timestamptz)'::regprocedure);
 if strpos(definition,'historical_lesson_keys')=0 then
   marker:='  allowed_participant_ids text[];';
   if strpos(definition,marker)=0 then raise exception 'Apply save_performance.sql first'; end if;
   definition:=replace(definition,marker,marker||E'\n  historical_lesson_keys jsonb;');
   marker:='  perform public.validate_school_lesson_members';
   if strpos(definition,marker)=0 then raise exception 'Unknown lesson validator call'; end if;
   definition:=replace(definition,marker,$patch$
  select coalesce(jsonb_object_agg(jsonb_build_array(x->>'id',x->>'employeeId',x->>'studentId')::text,true),'{}')
    into historical_lesson_keys
    from jsonb_array_elements(coalesce(state_row.payload->'schedule','[]')||coalesce(state_row.payload->'records','[]')) x
    where x->>'employeeId'=employee_id;
  perform public.validate_school_lesson_members$patch$);
   marker:='(item->>''studentId'') = any(allowed_participant_ids)';
   if (length(definition)-length(replace(definition,marker,'')))/length(marker)<>2 then raise exception 'Unknown assignment checks'; end if;
   replacement:='((item->>''studentId'') = any(allowed_participant_ids) or historical_lesson_keys ? jsonb_build_array(item->>''id'',item->>''employeeId'',item->>''studentId'')::text)';
   execute replace(definition,marker,replacement);
 end if;
 definition:=pg_get_functiondef('public.get_school_context()'::regprocedure);
 if strpos(definition,'''patch_save''')=0 then
   if strpos(definition,'return jsonb_build_object(''id'', state_row.id,')=0 then raise exception 'Unrecognized context getter'; end if;
   execute replace(definition,'return jsonb_build_object(''id'', state_row.id,','return jsonb_build_object(''patch_save'', true, ''id'', state_row.id,');
 end if;
end;
$migration$;
notify pgrst,'reload schema';
commit;
