# Teacher-owned groups

Teachers can use Lists → Add group to select directly assigned active pupils.
New groups belong to the authenticated employee, not a client-selected employee.
Teachers can edit the name, education form and roster of their own exclusive groups.
Imported, shared and administrator-managed groups remain administrator-only.
Existing lesson rosters and grades are snapshots and are not rewritten by group edits.

Apply `supabase/teacher_groups.sql` after the lesson-members and journal-corrections
migrations. The context RPC advertises `teacherGroupsEnabled`; the teacher UI remains
disabled on older backends. The save RPC validates and merges groups before validating
lesson participants. Unknown fields cannot grant ownership or assignments. Omitted
groups are retained, so omission cannot delete history. Existing roster members can
remain when a direct pupil assignment ends; newly added members must be active and
directly assigned to the authenticated teacher.

Run `node --test tests/teacher-groups.test.cjs` and execute
`tests/teacher-groups.sql` on the migrated database. SQL tests roll back all fixture
changes, including real-RPC creation and timetable persistence checks.
