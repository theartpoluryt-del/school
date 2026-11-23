-- Target only. The source stays frozen; never run this against the source.
begin;
do $$ declare t record; begin
  if current_database()='postgres' then raise exception 'Refusing to remove the source guard'; end if;
  for t in select n.nspname,c.relname from pg_trigger g join pg_class c on c.oid=g.tgrelid
    join pg_namespace n on n.oid=c.relnamespace where g.tgname='muzjur_migration_freeze' loop
    execute format('drop trigger muzjur_migration_freeze on %I.%I',t.nspname,t.relname);
  end loop;
end $$;
drop function if exists public.muzjur_migration_write_guard();
commit;
