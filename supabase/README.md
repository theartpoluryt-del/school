# Supabase setup

The website uses Supabase Auth for password verification and checked PostgreSQL functions for journal access. Passwords are never stored in `school_state`, browser storage, exports, or the repository.

## Apply the secure migration

1. Open **Supabase Dashboard → SQL Editor**.
2. Run the complete `supabase/schema.sql` file.
3. Run `supabase/lesson_members.sql` after the base schema (also after rerunning it). This preserves group pupil visibility and server validation of lesson rosters and attendance.
   For an existing deployment, also run `supabase/conflict_response.sql`: version conflicts must return `PT409`, not `40001`, which older PostgREST versions retry indefinitely.
   To update an existing lesson-members validator for dated corrections and pupil grades, run `supabase/journal_corrections.sql` (already included in the current `lesson_members.sql`).
4. Confirm that `get_school_context` and `save_school_context` appear under **Database → Functions**.
5. Confirm that direct access policies for `school_state` are absent.

After `teacher_groups.sql`, run `save_performance.sql` (also after replacing the save function or
lesson validator). It caches participant permissions and indexes historical lesson lookups once per
request instead of rescanning the entire school JSON for each lesson. It preserves validation,
conflict checks and grants. The migration is guarded, transactional and idempotent.
On 2026-09-21 it passed `lesson-members.sql`, `journal-corrections.sql`, `teacher-groups.sql` and
`absences.sql` tests in rolled-back transactions before deployment.

The browser pins Supabase JS 2.116.0 and disables SDK retries: PT409 is handled by the application's
three-way merge, not by repeating the same stale write. Saves have a 20-second request timeout and
a bounded retry budget. A timeout is not an acknowledgement; pending edits remain dirty and logout
is blocked. Print buttons run directly from the user's click. Pending edits can only be printed after
an explicit draft confirmation and carry a draft label; printing never marks data as saved.

The migration is rerunnable. It also removes legacy `password` fields from every employee in the stored JSON.

## Group lesson rosters and person-hours

Each schedule row can store `participantIds` for a subgroup without changing the master group.
Generated journal records snapshot these IDs and their `participantNames`. The journal has no
attendance editor: person-hours multiply lesson duration in 40-minute academic hours by all
distinct pupils in that lesson's roster, irrespective of attendance. Legacy `presentStudentIds`,
`attendanceLessonHours` and `attendanceRecordedAt` no longer affect calculations.
`journalLessonRoster` first honors a dated correction (`rosterOverride: true` with `participantIds`).
Otherwise it uses the explicit subgroup from the exact linked schedule row ahead of
stale journal snapshots, for cells, totals and the printed roster. It never substitutes a different
lesson of the same group. Without an explicit schedule subgroup it falls back to the journal
snapshot, then the individual pupil/group membership. A missing/empty roster is reported, never
counted as a pupil. Person-hours include all lessons in the selected month, including future lessons;
the planned label is informational only. Non-teaching dates are excluded.
Regenerating a journal preserves dated corrections; other records copy the applicable schedule
version's roster. It removes obsolete attendance fields while preserving grades and record IDs. This avoids
the server's legacy attendance-subset check rejecting a smaller subgroup. Archived schedule rows
retain their own subgroups and effective dates. Rendering itself never writes records to the server.

Group lessons store independent `studentGrades` keyed by pupil ID. The group header counts staff
hours once; pupil rows show their own grades and person-hours only. Legacy shared `grade` values
are retained as a separate note, never copied to every pupil. Removing someone from a dated roster
hides but retains their grade, so restoring the pupil restores it. The validator checks grade values,
teacher-scoped pupil access and override types. Grades may be retained for the prior roster or pupils
available for this group, including when grading and correction are saved together; unrelated pupil
grades are rejected. `tests/journal-corrections.sql` verifies these
rules and an actual teacher RPC save/reload in a transaction ending with `ROLLBACK`.

The printed journal date cells show only a grade or a dot. Per-lesson hours, roster labels,
correction notes and the detailed roster appendix are not printed. Subject/instrument headers,
pupil names/classes and the monthly summary columns remain in the form.

Teachers receive minimal identity data for pupils in their assigned groups, not those pupils' other
enrollments. The save RPC rejects unrelated participant IDs, duplicates and attendance outside the roster.
`tests/lesson-members.sql` includes synthetic access tests and a real teacher RPC roundtrip. Run the
whole file: its `BEGIN` / `ROLLBACK` removes the temporary test schedule row. Never replace the rollback with a commit.

## Paid services

Apply `supabase/paid_journal.sql` after the base schema. The separate **Платные услуги** page
uses `paid_school_courses` and `paid_school_lessons`, not the main journal JSON. Import private
rosters directly into the database; never put pupil data in repository seed files.

Each employee maintains their own dated lessons. New lessons snapshot the course roster and
start with empty attendance, empty grades and `completed=false`. Only completed lessons count
toward the monthly teacher-hours total; group size does not multiply it. One hour is 40 minutes.
Future lessons may be scheduled but not marked completed, attended or graded. A course/employee
has one aggregate lesson per date. Attendance and grades are independent for each pupil.

Administrators can manage courses and assigned employees. Read/write RPCs enforce ownership,
roster validity and optimistic concurrency (`PT409`, avoiding PostgREST serialization retries).
Former teachers retain their historical roster only. Removed lessons are soft-deleted and excluded
from totals. Direct table access is revoked and RLS is enabled. Run `tests/paid-journal.sql` to
verify actual save/reload, anonymous/foreign access, conflict handling and admin management;
all test fixtures roll back.

The existing main-journal JSON export does **not** include these separate tables. Database
backups must include both paid tables as well as `school_state` and staff profiles.

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
