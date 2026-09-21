# Hardening plan (security, reliability, performance, privacy)

Source: four read-only audits on 2026-09-19 (summaries in `docs/plan/audit/`), plus the owner's decisions recorded in REQUIREMENTS.md §13 「安全、备份与隐私」 and 「省请求、防爆」. Every item below must be done before the app is opened to real users. Status: ☐ open · ◐ in progress · ☑ done. Phase A done on 2026-09-20 (details: server tests `rules-redos`, `extract-limits`, `security`, `data-hardening`, `points-total`; release steps in `docs/plan/release.md`).

## Phase A — fix now (no product decision needed)

Server robustness
- ☑ A1 ReDoS in the brief parser (`lib/plan/rules.ts` LABEL_TAIL_RE, whitespace runs): rewrite without nested quantifiers, collapse whitespace first, time-budget fuzz test.
- ☑ A2 Decompression bombs in the brief extractor: check the zip central directory (total uncompressed ≤ 20 MB, entry count, ratio) before mammoth; cap PDF pages (~30); run extraction in a worker_thread with resourceLimits (~256 MB) and a hard timeout.
- ☑ A3 Global JSON body limit (~1 MB), overrides only on upload routes.
- ☑ A4 Security headers on the API (secureHeaders, `Cache-Control: no-store` on authenticated JSON); `Content-Security-Policy: sandbox; default-src 'none'` on served files.
- ☑ A5 Dev login hard gate: only with an explicit development flag, never when `VERCEL` is set, refuse to start if enabled in production; dev routes (people, login, task status) behind the same gate; `/dev/gallery` in the app only in `__DEV__`.
- ☑ A6 Project invite codes: ≥ 8 random characters after the prefix; Postgres-backed rate limits (join preview/join, invites, uploads, draft creation, invite-code reset, login later) with a short lockout; quotas (≤ 20 drafts per user, ≤ 30 pending invites per project).
- ☑ A7 Leader self-grading: the leader's own tasks can only be 「合格（组长自评）」 — no grade/override/grade-outside on own tasks (decision 2026-09-19).
- ☑ A8 Link evidence: reject URLs with credentials, display the punycode hostname, re-check http(s) before opening, open with noopener.
- ☑ A9 Legacy Office files served as attachments (not inline).
- ☑ A10 Log redaction for unhandled errors (no user text/emails).

Data integrity & database
- ☑ A11 Points must always sum to 1000: refuse a points edit when the task is the only one; assert the sum in every transaction that writes points; test.
- ☑ A12 Omit `Project.briefText` from every query except the brief endpoints (Prisma global omit + select); cap brief text (~200 KB).
- ☑ A13 Indexes for foreign keys used by deletes and filters (ActivityEvent.actorId, Notification.projectId, Notification.swapId, Task.startedById/featureId/milestoneId, Attempt.submittedById/gradedById, Evidence.addedById, GradeChange.byId, SwapRequest package ids, Project.deletedById, Invite.invitedById).
- ☑ A14 `confirmPlan` in one bulk UPDATE; remove duplicate membership reads per request; auth lookup in one query.
- ☑ A15 Transient DB errors (lock/tx timeout, connection) → 503 `RETRY`; the app retries once.
- ☑ A16 Sessions: sliding expiry, `DELETE /auth/sessions` (sign out everywhere), prune expired; stale 401 after re-login must not sign out the new session.
- ☑ A17 App version: `X-App-Version` on every request; server answers 426 `UPDATE_REQUIRED` below a minimum; the app shows an update screen.
- ☑ A18 Idempotency keys on create endpoints (evidence upload/link, add task, create draft, invites) so retries don't duplicate.
- ☑ A19 Date-only due dates end at 23:59:59.999.
- ☑ A20 Per-project storage cap 20 MB (decision 2026-09-19); site-wide stop before the 1 GB storage limit.
- ☑ A21 Enable Row Level Security on every table (no policies) so Supabase's Data API exposes nothing.
- ☑ A22 Test and reset scripts refuse any non-localhost database URL.

