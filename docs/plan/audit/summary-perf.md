# Performance / free-tier audit — summary (2026-09-19, measured on a realistic isolated DB meritai_audit)
Now: ~24 requests & ~1.04 MB DB egress per 5-min session → per DAU/month 1,440 calls, 62 MB egress. First limits hit today: storage 1 GB (~65–80 DAU), Supabase egress 5 GB (~80 DAU).
After fixes: ~11 requests & ~117 KB per session → 660 calls, 7 MB per DAU/month. Capacity: storage ~160 DAU first (≈500 if originals deleted after grading), egress ~460, Vercel CPU ~800, DB 500 MB ~1,300, edge requests ~1,300, invocations ~1,500.
HIGH
- H1 nearly every request reads the whole Project.briefText (70–90% of DB egress; unbounded up to 10 MB) → Prisma global omit briefText, select instead of include project, cap brief text ~200 KB. (S)
- H2 Supabase egress is the first limit (~80 DAU now) → H1 + client cache.
- H3 storage 1 GB → client image compression ≤500 KB, per-project cap 15–20 MB, prefer links, global stop at 900 MB, purge/orphan sweep; DECISION: delete originals after grading (keep text/thumbnails)?
- H4 too many DB round trips, many inside FOR UPDATE (reads 8–21, writes 31–54); confirmPlan 1 UPDATE per task (200 tasks ≈ 46 s at 230 ms RTT → fails) → vercel.json regions sin1 (same as Supabase), remove duplicate membership reads, bulk UPDATE for confirmPlan, relation joins / raw SQL for 3 hot reads.
- H5 web unread polling never stops on a visible idle tab (480/day) → 5 min + pause on blur/idle; use unreadCount from other responses.
- H6 CORS preflight on every web request → serve web and API from the same domain (same Vercel project); at least maxAge 7200.
- H7 serverless DB connections → Supavisor transaction mode 6543, PrismaPg max 3 + short idle, attachDatabasePool; DIRECT_URL session pooler for migrations.
MEDIUM
- M1 duplicate fetches (task page fetches project+task on every focus, reloadProject after writes, unread extra) → cache + update from mutation responses (−55% requests).
- M2 304 must use cheap version checks (Project.version / per-user max(updatedAt)) before loading data.
- M3 missing FK indexes (ActivityEvent.actorId, Notification.projectId, Notification.swapId, Task.startedById/featureId/milestoneId, Attempt.submittedById/gradedById, Evidence.addedById, GradeChange.byId, SwapRequest package ids, Project.deletedById, Invite.invitedById).
- M4 unbounded growth → daily cron: expired sessions, read notifications > 30 days, abandoned drafts > 30 days, purge ended projects, orphans.
- M5 upload sizes vs 4.5 MB (same as C2).
- M6 Vercel active CPU 4 h/month → fewer requests; don't ping /health every minute.
- M7 per-read side work (expireDueSwaps, purgeDeletedProjects) → move to M5 tick.
LOW
- L1 ProjectView waste (nulls, task-page-only fields). L2 auth = 2 queries → 1. L3 APK has 4 Noto Sans SC weights (42 MB) → map 500→400, 900→700 (−21 MB); web immutable cache headers + service worker. L4 rate limiting: Hono in-memory still costs an invocation; Vercel WAF if available on Hobby. L5 load test on Vercel Preview + Supabase with k6/autocannon.
