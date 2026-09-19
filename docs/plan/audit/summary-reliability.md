# Reliability / data / privacy audit — summary (2026-09-19)
CRITICAL
- C1 no backup plan (Supabase free has none; pauses after 7 idle days) → nightly GitHub Action pg_dump (encrypted) + storage sync, 30-day retention, keep-alive, restore runbook; DECISION: where backups go, who holds the key, retention. Also move scratchpad/gap/*.md planning docs into the repo (docs/plan/).
- C2 evidence storage cannot work on Vercel (Supabase driver not built; 4.5 MB body cap vs 10 MB uploads; briefs too) → signed direct upload to Supabase Storage; site-wide storage meter (1 GB ≈ 20 full projects).
- C3 nothing ends/purges projects on schedule (no ACTIVE→AWAITING→ENDED, lazy purge only) → M5 scheduler before any real users.
- C4 real login missing (M10); dev login fails open when NODE_ENV unset; dev status tool forges grades → allow-list dev login (APP_ENV=development + localhost), exclude dev routes from Vercel bundle.
HIGH
- H1 points can stop summing to 1000 (single-task points edit in active project) — reproduced → refuse edit when no other tasks; assert sum=1000 in every points-writing tx; nightly invariant check.
- H2 no error tracking/logging/alerts → Sentry free (server + app, scrubbed), UptimeRobot on /api/health (also keep-alive), x-request-id shown in error toasts, structured 5xx logs; DECISION: alert email.
- H3 double taps show errors; upload retry duplicates evidence → treat already-in-state codes as success + refetch; Idempotency-Key on uploads/creates.
- H4 no account deletion; naive delete corrupts projects (cascade) → anonymise (Deleted user), keep Member rows, rewrite payload names, sign out everywhere, data export; DECISION: wording/semantics.
- H5 no privacy notice/terms/consent; PDPA: notice in BM + English, purposes, visibility, retention, processors (Supabase/Vercel Singapore), breach runbook (72 h), minors (<18 → parent) → DECISION: 18+ only vs parental consent; BM translation.
- H6 no CI/deploy/migration pipeline; db:reset and tests can wipe a non-local DB → GitHub Action (typecheck, tests, backup, migrate deploy, deploy), expand/contract migrations, refuse non-localhost for reset/tests.
- H7 old APKs break silently → X-App-Version header, 426 UPDATE_REQUIRED + update screen.
MEDIUM
- M1 orphan files, no sweeper (M5).
- M2 no rate limiting; invite code brute force (same as app audit H3).
- M3 lock timeouts / pool exhaustion surface as 500 → map to 503 RETRY; pooler transaction mode, small pool; load test.
- M4 sessions fixed 90 days, never extended/pruned, no sign-out-everywhere → sliding expiry, DELETE all sessions, prune.
- M5 unbounded growth (notifications, events, sessions, pending invites; home loads all tasks) → retention rules, cache home.
- M6 promised features without code/milestone: 申请改截止日期, offline read, calendar export, per-member topics, sample project, badges model must exist before purges; §7 25 MB vs §13 10 MB conflict.
LOW
- 23:59:00 vs 23:59:30 late edge → 23:59:59.999; timezone change doesn't re-anchor date-only dues; no DB-level invariant guards; error logs may contain emails; GitHub username rename conflicts; default API_URL http.
TESTS: no single-task edit test, no property test for sum=1000, no failure-injection, no migration-with-data test, no app tests, no device E2E (Maestro), no CI.

## App-side addendum
HIGH
- A1 no request timeouts (only startup); sheets can't close while busy (Android back no-op), sign-out waits for server → default timeout 15 s JSON / 120 s upload, TIMEOUT code, sign-out clears locally after 3 s.
- A2 offline read-only not built; refetch on every focus; unread polls 60 s (§13 says 5 min) → cache layer (already decided).
- A3 retries duplicate creates (draft, add task, evidence, invites) → idempotency keys.
- A4 uploads > 4.5 MB on Vercel → HTML 413 → BAD_RESPONSE (same as C2).
MEDIUM
- task page spins forever when project request fails ([taskId].tsx:169/179).
- unknown error code → blank toast (44 places t.errors[code]) → fallback INTERNAL.
- double-submit gaps: LinkSheet Enter key, run() in [taskId].tsx no re-entry guard.
- due dates in two zones on one screen (device vs project) → pick one rule.
- 401 silent sign-out without message; late 401 from old token signs out new session.
- no privacy/terms/delete account/export UI; typed brief drafts survive sign-out.
- uploads: no progress, no retry, picked file lost on failure, pickEvidenceFile not in try.
- font scaling: no maxFontSizeMultiplier; fixed heights clip (tab badge, date cells).
- zero app tests.
LOW
- Me toggles race; Button no ref guard; /dev/gallery open to all signed-in users; dev tools shown when API URL is http; corrupt profile cache can stick splash; today/tomorrow labels stale past midnight; LinkButton hit area 42 dp.
