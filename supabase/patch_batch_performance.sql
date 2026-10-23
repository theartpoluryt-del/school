-- Buffer each consecutive collection in an indexed JSON object. Rebuild its array
-- once, preserving row order, sequential edits, ownership and conflict semantics.
begin;
set local lock_timeout='3s';
insert into school_sync.function_backups(migration_id,signature,definition)
values('patch-batch-performance-20261022','public.save_school_changes(jsonb,uuid)',
 pg_get_functiondef('public.save_school_changes(jsonb,uuid)'::regprocedure)) on conflict do nothing;
do $migration$
declare def text:=pg_get_functiondef('public.save_school_changes(jsonb,uuid)'::regprocedure);
 marker text; flush_buffer text:=$flush$
 if buffered_collection is not null then
  select coalesce(jsonb_agg(items_by_id->id order by ord),'[]'::jsonb) into items
  from unnest(item_order) with ordinality rows_in_order(id,ord);
  candidate:=jsonb_set(candidate,array[buffered_collection],items);
  buffered_collection:=null;
 end if;
$flush$;
begin
 if strpos(def,'buffered_collection')>0 then return; end if;
 marker:=' me text; admin_access boolean; existing_hash text; request_hash text; result jsonb;';
 if strpos(def,marker)=0 then raise exception 'Unexpected save declarations'; end if;
 def:=replace(def,marker,marker||E'\n items_by_id jsonb; item_order text[]; buffered_collection text;');
 marker:=$old$   collection:=op->>'collection'; row_id:=op->>'id';$old$;
 if strpos(def,marker)=0 then raise exception 'Unexpected operation loop'; end if;
 def:=replace(def,marker,marker||E'\n if buffered_collection is distinct from collection then\n'||flush_buffer||E'\n end if;');
 marker:=$old$   items:=coalesce(candidate->collection,'[]');
   select value into current_value from jsonb_array_elements(items) where value->>'id'=row_id;$old$;
 if strpos(def,marker)=0 then raise exception 'Unexpected current row lookup'; end if;
 def:=replace(def,marker,$new$
   if buffered_collection is null then
    items:=coalesce(candidate->collection,'[]');
    -- Refuse malformed legacy collections rather than silently collapsing IDs.
    if exists(select 1 from jsonb_array_elements(items) x group by x->>'id'
      having x->>'id' is null or count(*)>1) then
      raise exception 'Duplicate or missing row identity in stored collection' using errcode='22023';
    end if;
    select coalesce(jsonb_object_agg(value->>'id',value),'{}'::jsonb),
      coalesce(array_agg(value->>'id' order by ord),array[]::text[])
      into items_by_id,item_order from jsonb_array_elements(items) with ordinality x(value,ord);
    buffered_collection:=collection;
   end if;
   current_value:=items_by_id->row_id;
$new$);
 marker:=$old$     select value into other from jsonb_array_elements(items) x where x->>'employeeId'=merged->>'employeeId'
       and x->>'scheduleId'=merged->>'scheduleId' and x->>'date'=merged->>'date'
       and coalesce(x->>'scheduleSuperseded','false')<>'true' limit 1;$old$;
 -- The original function aliases the JSON scalar as x, not a record.
 if strpos(def,marker)=0 then raise exception 'Unexpected occurrence lookup'; end if;
 def:=replace(def,marker,$new$
     select items_by_id->id into other from unnest(item_order) with ordinality q(id,ord)
       where items_by_id->id->>'employeeId'=merged->>'employeeId'
       and items_by_id->id->>'scheduleId'=merged->>'scheduleId'
       and items_by_id->id->>'date'=merged->>'date'
       and coalesce(items_by_id->id->>'scheduleSuperseded','false')<>'true' order by ord limit 1;
$new$);
 marker:=$old$   select coalesce(jsonb_agg(case when value->>'id'=row_id then merged else value end order by ord)
     filter(where value->>'id'<>row_id or merged is not null),'[]') into items
     from jsonb_array_elements(items) with ordinality x(value,ord);
   if current_value is null and merged is not null then items:=items||jsonb_build_array(merged); end if;
   candidate:=jsonb_set(candidate,array[collection],items);$old$;
 if strpos(def,marker)=0 then raise exception 'Unexpected array reconstruction'; end if;
 def:=replace(def,marker,$new$
   if merged is null then
    items_by_id:=items_by_id-row_id;
    item_order:=array_remove(item_order,row_id);
   else
    items_by_id:=jsonb_set(items_by_id,array[row_id],merged);
    if current_value is null then item_order:=array_append(item_order,row_id); end if;
   end if;
$new$);
 marker:=' -- Validate once, under the same lock and against the current server version.';
 if strpos(def,marker)=0 then raise exception 'Unexpected validation boundary'; end if;
 def:=replace(def,marker,flush_buffer||marker);
 execute def;
end;
$migration$;
commit;
