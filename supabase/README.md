# Software MVP setup - development only

The `/software/` route uses Supabase for authentication and shared data. Until it is configured, the page shows a setup message. The existing `/` hardware demo remains separate. Core workflows and database checks have been exercised with fictional accounts against a development Supabase project. Do not use real college or participant data until access controls, provisioning, privacy requirements, and institutional approval have been checked.

After a successful build, `Start Sygnetta Preview.cmd` in `web/` serves the exported site at `http://127.0.0.1:3000/software/`. The public site introduces CampusPulse. Faculty availability requires an active institution account. The old fictional screens remain in `demo/` and are not part of the exported site.

## Configure a new development project

1. Create a Supabase project in your own account. Choose the region and authentication settings appropriate to your institution. Keep the database password, service role key, and other secrets private: never put them into the app, Git, or chat.
2. Review and apply the SQL files in `migrations/` in numerical order in the development project's SQL editor. The initial migration is intended for an empty project; do not apply it blindly to an existing database.
3. Copy `.env.example` to `.env.local` in `web/`. Fill in the project's public URL and public anon/publishable key from the Supabase project. These public values are shipped to browsers; they do not replace database authorization. Never use a secret or service-role key here. Rebuild the static site after changing public variables.
4. Configure authentication for a controlled development environment. Create test users through Supabase Auth and add corresponding rows in `public.profiles` using a trusted administrator connection. Create an institution first; set each profile's `id` to its Auth user UUID, `institution_id` to that institution, and role to `student` or `faculty`. Only provision fictional test accounts until approvals are in place. Do not grant users the ability to modify their own roles or institution.
5. Start the app and visit `/software/`. Sign in with the test account. Use a faculty account to set availability and a student account to request a meeting; respond using the faculty account and check the student's updates.

Example administrative setup (substitute the real development Auth UUIDs; do not place credentials in this SQL):

```sql
insert into public.institutions (name) values ('Example campus') returning id;
-- Use the returned institution UUID and existing Auth user UUIDs:
insert into public.profiles (id, institution_id, role, name, department)
values
  ('STUDENT_AUTH_UUID', 'INSTITUTION_UUID', 'student', 'Example Student', 'Computer Science'),
  ('FACULTY_AUTH_UUID', 'INSTITUTION_UUID', 'faculty', 'Example Faculty', 'Computer Science');
```

## Current behavior and gaps

- Sign-in now links to password reset at `/software/reset/`; recovery emails return to `/software/recover/`. The screens passed mocked browser checks and a subsequent real controlled-campus-mailbox recovery test on sygnetta.vercel.app. Signup confirmation, reset delivery, password update, old/new password behavior and reused-link rejection passed; broader campus delivery, natural expiry and cross-device recovery remain unverified. Follow the [software operations runbook](../../docs/software-pilot-runbook.md) before participant use.
- Full workspace refreshes time out after eight seconds. The app revalidates the current active profile before retaining cached campus data; profile-read failures block the workspace with retry. This complements server-side authorization; a real controlled student existing-session deactivation/reactivation test subsequently passed. Other roles and administrator-UI coverage remain incomplete.

- Faculty choose Available, Busy, or Away; their next status lasts for the duration selected in Availability settings. The default is one hour, and the selection is currently browser-session state. Expired statuses show as unknown. Availability means willingness to meet, not proof of presence.
- Students search a directory, send requests, view responses, and cancel eligible requests. Faculty respond to pending requests. While the tab is visible, availability refreshes approximately every five seconds and request updates refresh approximately every 30 seconds; returning to the tab also refreshes the app. No email or push notification is implemented.
- Faculty can add and remove recurring office hours after the office-hours migration is applied. Times carry the faculty device's time-zone identifier and are shown as entered. Office hours are informational and do not override live status or guarantee availability; holidays and exceptions are not supported.
- After the administrator migration, an active administrator can edit existing institution-scoped profiles, roles, and access. Campus-email signup is available for local testing, but confirmed users still need a trusted administrator to create their campus profile; there is no automatic role assignment or institution identity integration. Administrators can see basic aggregate usage counts after migration 005.
- After the scheduled-status migration, faculty may schedule one upcoming status change. A manually set status after the scheduled start takes precedence, and expiry results in an unknown status rather than reviving an older status. The migration and database check passed, and the founder confirmed that a scheduled status appeared in the student interface.
- Migration 005 adds aggregate administrator counts, audit events with no meeting text, and adding a profile for a confirmed, existing Auth account. The founder reported that the migration and database check passed and that the administrator screen opens with a fictional account.
- Migration 006 tightens notification isolation if a profile changes institutions; the founder reported that its migration and two-institution check passed. Migration 007 adds an atomic CSV import for up to 100 already-created, confirmed Auth accounts; the founder reported its migration and access check passed. A fictional account was successfully imported through the app against the development project. The CSV import does not create Auth accounts or send invitations.
- Migration 009 removes anonymous execute grants on application functions and direct access to audit trigger functions. Authenticated app RPCs retain their execute grants and must enforce role/institution checks. The database regression checks passed after it was applied.
- Before a real pilot, test tenant isolation, participant permissions, session behavior, request transitions, rate limits, status expiry, notification delivery, backups/restore, account deactivation, and retention/deletion. Establish a support contact and rollback plan. Apply the institution's security and privacy requirements.
- The founder confirmed the core request and CSV import journeys against the development project. The Phase 1 completion criteria remain unmet until the remaining operational, security, privacy, email-delivery and pilot checks are addressed.

## Voice, timing and retention update

Use the November 2026 feature and maintenance migrations for private voice notes, natural-language timestamps, expiry and 45-day retention. The new creation/response RPCs are create_timed_meeting_request and respond_to_timed_request; older creation/response endpoints are retired for application sessions. Earlier workflow scripts that call retired endpoints are historical. The current live voice/timing/expiry scripts and evidence are listed in the root README and package scripts.

Deploy supabase/functions/meeting-maintenance/index.ts as the meeting-maintenance Edge Function; its platform-provided service key stays server-side. The internal webhook authenticates signed two-minute single-use tickets instead of JWTs. The signer key stays in Vault and is not placed in pg_net request headers. The cron schedule is project-specific and must use the intended project URL. Check check_maintenance_health.sql, Edge execution results and access grants after changes or extension upgrades.

The existing development database has a manually applied older baseline. Do not blindly reapply initial migrations or repair history without an isolated comparison/replay. New migrations are tracked, but isolated baseline replay and backup restore are still open readiness items.
