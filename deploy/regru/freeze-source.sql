-- Final cutover only: drain existing writes and reject subsequent writes.
-- User data is retained. The private guard schema is deliberately not exported.
begin;
set local lock_timeout='8s';
set local statement_timeout='45s';
create schema if not exists school_migration;
revoke all on schema school_migration from public,anon,authenticated;
create table if not exists school_migration.write_guard (
  singleton boolean primary key default true check (singleton),
  frozen boolean not null,
  changed_at timestamptz not null default now()
);
revoke all on school_migration.write_guard from public,anon,authenticated;
insert into school_migration.write_guard(singleton,frozen) values(true,false)
on conflict(singleton) do nothing;

create or replace function public.muzjur_migration_write_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare frozen boolean:=false;
begin
  if to_regclass('school_migration.write_guard') is not null then
    execute 'select frozen from school_migration.write_guard where singleton' into frozen;
  end if;
  if frozen then
    raise exception 'Журнал переносится на новый сервер. Изменения не сохранены. Не закрывайте эту вкладку с правками; после переноса откройте muzjur.ru в новой вкладке.' using errcode='PT503';
  end if;
  return null;
end;
$$;
revoke all on function public.muzjur_migration_write_guard() from public,anon,authenticated;

do $$ declare t record; begin
  for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and n.nspname in ('public','school_sync','school_account','auth')
      and not (n.nspname='auth' and c.relname='schema_migrations')
    order by n.nspname,c.relname loop
    execute format('lock table %I.%I in share row exclusive mode',t.nspname,t.relname);
    if not exists(select 1 from pg_trigger g join pg_class c on c.oid=g.tgrelid
      join pg_namespace n on n.oid=c.relnamespace where n.nspname=t.nspname
      and c.relname=t.relname and g.tgname='muzjur_migration_freeze') then
      execute format('create trigger muzjur_migration_freeze before insert or update or delete or truncate on %I.%I for each statement execute function public.muzjur_migration_write_guard()',t.nspname,t.relname);
    end if;
  end loop;
end $$;
update school_migration.write_guard set frozen=true,changed_at=now() where singleton;
commit;
