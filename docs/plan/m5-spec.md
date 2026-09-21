# M5 spec — reminders and project lifecycle (approved 2026-09-21)

Rules: REQUIREMENTS.md §13 「提醒（M5，2026-09-21 问答）」 and the lifecycle lines after it, plus §6/§7 and the 前置任务 / 没人负责 lines. Mockups: `scratchpad/m5mock/project/*.dc.html` (generator `scratchpad/m5mock/gen9.py`, published at https://claude.ai/artifact/8tqZcUatYapVtBNc6QT4uu). Conventions as in M3/M4: writes inside `lockAsMember` under the project `FOR UPDATE` lock, `notify` / `recordEvent` / `bumpPackages` from services/notify.ts, services take `now` last, no write-then-throw, zh + en, no gendered pronouns (name or TA / they).

M5 is **in-app only**. Push and Discord/Telegram come later (M9); keep the quiet-hours rule in mind (store nothing for it yet) and send every reminder into the app immediately.

## 1. Tick engine (server)

- `runTick(db, now)` in `services/tick.ts`: one pass over every live project, idempotent, safe to run concurrently with itself (take the project lock per project; skip locked projects with `SKIP LOCKED` or a short timeout). Each job below is a separate function taking `(db, now)` so tests call them directly.
- **Dedupe**: a new table `ReminderLog { key String @id, projectId, createdAt }` (cascade on project). A reminder is sent only if `INSERT … ON CONFLICT DO NOTHING` inserted its key, inside the same transaction as the notification. Keys include what makes a reminder "new" (R16-1):
  - due soon: `due24:<taskId>:<ownerMemberId or none>:<effectiveDue ISO>` → a later due date or another owner gives a new key; an earlier due date too.
  - overdue: `overdue:<taskId>:<effectiveDue ISO>`.
  - weekly: `weekly:<projectId>:<ISO date of that Sunday in the project tz>`.
  - lifecycle: `pdue:<projectId>:<deadline ISO>`, `autoend-soon:<projectId>:<deadline ISO>`, `del3:<projectId>:<purgeAfter ISO>`, `del1:…`.
  - prereq blocked: `blocked3:<waitingTaskId>:<prereqTaskId>:<prereq effective due ISO>`.
- **Trigger**: `POST /api/internal/tick` with header `Authorization: Bearer <CRON_SECRET>` (env; route absent when unset); returns counts per job. Production will call it every 10 minutes from a GitHub Actions schedule (public repo → free) — write `.github/workflows/tick.yml` (schedule `*/10 * * * *`, `workflow_dispatch`, curl with the secret and `TICK_URL` from repository secrets; skip when they are unset) but it only does something once deployed (Phase D). Dev: `src/dev.ts` runs `runTick` every 60 s in-process.
- Move the lazy per-request work into the tick and keep the request path cheap: `expireDueSwaps` (all projects) and `purgeDeletedProjects` (all) run in the tick; the lazy calls in home / cache-tokens stay as a fallback but must not do more than today.
- **Time machine (dev only)**: a server clock with an offset — `lib/clock.ts` `clock.now()` used by routes instead of `new Date()` (grep and replace in routes/services entry points; services still take `now`). `POST /api/dev/time-machine { offsetMs | advanceMs | reset }` and `GET /api/dev/time-machine` (behind the existing dev gate: `DEV_LOGIN=true` + `APP_ENV=development`, never in production) change the offset and run one tick right away. Tests keep passing `now` explicitly.

## 2. Reminder jobs (all in-app notifications)

Effective due = `task.dueAt ?? project.deadline`. Only ACTIVE projects (not DRAFT, not deleted) for task reminders; unfinished = not `isFinished` (HALF counts as finished). A task in REVIEWING is not overdue (M4).

| Job | When | To | Type (new enum values) | Text (zh; en to match) |
|---|---|---|---|---|
| Due soon | `now >= due − 24h` and `due − now >= 1h`, unfinished, status not REVIEWING, has an active owner | owner, ONLY_YOU | `TASK_DUE_SOON` | 「你的『{task}』<b>{明天 23:59 / 今天 18:00}</b> 到期，还没交。」 + 打开任务 |
| Due soon, handed in | same window, status REVIEWING | leader, ONLY_LEADER (not when the leader is the owner — they self-grade) | `TASK_DUE_REVIEW` | 「『{task}』{明天} 到期，<b>{owner}</b> 已经交了，还在等你评。」 + 去评级 |
| Due soon, no owner | same window, unfinished, no active owner | leader, ONLY_LEADER | `TASK_OWNERLESS_SOON` | 「『{task}』{明天} 到期，还没人负责。」 + 移给谁 |
| Overdue | `now >= due`, unfinished, not REVIEWING, has an active owner | all active members, GROUP (the owner's copy `mine: true`) | `TASK_OVERDUE` | rotating roast template (below); if the task waits for an unfinished prereq, append 「（TA 在等 {prereqOwner} 的『{prereq}』）」 |
| Overdue, no owner | `now >= due`, unfinished, no active owner | all active members, GROUP | `TASK_OWNERLESS_OVERDUE` | 「『{task}』过期了，一直没人认领。」 |
| Blocked 3 days | the waiting task is unfinished, its prereq is unfinished and `now >= prereqDue + 3 days` | leader, ONLY_LEADER | `PREREQ_BLOCKED` | 「『{waiting}』被『{prereq}』卡了 {n} 天，要不要延后？」 + 一键延后 / 看任务; payload carries `waitingTaskId`, `prereqTaskId`, `blockedDays` |
| Weekly | Sunday 20:00 in the project tz (the first tick at or after it, same Sunday), ACTIVE or AWAITING_CONFIRM | each active member with `weeklyEnabled`, GROUP | `WEEKLY_SUMMARY` | 「<b>{tag} 这周</b>：完成 {n} 个任务（+{pts} 分），全组 {total} / 100 分；过期 {m} 个；下周要交 {k} 个。<b>{top}</b> 这周最多（+{x} 分）。」 — omit parts that are zero except the total; "这周" = the 7 days ending now; top = most points finished this week (none → omit) |

Roast templates (index = a stable hash of the task id modulo 5, so each task keeps its line; zh, en equivalents in the same tone, name or TA/they only):
1. 「🐢 {name} 的『{task}』过期了，TA 可能还在路上…」
2. 「⏰『{task}』的截止时间过了，{name} 还没交。大家帮 TA 加加油？」
3. 「🫠 大家等『{task}』等到过期了，{name} 快冲！」
4. 「📣 过期提醒：{name} 的『{task}』还差最后一步。」
5. 「🧃『{task}』过期了，{name} 要不要先喝口水，再一口气交掉？」
Store the template index in the payload (the app renders the text; the emoji is part of the template).

## 3. Project lifecycle

- **Deadline passes** (`now >= deadline`, ACTIVE): the tick sets `AWAITING_CONFIRM`, records `awaitingSince = deadline`, and notifies the leader `PROJECT_DUE` 「{tag} 截止日期到了。作业交了就按『结束项目』；<b>{autoEndDate}</b> 前没处理会自动结束。」 (+ 结束项目). While AWAITING_CONFIRM everything still works (evidence, grading, edits) — only a banner changes.
- **Auto-end soon**: `now >= deadline + 6 days` → leader `PROJECT_AUTO_END_SOON` 「{tag} <b>明天</b>会自动结束。作业交了可以现在就按结束；还没交可以延后截止日期。」.
- **Auto-end**: `now >= deadline + 7 days` and still AWAITING_CONFIRM → end it (below) with `endedAuto = true`, notify all `PROJECT_ENDED` with `auto: true` 「组长 7 天没处理，{tag} 自动结束了。{deleteDate} 会彻底删除，在那之前可以看结果、下载报告。」.
- **Leader ends** `POST /api/projects/:id/end` (leader; ACTIVE or AWAITING_CONFIRM): status ENDED, `endedAt = now`, `endedById`, `purgeAfter = now + 14 days`; voids pending swaps (void reason `PROJECT_ENDED`); notifies all others `PROJECT_ENDED` 「组长 <b>{leader}</b> 结束了 {tag}。{deleteDate} 会彻底删除，在那之前可以看结果、下载报告。」; activity `PROJECT_ENDED`.
- **Deadline extended** while AWAITING_CONFIRM to a date after now → back to ACTIVE (the existing deadline-change path; reminders re-arm through the keys).
- **Frozen when ENDED**: every mutation → 409 `PROJECT_ENDED`, except grading an attempt that is PENDING (grade / grade-outside is refused; only `grade` of a PENDING attempt), reading, leaving the project, reopening, and the leader's delete-for-everyone. Invite code joins refused (`PROJECT_ENDED`). GETs work; views expose `status`, `endedAt`, `endedAuto`, `purgeAfter`, `awaitingSince`, `autoEndAt`.
- **Reopen** `POST /api/projects/:id/reopen { deadline? }` (leader, ENDED, `now < purgeAfter`): if the current deadline is `<= now`, `deadline` is required and must be after now (and follows the usual deadline rules: task dates re-spread as in the existing deadline change) → else 400 `DEADLINE_REQUIRED`/`DEADLINE_PAST`. Status ACTIVE, clears `endedAt`/`endedById`/`endedAuto`/`purgeAfter`; notifies all `PROJECT_REOPENED` 「组长 <b>{leader}</b> 重新打开了 {tag}，新的截止日期 {date}。」; activity `PROJECT_REOPENED`.
- **Deletion reminders**: `now >= purgeAfter − 3 days` → all `PROJECT_DELETE_SOON` (days 3); `purgeAfter − 1 day` → days 1. 「{tag} <b>{n} 天后</b>会彻底删除，记得下载贡献报告。」
- **Purge**: ended projects with `purgeAfter <= now` are deleted by the tick with their files (reuse `purgeDeletedProjects` logic: generalise it to both soft-deleted and ended projects). Badges don't exist yet (D7); leave a TODO where they must be preserved.
- Soft-deleted projects keep their M4 behaviour (deletedAt/purgeAfter from leader delete); an ended project that is also soft-deleted is purged at the earlier date.
- Schema: `Project.awaitingSince DateTime?`, `endedAt DateTime?`, `endedById String?` (Member, SetNull), `endedAuto Boolean @default(false)`; reuse `purgeAfter` for both deletion kinds. New enum values for NotificationType (the types above plus `PROJECT_ENDED`, `PROJECT_REOPENED`, `PROJECT_DELETE_SOON`, `PROJECT_DUE`, `PROJECT_AUTO_END_SOON`, `TASK_DELAYED`), ActivityType (`PROJECT_ENDED`, `PROJECT_REOPENED`, `TASK_DELAYED`), SwapVoidReason `PROJECT_ENDED`, error codes in shared/api.ts. Migration `m5_lifecycle`.

## 4. One-tap delay

- `POST /api/projects/:id/tasks/:taskId/delay { dueAt }` (leader, task unfinished): sets the task's due date like the existing leader due-date edit (sets `leaderDueAt`), capped at the project deadline (400 `AFTER_PROJECT_DEADLINE` if later), must be after the current effective due. Notifies the owner `TASK_DELAYED` 「组长把你的『{task}』延后到 <b>{date}</b>（在等『{prereq}』）。」 when it came from a blocked task (payload `prereqTaskId` optional). Activity `TASK_DELAYED`. The app's DelaySheet default = current due + `blockedDays` (from the PREREQ_BLOCKED payload or recomputed), chips +1 / +3 (blocked days) / +7, never past the project deadline.
- Returns the task detail view (so the cache updates).

## 5. App

- **Notifications** (`features/notifs/describe.ts` + i18n): every new type with emoji/colour as in the NotifsM5 mockup, action buttons: 打开任务, 去评级, 一键延后 (opens DelaySheet on the task page or directly), 看任务, 移给谁 (task page with the move sheet), 结束项目 (EndSheet), 看项目, and **发到 WhatsApp** on `TASK_OVERDUE`, `TASK_OWNERLESS_OVERDUE`, `WEEKLY_SUMMARY`: a soft small button with the WhatsApp glyph (inline SVG of the official glyph, WhatsApp green #25D366 on the icon only; label 「发到 WhatsApp」/"Send to WhatsApp") that opens `whatsapp://send?text=<encoded plain text>` on Android (fallback `https://wa.me/?text=…`), `https://wa.me/?text=…` on web. The text is the notification text without markup plus the project tag; never includes links to private data.
- **Project page**: lifecycle card under the hero (DueLeader / DueMember / Ended mockups): AWAITING_CONFIRM leader → 「截止日期到了，作业交了吗？」 + 结束项目 + 延后截止日期 (opens the existing project info / deadline editor) + auto-end date line; member → 「截止日期到了」 waiting text. ENDED → 「🏁 项目已结束 · {date}」 / 自动结束 wording, delete date and days left, 下载贡献报告 (disabled, DevNote M11), leader 重新打开. When ENDED: 「已结束，只能看」 line above the packages; every mutating control hidden (start, evidence, submit, grade except PENDING attempts for the leader, add task, move, resplit, swap, pick, invite, settings edits); the task page shows the frozen note instead of actions.
- **EndSheet** and **ReopenSheet** per mockups (ReopenSheet uses the existing DatePickerSheet; the date must be after today; if the deadline is still in the future the date row is optional, prefilled). Settings page: the 结束项目 danger card becomes active (was a DevNote) and opens EndSheet; when ENDED it shows 重新打开.
- **Home** cards: chips 「📮 等你确认已交」 (leader) / 「📮 等组长确认」 (member) while AWAITING_CONFIRM; 「🏁 已结束」 / 「🏁 自动结束」 with 「{date} 删除 · 还有 {n} 天」.
- **DelaySheet** per mockup, from the PREREQ_BLOCKED notification and from the task page of a blocked task (leader only).
- **Time machine** (dev only, `__DEV__` and the server's dev gate): a section on the 我 page dev area / dev gallery: shows the server's current offset and time, buttons +1 小时, +1 天, +7 天, 到下个周日 20:05, 重置, each calling the dev endpoint (which runs a tick) and then revalidating caches.
- i18n zh + en for everything; the no-pronoun rule.

## 6. Tests (server)

Per job with injected `now`: fires once; not again on the next tick; re-arms after a later due date / new owner; immediate reminder for a task assigned 5 h before due; none when < 1 h left; REVIEWING goes to the leader; ownerless variants; roast template stable per task; blocked-3-days; weekly at Sunday 20:00 in a non-UTC tz (and DST-free Asia/Kuala_Lumpur plus one tz with DST, e.g. Europe/London) — once per Sunday; opt-out by `weeklyEnabled=false`. Lifecycle: deadline → AWAITING_CONFIRM + PROJECT_DUE; +6 days reminder; +7 days auto-end; leader end; frozen mutations (sample every route family) and the PENDING-grade exception; reopen rules; delete reminders; purge with files. Concurrency: two ticks at once send each reminder once. Tick endpoint auth. Time machine only under the dev gate.

## Out of M5

Push notifications, Discord/Telegram, quiet hours storage (M9); the contribution report PDF (M11); badges (D7); AI anything (M6).
