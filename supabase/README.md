# Supabase setup

The website uses Supabase Auth for password verification and checked PostgreSQL functions for journal access. Passwords are never stored in `school_state`, browser storage, exports, or the repository.

## Apply the secure migration

1. Open **Supabase Dashboard → SQL Editor**.
2. Run the complete `supabase/schema.sql` file.
3. Run `supabase/lesson_members.sql` after the base schema (also after rerunning it). This preserves group pupil visibility and server validation of lesson rosters and attendance.
   For an existing deployment, also run `supabase/conflict_response.sql`: version conflicts must return `PT409`, not `40001`, which older PostgREST versions retry indefinitely.
4. Confirm that `get_school_context` and `save_school_context` appear under **Database → Functions**.
5. Confirm that direct access policies for `school_state` are absent.

The migration is rerunnable. It also removes legacy `password` fields from every employee in the stored JSON.

## Group lesson rosters and person-hours

Each schedule row can store `participantIds` for a subgroup without changing the master group.
Generated journal records snapshot these IDs and their `participantNames`. The journal has no
attendance editor: person-hours multiply lesson duration in 40-minute academic hours by all
distinct pupils in that lesson's roster, irrespective of attendance. Legacy `presentStudentIds`,
`attendanceLessonHours` and `attendanceRecordedAt` no longer affect calculations.
`journalLessonRoster` uses the explicit subgroup from the exact linked schedule row ahead of
stale journal snapshots, for cells, totals and the printed roster. It never substitutes a different
lesson of the same group. Without an explicit schedule subgroup it falls back to the journal
snapshot, then the individual pupil/group membership. A missing/empty roster is reported, never
counted as a pupil. Future lessons show their planned roster but do not contribute person-hours yet.
Regenerating a journal always copies the applicable schedule version's roster and removes obsolete
attendance fields from those regenerated records, preserving grades and record IDs. This also avoids
the server's legacy attendance-subset check rejecting a smaller subgroup. Archived schedule rows
retain their own subgroups and effective dates. Rendering itself never writes records to the server.

Teachers receive minimal identity data for pupils in their assigned groups, not those pupils' other
enrollments. The save RPC rejects unrelated participant IDs, duplicates and attendance outside the roster.
`tests/lesson-members.sql` includes synthetic access tests and a real teacher RPC roundtrip. Run the
whole file: its `BEGIN` / `ROLLBACK` removes the temporary test schedule row. Never replace the rollback with a commit.

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
