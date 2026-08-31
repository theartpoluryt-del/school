-- Secure backend for the school journal.
-- Run the whole file in Supabase Dashboard -> SQL Editor.

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
set search_path = public, pg_temp
as $$
  select coalesce((select is_admin from public.school_profiles where id = auth.uid()), false);
$$;

create or replace function public.strip_school_secrets(source jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select (coalesce(source, '{}'::jsonb) - 'sessionEmployeeId') || jsonb_build_object(
    'employees', coalesce((
      select jsonb_agg(employee - 'password')
      from jsonb_array_elements(coalesce(source->'employees', '[]'::jsonb)) employee
    ), '[]'::jsonb)
  );
$$;

create or replace function public.school_employee_id(source jsonb)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select employee->>'id'
  from public.school_profiles profile
  cross join jsonb_array_elements(coalesce(source->'employees', '[]'::jsonb)) employee
  where profile.id = auth.uid() and employee->>'username' = profile.username
  limit 1;
$$;

create or replace function public.is_school_participant_assigned(source jsonb, employee_id text, participant_id text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from jsonb_array_elements(coalesce(source->'students', '[]'::jsonb)) participant
    where participant->>'id' = participant_id
      and coalesce(participant->'assignedEmployeeIds', '[]'::jsonb) ? employee_id
    union all
    select 1
    from jsonb_array_elements(coalesce(source->'groups', '[]'::jsonb)) participant
    where participant->>'id' = participant_id
      and coalesce(participant->'assignedEmployeeIds', '[]'::jsonb) ? employee_id
  );
$$;

create or replace function public.get_school_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  state_row public.school_state%rowtype;
  clean_payload jsonb;
  employee_id text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not exists (select 1 from public.school_profiles where id = auth.uid()) then
    raise exception 'School profile not found' using errcode = '42501';
  end if;

  select * into state_row from public.school_state order by updated_at desc limit 1;
  if state_row.id is null then raise exception 'School state is not initialized' using errcode = '55000'; end if;
  clean_payload := public.strip_school_secrets(state_row.payload);

  if public.is_school_admin() then
    return jsonb_build_object('id', state_row.id, 'updated_at', state_row.updated_at, 'payload', clean_payload);
  end if;

  employee_id := public.school_employee_id(clean_payload);
  if employee_id is null then raise exception 'Profile is not linked to an employee' using errcode = '42501'; end if;

  clean_payload := clean_payload || jsonb_build_object(
    'activeEmployeeId', employee_id,
    'employees', coalesce((select jsonb_agg(item) from jsonb_array_elements(clean_payload->'employees') item where item->>'id' = employee_id), '[]'::jsonb),
    'students', coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(clean_payload->'students', '[]'::jsonb)) item where coalesce(item->'assignedEmployeeIds', '[]'::jsonb) ? employee_id), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(clean_payload->'groups', '[]'::jsonb)) item where coalesce(item->'assignedEmployeeIds', '[]'::jsonb) ? employee_id), '[]'::jsonb),
    'schedule', coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(clean_payload->'schedule', '[]'::jsonb)) item where item->>'employeeId' = employee_id), '[]'::jsonb),
    'records', coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(clean_payload->'records', '[]'::jsonb)) item where item->>'employeeId' = employee_id), '[]'::jsonb),
    'scheduleArchives', coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(clean_payload->'scheduleArchives', '[]'::jsonb)) item where item->>'employeeId' = employee_id), '[]'::jsonb)
  );
  return jsonb_build_object('id', state_row.id, 'updated_at', state_row.updated_at, 'payload', clean_payload);
end;
$$;

create or replace function public.save_school_context(new_payload jsonb, expected_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  state_row public.school_state%rowtype;
  clean_payload jsonb;
  merged_payload jsonb;
  employee_id text;
  next_updated_at timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into state_row from public.school_state order by updated_at desc limit 1 for update;
  if state_row.id is null then raise exception 'School state is not initialized' using errcode = '55000'; end if;
  if expected_updated_at is not null and state_row.updated_at <> expected_updated_at then
    raise exception 'School state was changed by another user' using errcode = '40001';
  end if;

  clean_payload := public.strip_school_secrets(new_payload);
  employee_id := public.school_employee_id(state_row.payload);
  if employee_id is null then raise exception 'Profile is not linked to an employee' using errcode = '42501'; end if;

  if public.is_school_admin() then
    merged_payload := clean_payload;
  else
    merged_payload := state_row.payload || jsonb_build_object(
      'schedule',
        coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(state_row.payload->'schedule', '[]'::jsonb)) item where item->>'employeeId' <> employee_id), '[]'::jsonb)
        || coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(clean_payload->'schedule', '[]'::jsonb)) item where item->>'employeeId' = employee_id and public.is_school_participant_assigned(state_row.payload, employee_id, item->>'studentId')), '[]'::jsonb),
      'records',
        coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(state_row.payload->'records', '[]'::jsonb)) item where item->>'employeeId' <> employee_id), '[]'::jsonb)
        || coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(clean_payload->'records', '[]'::jsonb)) item where item->>'employeeId' = employee_id and public.is_school_participant_assigned(state_row.payload, employee_id, item->>'studentId')), '[]'::jsonb),
      'scheduleArchives',
        coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(state_row.payload->'scheduleArchives', '[]'::jsonb)) item where item->>'employeeId' <> employee_id), '[]'::jsonb)
        || coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(clean_payload->'scheduleArchives', '[]'::jsonb)) item where item->>'employeeId' = employee_id), '[]'::jsonb)
    );
    merged_payload := public.strip_school_secrets(merged_payload);
  end if;

  update public.school_state set payload = merged_payload where id = state_row.id returning updated_at into next_updated_at;
  return jsonb_build_object('updated_at', next_updated_at);
end;
$$;

create or replace function public.set_school_state_timestamp()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = clock_timestamp();
  new.updated_by = auth.uid();
  new.payload = public.strip_school_secrets(new.payload);
  return new;
end;
$$;

drop trigger if exists school_state_updated_at on public.school_state;
create trigger school_state_updated_at before insert or update on public.school_state
for each row execute procedure public.set_school_state_timestamp();

update public.school_state set payload = public.strip_school_secrets(payload)
where payload <> public.strip_school_secrets(payload);

alter table public.school_profiles enable row level security;
alter table public.school_state enable row level security;
revoke all on table public.school_profiles from anon, authenticated;
revoke all on table public.school_state from anon, authenticated;
revoke all on function public.get_school_context() from public, anon;
revoke all on function public.save_school_context(jsonb, timestamptz) from public, anon;
grant select on table public.school_profiles to authenticated;
grant execute on function public.get_school_context() to authenticated;
grant execute on function public.save_school_context(jsonb, timestamptz) to authenticated;

drop policy if exists "School members can read profiles" on public.school_profiles;
drop policy if exists "School members can read own profile" on public.school_profiles;
drop policy if exists "School members can read the shared journal" on public.school_state;
drop policy if exists "School members can create the first journal state" on public.school_state;
drop policy if exists "School members can update the shared journal" on public.school_state;
create policy "School members can read own profile" on public.school_profiles for select to authenticated
using (id = auth.uid() or public.is_school_admin());

-- Direct school_state access deliberately has no policy and no grant.
-- First admin: create admin@journal.local in Auth, then insert its UUID:
-- insert into public.school_profiles (id, username, display_name, role, is_admin)
-- values ('AUTH_USER_UUID', 'admin', 'Администратор школы', 'Администратор', true);
