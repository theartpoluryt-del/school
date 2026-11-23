-- Run after restoring the application schemas with --no-privileges.
-- Preserve RLS policies from the dump and expose only the existing application API.
begin;
revoke all on all tables in schema public from public,anon,authenticated;
revoke all on all functions in schema public from public,anon,authenticated;
grant usage on schema public to anon,authenticated,service_role;
grant select on public.school_profiles to authenticated;
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
