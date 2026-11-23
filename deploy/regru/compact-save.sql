-- Same writer, authorization, conflict checks and receipt; return touched rows only.
begin;
set local lock_timeout='3s';
create or replace function public.save_school_changes_compact(changes jsonb, request_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare result jsonb; applied jsonb:='[]'; op record; saved jsonb;
begin
  result:=public.save_school_changes(changes,request_id);
  for op in select distinct x->>'collection' as collection,x->>'id' as id
    from jsonb_array_elements(changes) x loop
    saved:=null;
    if op.collection='academicPlanVersion' then
      saved:=result->'payload'->op.collection;
    else
      select x into saved from jsonb_array_elements(coalesce(result->'payload'->op.collection,'[]')) x
        where x->>'id'=op.id;
    end if;
    applied:=applied||jsonb_build_array(jsonb_build_object('collection',op.collection,'id',op.id,'after',saved));
  end loop;
  return (result-'payload')||jsonb_build_object('applied_changes',applied);
end;
$$;
revoke all on function public.save_school_changes_compact(jsonb,uuid) from public,anon;
grant execute on function public.save_school_changes_compact(jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
