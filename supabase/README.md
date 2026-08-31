# Supabase setup

The website uses Supabase Auth for password verification and checked PostgreSQL functions for journal access. Passwords are never stored in `school_state`, browser storage, exports, or the repository.

## Apply the secure migration

1. Open **Supabase Dashboard → SQL Editor**.
2. Run the complete `supabase/schema.sql` file.
3. Confirm that `get_school_context` and `save_school_context` appear under **Database → Functions**.
4. Confirm that direct access policies for `school_state` are absent.

The migration is rerunnable. It also removes legacy `password` fields from every employee in the stored JSON.

## Create an employee account

1. Create `username@journal.local` in **Authentication → Users** with a strong temporary password.
2. Copy that user's UUID.
3. Add a matching profile:

```sql
insert into public.school_profiles (id, username, display_name, role, is_admin)
values ('AUTH_USER_UUID', 'username', 'Employee name', 'Instrument or position', false);
```

The `username` must match the employee login stored in the journal. Set `is_admin` only for school administrators. Supabase Auth hashes and verifies passwords server-side.

## Administrator credential management

Deploy `supabase/functions/manage-school-user` with JWT verification enabled. The function verifies the signed-in user and checks `school_profiles.is_admin` before using the server-only Auth Admin API. It can change an employee login and reset a password; the service-role key is never sent to the browser.

Passwords cannot be read back from Supabase Auth because only secure password hashes are stored. When access is lost, an administrator generates or enters a new temporary password. The site displays that new password once after a successful reset so it can be handed to the employee.

The `admin_sync_employee_username` database function synchronizes a changed login between `school_profiles` and the employee card in `school_state`. Execute `supabase/schema.sql` before deploying the Edge Function.

## Client configuration

Copy `supabase-config.example.js` to `supabase-config.js` and fill in the project URL and publishable key. A publishable key is safe in a browser client; never add a service-role key or database password to the site.
