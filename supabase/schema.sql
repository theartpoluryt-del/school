-- Journal of the music school: initial Supabase schema.
-- Run this file in Supabase Dashboard -> SQL Editor.

create table if not exists public.school_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null,
  role text not null default 'Преподаватель',
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.school_state (
  id uuid primary key default gen_random_uuid(),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create or replace function public.is_school_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select is_admin
    from public.school_profiles
    where id = auth.uid()
  ), false);
$$;

alter table public.school_profiles enable row level security;
alter table public.school_state enable row level security;

revoke all on table public.school_profiles from anon, authenticated;
revoke all on table public.school_state from anon, authenticated;

grant select on table public.school_profiles to authenticated;
grant select, update on table public.school_state to authenticated;
grant insert on table public.school_state to authenticated;

create policy "School members can read profiles"
on public.school_profiles for select
to authenticated
using (true);

create policy "School members can read the shared journal"
on public.school_state for select
to authenticated
using (true);

create policy "School members can create the first journal state"
on public.school_state for insert
to authenticated
with check (auth.uid() = updated_by);

create policy "School members can update the shared journal"
on public.school_state for update
to authenticated
using (true)
with check (auth.uid() = updated_by);

create or replace function public.set_school_state_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists school_state_updated_at on public.school_state;
create trigger school_state_updated_at
before insert or update on public.school_state
for each row execute procedure public.set_school_state_timestamp();

-- Create the first administrator in Authentication -> Users, then run:
-- insert into public.school_profiles (id, username, display_name, role, is_admin)
-- values ('AUTH_USER_UUID', 'admin', 'Администратор школы', 'Администратор', true);
