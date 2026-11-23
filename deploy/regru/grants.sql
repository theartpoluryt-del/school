-- Run after restoring the application schemas with --no-privileges.
-- Preserve RLS policies from the dump and expose only the existing application API.
begin;
-- GoTrue's initial migrations install legacy helpers; PostgREST supplies JSON claims.
create or replace function auth.uid() returns uuid language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
create or replace function auth.role() returns text language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role') $$;
create or replace function auth.jwt() returns jsonb language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
create or replace function auth.email() returns text language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claim.email',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'email') $$;
alter function auth.uid() owner to school_auth;
alter function auth.role() owner to school_auth;
alter function auth.jwt() owner to school_auth;
alter function auth.email() owner to school_auth;
create extension if not exists "uuid-ossp" with schema extensions;
revoke all on all tables in schema public from public,anon,authenticated;
revoke all on all functions in schema public from public,anon,authenticated;
grant usage on schema public to anon,authenticated,service_role;
grant select on public.school_profiles to authenticated;
grant execute on function public.is_school_admin() to authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on function public.get_school_context() to authenticated;
grant execute on function public.save_school_context(jsonb,timestamptz) to authenticated;
grant execute on function public.save_school_changes(jsonb,uuid) to authenticated;
grant execute on function public.claim_password_change_prompt() to authenticated;
grant execute on function public.school_absence_action(text,jsonb) to authenticated;
grant execute on function public.get_paid_journal(text,date) to authenticated;
grant execute on function public.save_paid_course(jsonb,timestamptz) to authenticated;
grant execute on function public.save_paid_lesson(jsonb,timestamptz) to authenticated;
grant execute on function public.get_accompanist_access() to authenticated;
grant execute on function public.get_accompanist_journal(text,date) to authenticated;
grant execute on function public.save_accompanist_lesson(jsonb,timestamptz) to authenticated;
grant execute on function public.admin_sync_employee_username(uuid,text) to service_role;
revoke all on schema school_sync,school_account from public,anon,authenticated;
revoke all on all tables in schema school_sync,school_account from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
