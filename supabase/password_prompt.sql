-- One account-wide invitation, independent of browser cache and school JSON saves.
begin;
create schema if not exists school_account;
revoke all on schema school_account from public,anon,authenticated;
create table if not exists school_account.password_invitations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  offered_at timestamptz not null default now()
);
alter table school_account.password_invitations enable row level security;
revoke all on school_account.password_invitations from public,anon,authenticated;
create or replace function public.claim_password_change_prompt()
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare inserted integer;
begin
  if auth.uid() is null or not exists(select 1 from public.school_profiles where id=auth.uid()) then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  insert into school_account.password_invitations(user_id) values(auth.uid()) on conflict do nothing;
  get diagnostics inserted = row_count;
  return inserted=1;
end $$;
revoke all on function public.claim_password_change_prompt() from public,anon;
grant execute on function public.claim_password_change_prompt() to authenticated;
notify pgrst,'reload schema';
commit;