App robustness
- ☑ A23 Request timeouts (≈15 s JSON, ≈120 s uploads) with a TIMEOUT error; sheets can always be closed; sign-out clears locally after ≈3 s.
- ☑ A24 Unknown error codes fall back to a generic message; fix remaining double-submit gaps; the task page never spins forever.
- ◐ A25 Uploads: keep the picked file on failure and offer retry; progress; photos compressed to ≤ 500 KB before upload (decision 2026-09-19). Done except progress: the app shows a spinner, not a percentage.
- ☑ A26 Clear typed-brief drafts and other per-user data on sign-out.
- ☑ A27 Font scaling caps where fixed heights would clip.
- ☑ A28 Unread polling every 5 min, paused when the app/tab is hidden or idle; reuse unread counts returned by other responses.

Build & release
- ☑ A29 Release build fails if the release signing properties are missing (never the debug key).
- ☑ A30 Production builds require an https API URL; cleartext only in debug.
- ☑ A31 Remove unneeded Android permissions (SYSTEM_ALERT_WINDOW, READ/WRITE_EXTERNAL_STORAGE).
- ☑ A32 Map font weights 500→400 and 900→700 (APK −21 MB).
- ☑ A33 `.gitignore`: `*.apk`, `*.aab`, `credentials*.json`.
- ☐ A34 Owner: two offline encrypted backups of the release keystore and its passwords; publish the certificate fingerprint.

## Phase B — request savings (decided 2026-09-19)
- ☑ B1 Client cache with stale-while-revalidate; don't refetch data fetched in the last 30 s; update caches from mutation responses; kept until sign-out. Changed 2026-09-21: no offline reading — the app is blocked at launch without a network, and a banner shows when the connection drops mid-use (writes refused with 「没有网络，连上再试」).
- ☑ B2 Cheap version checks → 304 before loading data: `Project.version` bumped by database triggers, ETag tokens in `services/cache-tokens.ts`; a 304 costs 3 queries instead of 9–20. Plus a general per-user / per-IP rate limit (600 / 1200 requests per 10 min).
- ☐ B3 Load test on the real hosting before release (needs the Phase D deployment).

## Phase C — needs design/mockups first
- ☐ C1 「加入要我同意」 toggle for leaders + pending join requests (mockup first).
- ☐ C2 Account deletion (anonymise), sign out everywhere, download my data (mockup first).
- ☐ C3 Privacy notice + terms in 中文 / English / Bahasa Melayu (draft → owner review → lawyer before public launch); consent at first sign-in.
- ☐ C4 Registration invite codes from the owner (with the real login, M10).

## Phase D — deployment milestone (before any real user)
- ☐ D1 Supabase Storage driver with signed direct upload (Vercel's 4.5 MB body limit); briefs ≤ 4 MB or direct upload.
- ☐ D2 Scheduler (M5): end/auto-end projects, purge 14 days after end and deleted projects after 7 days (rows + files), expire swaps, orphan-file sweep, prune sessions/notifications/drafts.
- ☐ D3 Nightly encrypted backups to a private GitHub repo, 30-day retention, restore runbook tested once (decision 2026-09-19).
- ☐ D4 CI: typecheck + tests + backup + `prisma migrate deploy` + deploy; expand/contract migrations.
- ☐ D5 Monitoring: Sentry free (server + app, scrubbed), uptime monitor on /api/health (also keeps Supabase awake), request ids shown in error toasts; alerts to kengtingtan@gmail.com.
- ☐ D6 Hosting: Vercel region `sin1` next to Supabase Singapore; Supavisor transaction-mode pooler with a small pool; web and API on the same domain (no CORS preflights); CSP and security headers on the web host; https invite links with Android App Links; separate preview database, deployment protection.
- ☐ D7 Badges model before any real purge (badges survive deletion).
- ☐ D8 Breach-notification runbook (PDPA 2024: 72 h).
