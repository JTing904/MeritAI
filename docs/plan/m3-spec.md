# M3 build spec (v2, reviewed): picking, swapping, packages, members, notifications, project page

Repo: `C:/Users/user/MeritAI/MeritAI`. Read `REQUIREMENTS.md` (Chinese; §3, §5, §13 are the rules; §13 「选包、换包与成员（M3）」 is this milestone) before coding.
Stack: `server/` Hono 4 + Prisma 7.10 (client at `server/src/generated/prisma`; after a schema change run `npx prisma migrate dev --name <x>` AND `npx prisma generate`),
`app/` Expo SDK 57 + expo-router (code under `app/src`), `shared/` pure TS used by both.

Work happens in two stages. **Step 0 (foundation)** lands the schema, the shared contract, shared helpers, stubs and placeholders, so the whole tree typechecks. **Builders** then fill in their own files in parallel. Code against the contract; if the contract is wrong, say so in your report instead of editing it.

Hard rules for every agent:
- Only edit the files your role owns (§12). Need a change elsewhere? Put it in your final report.
- Never commit, push, or touch git. Never print or copy secrets from `.env`.
- Match the surrounding code: 2-space, single quotes in `app/`, double quotes in `server/`, comments only where they explain why.
- Every user-visible string goes through i18n (zh AND en; en is typed against zh). Chinese copy: verbatim from the mockups/prototype where it exists; otherwise the copy in this spec.
- Never use gendered pronouns (他/她/he/she) for people in copy: use the name, 「TA」 / "they", or rephrase.
- Points are integers in TENTHS everywhere (125 = 12.5 分). Display with `formatPoints()` from `shared/planning.ts`.
- Concurrency: every mutation runs in `db.$transaction(..., TX_OPTIONS)` and starts with `lockAsMember(tx, projectId, userId, { leader? })` (services/tx.ts, Step 0): it locks the project row, then re-reads the actor's Member row and re-checks active / not removed / role. Target members are re-read inside the transaction too. Route-level `requireActiveMember`/`requireLeader` only choose 404 vs 403 early; they are never trusted for the write.
- Never write-then-throw inside one transaction (the throw rolls the write back). When a request must fail but still record something (a swap found expired or void), the transaction commits and returns `{ error: code }`; the service throws the AppError after the commit.
- Services take `now = new Date()` as the last parameter so tests can move time.

## 1. Sources of truth

- Mockups batch 2 (M3, approved 2026-09-19): `C:/Users/user/AppData/Local/Temp/claude/c--Users-user-MeritAI-MeritAI/b0c612d8-39c7-43d4-8728-e4401c8bc251/scratchpad/m3mock/project/*.dc.html` — ProjectLeader, NoPackage, PickPending, NotifsM3, SettingsLeader, MoveTask, AssignPackage, Resplit, AddTaskActive, Members, MemberActions. Generator with the exact copy: `.../scratchpad/m3mock/gen3.py`.
- Prototype (approved base design; CSS for `.pkg-row`, `.pcard`, `.band`, `.notif`, `.p-hero`, `.ring`, `.set-row`, `.code-box`, `.leader-tools`, carousel, dots): `docs/prototype/index.html`. Extracted spec: `.../scratchpad/gap/proto.md` — §2.7 toasts, §2.8 confetti, §4.3 notifs, §4.5 project, §4.6 settings, §4.7 pick, §5.2 status emoji, §5.3 notification copy.
- Mockups batch 1 (M2, invite box etc.): `.../scratchpad/m2mock/project/*.dc.html`.

## 2. Business rules (confirmed with the user)

Definitions (Step 0 implements them in `server/src/lib/package-state.ts`; the app gets them precomputed in the views):
- **Finished task**: status DONE or HALF. Finished work never changes hands: no pick, switch, assign, swap, move or re-split re-owns a finished task (only leaving/removal takes it out of the package, still owned by whoever did it).
- **Locked task**: status ≠ TODO or startedAt ≠ null. Locked tasks can't be deleted, re-pointed by hand, or moved by a re-split.
- **Task.startedById** (new column, Member): who started it. Set by 「开始做」 (and later by evidence/commits/marking done, M4). Kept when the task changes hands, cleared when the task is released.
- **Package started** (confirmed 2026-09-19: only your own start counts; REQUIREMENTS §13 开工: 按按钮、交文件、有提交、标记完成, whichever happens first, so finishing counts as starting): the package has a task with `startedById = package.ownerId` that is locked, OR a finished task (DONE/HALF) with `ownerId = package.ownerId` (whoever started it). Getting an unfinished task someone else started (move, or a free package that holds one) does NOT make you started. Every query that feeds `packageStarted` selects `ownerId`. Finishing a task (dev status now; M4 grading/marking done) voids the owner's pending swaps (reason STARTED), as starting does.
- **Release a task** (`releaseTask`): `ownerId = null`, `startedAt = null`, `startedById = null`, DOING → TODO; REVIEWING / FAIL keep their status (M4 decides more). Used when its owner leaves or is removed, and when the leader moves it into a free package.
- **Needs a package**: an active member with no package, except the leader when `leaderManages`.
- **Earned points** of a task: DONE → points; HALF → `Math.round(points / 2)`; else 0. Everything is 0 until M4 grades tasks (except via the dev tool).
- **Lightest package**: smallest sum of task points; tie → lowest index.
- **Overdue task**: not finished and `(dueAt ?? project.deadline) < now`.

Picking (first come, first served):
- A member who needs a package picks a free one → it's theirs; every UNFINISHED task in it with `ownerId = null` gets `ownerId = picker`.
- Someone who has a package may **switch** to a free one while their package is not started (`PACKAGE_STARTED`). Order (Package.ownerId is unique): free the old package first (`ownerId = null`; every UNFINISHED task the switcher owns in it → `ownerId = null`, keeping startedAt/startedById/status, so a task someone else started reaches the next picker still half-done and doesn't count as their start; finished tasks keep their owner), then claim the new one. (Fixed after review: the earlier wording left tasks someone else started owned by the switcher inside a package they no longer held.)
- Leader with `leaderManages` can't pick (`LEADER_ONLY_MANAGES`). Package owned by someone else → `PACKAGE_TAKEN`. Picking your own package → no-op, returns the view.
- A member can't just release a package: only switch or leave.

Swaps (REQUIREMENTS §13):
- A member with a not-started package asks the owner of another not-started package. No own package → `NEEDS_OWN_PACKAGE`; own package started → `PACKAGE_STARTED`; target started → `TARGET_STARTED`; target free or own → 400 VALIDATION.
- At most ONE pending outgoing request per member (`SWAP_LIMIT`). Several people may ask the same person.
- The requester can cancel; the target accepts or declines; others → 403. The leader can't force a swap.
- Expiry: 3 days (`expiresAt = createdAt + 72h`). No cron yet: expire lazily (`expireSwaps`) at the start of every swap mutation, in GET project view, GET notifications and unread-count. Views also treat `expiresAt <= now` as not pending regardless of the stored status.
- A pending request becomes VOID when either side starts a task in their package, switches, is swapped with someone else, leaves or is removed, or when the leader re-splits.
- Every swap status change (EXPIRED, VOID, ACCEPTED, DECLINED, CANCELLED) is a guarded `updateMany({ where: { id, status: "PENDING" } })`; continue (or notify) only when count = 1, else `SWAP_NOT_PENDING`. `voidSwaps` runs `expireSwaps` on the same set first (a swap past its time becomes EXPIRED, not VOID).
- Accept (under the lock): expired → EXPIRED (+ SWAP_EXPIRED) and fail; owners changed or either package started → VOID and fail (both commit, then `SWAP_NOT_PENDING` is thrown). Otherwise swap owners in this order: `A.ownerId = null` → `B.ownerId = X` → `A.ownerId = Y`; then re-own the UNFINISHED tasks by package (`updateMany({ where: { packageId: A, ownerId: X, status: { notIn: FINISHED_STATUSES } } }, ownerId: Y)` and the same for B → X; never by owner alone; finished tasks keep their owner — a second guard, since an owner's finished task makes the package started). Then void every other pending swap involving X or Y (reason SWAPPED_ELSEWHERE).

Leader tools (leader only; 403 FORBIDDEN otherwise):
- **Assign** a free package to a member who needs one (same claim as picking). Target has a package → `ALREADY_HAS_PACKAGE`; target is the managing leader → `LEADER_ONLY_MANAGES`; inactive/unknown → 404. The member may still switch while not started.
- **Move** one task to another package: any unfinished task; finished → `TASK_FINISHED`; same package → 400 VALIDATION. Into an owned package: `ownerId = that owner`, startedAt/status/startedById stay (evidence follows in M4); if that owner started it (so their package is started again), their pending swaps → VOID (reason STARTED, SWAP_VOID as with starting). Into a free package: `releaseTask`. Both owners are notified (never the leader themself).
- **Add a task** to an ACTIVE project: goes into the lightest package; gets exactly the typed points `p` (1–999 tenths); every existing task (finished ones and those of people who left too) is rescaled with `apportion(existing, 1000 - p)` so the total is exactly 1000 (confirmed 2026-09-19). Owner = that package's owner (or null). Number/order = max + 1. Due date optional (`resolveDueAt`; the leader typed it, so also `leaderDueAt`).
- **Re-split**: see §5.
- Editing/deleting tasks of an ACTIVE project stays out of M3 (PATCH/DELETE keep `NOT_A_DRAFT`); M4's task page does it.

Members:
- **Leave** (any member except the leader → `LEADER_MUST_TRANSFER`). **Remove** (leader; not themself → 400 VALIDATION): like leaving plus `removed = true`.
- Leaving/removal, one transaction: `leftAt = now` (+ `removed`); their package becomes free; their finished AND REVIEWING tasks keep `ownerId` (points/grades stay theirs) and get `packageId = null`; every other task they own is released (`releaseTask`) and stays in its package ("没做完的 N 个任务" = that count); their pending swaps → VOID (reason LEFT, `voidedById` = the departing member; never notify an inactive member).
- **Transfer leader** (leader → another active member; self → 400): roles swap. If `leaderManages` was on it turns off (confirmed 2026-09-19): the new leader keeps their package; the old leader becomes a member who needs a package.
- **Team cap**: at most 8 active members. Joining (code or invite) as the 9th, new or returning → `TEAM_FULL` (confirmed 2026-09-19). An already-active member re-joining is a no-op (no event, no notification, no bump). On a real join (row created or reactivated): `joinedAt = now` (also for a returning member), `teamSize = max(teamSize, active count)`, feed JOINED, bump.
- **Package reminder to the leader** (REQUIREMENTS §13): whenever a mutation ends with a member who needs a package while there are 0 free packages (join, pick/switch/assign taking the last free package, transfer turning leaderManages off, a resplit that still leaves someone short), send the leader one MEMBER_NEEDS_PACKAGE for that member (not when the member IS the leader). Dedupe with `Member.packageReminderAt` (new column): send only when null; clear it when the member gets a package.
- `teamSize` after M3 = planned people. A re-split to N packages sets `teamSize = max(2, N + (leaderManages ? 1 : 0))`. For ACTIVE projects `ProjectBasics.packageCount` and `ProjectCard.packageCount` are the real number of Package rows.

Starting a task: M3 adds the endpoint and a simple 「开始做」 button on a temporary task page (M4 builds the real one). Only the task's owner (else 403); sets `startedAt = now`, `startedById = owner`, TODO → DOING; voids the owner's pending swaps (reason STARTED); bump; feed TASK_STARTED. Already started → no-op.

M2 follow-up (confirmed 2026-09-19): **Task.leaderDueAt** (new column): the due date the leader set by hand (manual plan, edit, add). On a project deadline change: tasks with `leaderDueAt` get `dueAt = min(leaderDueAt, new deadline)` (so after an earlier deadline pulled them in, a later deadline gives the leader's date back); tasks whose date the system set (`leaderDueAt = null` and `dueAt = suggestedDueAt`) are spread again; finished tasks keep their date. `adjustedTasks` lists tasks whose dueAt changed. Rules-parsed tasks have `leaderDueAt = null` until the leader edits the date; clearing the date sets both null. Split parts copy `leaderDueAt`.

Out of M3 (tell the user in the report): reminders for ownerless tasks (快到期提醒组长、过期通知全组「没人认领」) need a scheduler → M5 with the other reminders. The leaderboard (排行) comes with scoring in M4.

Confirmations (REQUIREMENTS §13 界面细节): 重新分包, 移出成员 and 转让组长 ask again with `ConfirmSheet`; leaving the project also asks. Picking, switching, swap request/accept/decline/cancel, move, assign and add task do not.

## 3. Data model (Step 0) — migration `m3_packages_members`

```prisma
enum SwapStatus { PENDING ACCEPTED DECLINED CANCELLED EXPIRED VOID }
enum SwapVoidReason { SWITCHED STARTED SWAPPED_ELSEWHERE LEFT RESPLIT }
enum NotificationAudience { GROUP ONLY_YOU ONLY_LEADER }
enum NotificationType {
  SWAP_REQUEST SWAP_ACCEPTED SWAP_DECLINED SWAP_EXPIRED SWAP_VOID
  MEMBER_NEEDS_PACKAGE MEMBER_LEFT MEMBER_REMOVED REMOVED_YOU
  TASK_ADDED TASK_MOVED_IN TASK_MOVED_OUT RESPLIT PACKAGE_ASSIGNED LEADER_TRANSFERRED
}
enum ActivityType {
  PLAN_CONFIRMED JOINED LEFT REMOVED PICKED SWITCHED SWAPPED ASSIGNED
  TASK_ADDED TASK_MOVED TASK_STARTED RESPLIT LEADER_TRANSFERRED
}
Project  + packagesVersion Int @default(0)
Member   + packageReminderAt DateTime?
Task     + startedById String? (Member "TaskStarter", onDelete SetNull) + leaderDueAt DateTime?
model SwapRequest {
  id, projectId (cascade), requesterId, targetId (Members, cascade),
  requesterPackageId String?, targetPackageId String? (Packages, onDelete SetNull; indexes are snapshotted in notification payloads),
  status SwapStatus @default(PENDING), voidReason SwapVoidReason?, voidedById String?,
  createdAt, expiresAt, respondedAt?
  @@index([projectId, status]) @@index([requesterId, status]) @@index([targetId, status])
}
model Notification {
  id, userId (User, cascade), projectId String? (cascade), type NotificationType, audience NotificationAudience?,
  mine Boolean @default(true), payload Json, swapId String? (SwapRequest, SetNull), createdAt, readAt?
  @@index([userId, createdAt, id]) @@index([userId, readAt])
}
model ActivityEvent {
  id, projectId (cascade), actorId String? (Member, SetNull), type ActivityType, payload Json, createdAt
  @@index([projectId, createdAt, id])
}
```
Migration: existing Task rows get `leaderDueAt = dueAt` where `dueAt IS NOT NULL AND (suggestedDueAt IS NULL OR dueAt <> suggestedDueAt)` (a raw UPDATE in the migration SQL).

Bump `packagesVersion` (`bumpPackages`) on every change to packages, owners, members, or a task's packageId / ownerId / status / startedAt / points: pick, switch, assign, swap accept, move, add task, start, dev status, resplit, join, leave, remove, transfer.

## 4. Shared helpers (Step 0)

- `shared/format.ts`: `projectTag(name, shortCode)` and `givenName(fullName)` moved here from `app/src/features/home/format.ts` (which re-exports them). The server uses the same functions.
- `server/src/lib/package-state.ts`: `isFinished`, `isLocked`, `packageStarted(pkg, tasks)`, `needsPackage(member, project, ownsPackage)`, `earnedPoints(task)`, `lightestPackage(packages, tasks)`, `isOverdue(task, project, now)`, `resplitRange(state)` (§5), `releaseTaskData()` (the Prisma update data for a release).
- `server/src/services/tx.ts`: `lockAsMember(tx, projectId, userId, { leader?: boolean }) → { project, member }` (lock, re-read, assertActive for the project, 404 when not an active member, 403 FORBIDDEN when `leader` and not LEADER).
- `server/src/services/notify.ts`: `notify(tx, { userIds, projectId, type, audience, mine?, payload, swapId? })` (one row per recipient; `mine` may be a function of userId; never pass the actor), `recordEvent(tx, { projectId, actorId, type, payload })`, `bumpPackages(tx, projectId)`, `expireSwaps(tx, where, now)` (row by row in id order, guarded update, SWAP_EXPIRED to the requester when count = 1), `voidSwaps(tx, { projectId, memberIds?, all?, reason, voidedById, now, notify })` (expire first; guarded per row; when `notify` and the requester is active and is not `voidedById`, send SWAP_VOID), `remindPackageless(tx, projectId)` (the leader reminder rule in §2).
- `app/src/lib/time.ts`: `relativeTime(iso, labels, now)`: < 1 min 刚刚; < 60 min {m} 分钟前; same calendar day {h} 小时前; yesterday 昨天; same year M月D日; else YYYY年M月D日 (labels in `t.labels.relative`, zh + en).
- `t.labels.status` / `t.labels.statusEmoji` (proto §5.2: TODO ⭕ 待开始, DOING 🔨 进行中, REVIEWING ⏳ 审核中, DONE ✅ 完成, HALF 🌓 拿一半, FAIL ❌ 不通过; overdue 🐢 已过期 wins over TODO/DOING/FAIL).
- `Screen` gets `onEndReached?: () => void` (ScrollView onScroll, throttle 100, fires once when within 200 px of the end until content grows).
- `UnreadProvider` mounted in the root `_layout.tsx` inside SessionProvider (stub in Step 0: count 0; app-notifs implements); `useUnread()` returns `{ count: 0, refresh() {} }` outside a provider.

## 5. Re-split (leader)

- One pure function `planResplit(state, count)` in `services/resplit.ts` is used by both preview and apply. Preview runs inside a transaction with `lockAsMember(..., { leader: true })` and reads the version from the locked row.
- `resplitRange`: `members = active members who should hold a package` (all active, minus the leader when leaderManages); `mustKeep = packages that have an owner or hold a locked task`; `min = max(1, members, mustKeep)`; `max = leaderManages ? 7 : 8`. Outside → 400 VALIDATION.
- Slots: kept packages in index order. N larger → append new free packages. N smaller → drop free packages that hold no locked task, highest index first. Afterwards renumber the kept packages 1..N in their old index order (confirmed 2026-09-19; two-phase update because `(projectId, index)` is unique: shift by +1000 then set).
- Units = every unlocked task in any package plus unlocked ownerless tasks without a package, ordered by (order, number); `group = featureId`. Preload per slot = its locked tasks' points. Tolerance: pour sum(units) like water into the lightest preloaded slots to get a level L; `unavoidable = max(0, max(preload) − L)` (no placement can do better); `tolerance = unavoidable > 20 ? 20 + ceil(unavoidable) : 20`, so one heavy package doesn't break every feature group for nothing while normal re-splits keep 2.0. (Fixed after review: the earlier `max(20, ceil(max(preload) − total/N))` never changed the result.) `balancePackages(units, N, { preload, tolerance })`; `result.packages[p]` maps to slot p.
- Apply: each unit task → its slot's package; `ownerId = that package's owner` (null if free); locked tasks don't move; void ALL pending swaps (reason RESPLIT, no SWAP_VOID — the RESPLIT notification covers it); `teamSize` per §2; bump; `remindPackageless`.
- Notifications: every active member except the leader gets RESPLIT (GROUP, mine true) with their package (new index, old index if it changed, total) or, without a package, the free count. Feed RESPLIT.
- `POST /resplit/preview { count }` → `ResplitPreview`. `POST /resplit { count, version }` → `STALE_PREVIEW` when `version !== packagesVersion`, else applies and returns `ProjectView`.

## 6. API

All JSON envelopes; auth = Bearer via `requireUser`; writes need the project ACTIVE (`assertActive`). Routers: `routes/packages.ts` mounted at `/projects` (pick, assign, swaps create, move, start, resplit — paths don't overlap `projectRoutes`), `routes/swaps.ts` at `/swaps`, `routes/members.ts` at `/projects` (leave, remove, transfer, feed), `routes/notifications.ts` at `/notifications`. Only the ACTIVE branch of `POST /projects/:id/tasks` stays in `routes/projects.ts` (Hono runs the first handler registered for a method+path); Step 0 adds it as a call to `addActiveTask()` from `services/active-tasks.ts`.

| Method | Path | Who | Body → data | Owner |
|---|---|---|---|---|
| GET | /api/projects/:id | member | → `ProjectView` (§7; expires this project's swaps first) | srv-core |
| POST | /api/projects/:id/packages/:packageId/pick | member | → `ProjectView` | srv-packages |
| POST | /api/projects/:id/packages/:packageId/assign | leader | `{ memberId }` → `ProjectView` | srv-packages |
| POST | /api/projects/:id/swaps | member | `{ packageId }` → `ProjectView` | srv-packages |
| POST | /api/swaps/:swapId/accept | target | → `ProjectView` | srv-packages |
| POST | /api/swaps/:swapId/decline | target | → `ProjectView` | srv-packages |
| POST | /api/swaps/:swapId/cancel | requester | → `ProjectView` | srv-packages |
| POST | /api/projects/:id/tasks | leader | ACTIVE: `TaskInput` → `ProjectView` (201); DRAFT unchanged | srv-packages (service) |
| POST | /api/projects/:id/tasks/:taskId/move | leader | `{ packageId }` → `ProjectView` | srv-packages |
| POST | /api/projects/:id/tasks/:taskId/start | task owner | → `ProjectView` | srv-packages |
| POST | /api/projects/:id/resplit/preview | leader | `{ count }` → `ResplitPreview` | srv-packages |
| POST | /api/projects/:id/resplit | leader | `{ count, version }` → `ProjectView` | srv-packages |
| POST | /api/dev/tasks/:taskId/status | dev only; signed in, active member of the task's project (401 / 404 otherwise) | `{ status: 'TODO'\|'DOING'\|'DONE'\|'HALF' }` → `null` (only tasks with an owner AND a package; leaving TODO sets startedAt/startedById = owner and voids swaps like start; TODO clears both; bump) | srv-packages |
| POST | /api/projects/:id/leave | member (not leader) | → `null` | srv-core |
| POST | /api/projects/:id/members/:memberId/remove | leader | → `ProjectView` | srv-core |
| POST | /api/projects/:id/members/:memberId/transfer | leader | → `ProjectView` | srv-core |
| GET | /api/projects/:id/feed?cursor=&limit= | member | → `FeedPage` | srv-core |
| GET | /api/notifications?cursor=&limit=&mine=1 | user | → `NotificationPage` (expires the user's swaps first) | srv-core |
| GET | /api/notifications/unread-count | user | → `{ count }` (expires the user's swaps first) | srv-core |
| POST | /api/notifications/read | user | `{ upToId }` → `{ count }` (marks the user's rows at or after upToId's position in the list order — i.e. `(createdAt, id) <= that row's` — as read; returns the remaining unread) | srv-core |
| GET/POST | /api/join/:code, POST /api/invites/:id/accept | user | existing + TEAM_FULL, `JoinPreview.full` (false when alreadyMember), §2 join effects | srv-core |
| GET | /api/home | user | existing + `ProjectCard.needsPackage`, real packageCount | srv-core |
| POST | /api/projects/:id/confirm | leader | existing + feed PLAN_CONFIRMED | srv-core |
| PATCH | /api/projects/:id | leader | existing; deadline change uses `leaderDueAt` (§2 M2 follow-up) | srv-core |
| PATCH/PUT/POST | draft task routes | leader | existing; set/clear `leaderDueAt` when the leader sets a date | srv-core |

Lists (feed, notifications): newest first, `orderBy: [{ createdAt: "desc" }, { id: "desc" }]`, `limit` ≤ 50 (default 30), `cursor` = last item id, `nextCursor` null at the end.

Errors not covered by a code: swap target free/own, remove/transfer self, move to the same package → 400 VALIDATION; wrong person for accept/decline/cancel/start → 403 FORBIDDEN; unknown or inactive member/package/task/swap → 404.

New error codes (Step 0 adds them to `shared/api.ts` and the app's error dictionary):

| Code | HTTP | zh | en |
|---|---|---|---|
| PACKAGE_TAKEN | 409 | 这个任务包刚被别人选走了 | Someone just took this package |
| PACKAGE_STARTED | 409 | 你已开工，不能换包 | You've started, so you can't switch packages |
| TARGET_STARTED | 409 | 对方已开工，不能互换 | They've started, so you can't swap |
| NEEDS_OWN_PACKAGE | 409 | 先选一个任务包，才能申请互换 | Pick a package first, then you can ask to swap |
| SWAP_LIMIT | 409 | 一次只能申请一个互换，先取消原来的申请 | You can only have one swap request at a time. Cancel the other one first |
| SWAP_NOT_PENDING | 409 | 这个互换请求已经处理过或失效了 | This swap request was already handled or has expired |
| ALREADY_HAS_PACKAGE | 409 | TA 已经有任务包了 | They already have a package |
| LEADER_ONLY_MANAGES | 409 | 只管理的组长不用选任务包 | A leader who only manages doesn't pick a package |
| LEADER_MUST_TRANSFER | 409 | 你是组长，要先把组长转给别人才能退出 | You're the leader. Hand the leader role to someone else before you leave |
| TASK_FINISHED | 409 | 这个任务已经完成，不能移动 | This task is finished, so it can't be moved |
| STALE_PREVIEW | 409 | 情况有变，请重新看一下预览 | Something changed. Check the preview again |
| TEAM_FULL | 409 | 这个项目已经 8 个人了，不能再加入 | This project already has 8 people |

## 7. Shared types (Step 0; `shared/types.ts`)

- `TaskView` + `startedAt: string | null`, `startedByMemberId: string | null`, `locked: boolean`, `overdue: boolean`, `earnedPoints: number`.
- `PackageView` + `started: boolean`, `earnedPoints: number`, `overdueCount: number`, `estimateHours: number | null`.
- `MemberView` + `joinedAt: string`, `leftAt: string | null`, `removed: boolean`, `earnedPoints: number`, `needsPackage: boolean`, `unfinishedCount: number`.
- `SwapView` = `{ id, requesterMemberId, targetMemberId, requesterPackageId, targetPackageId, createdAt, expiresAt }` (pending, not expired).
- `ProjectView` + `earnedPoints`, `packagesVersion`, `viewerNeedsPackage`, `lightestPackageId: string | null`, `resplitRange: { min: number; max: number }`, `swaps: SwapView[]` (pending swaps where the viewer is requester or target).
- `ProjectCard` + `needsPackage: boolean`. `JoinPreview` + `full: boolean`.
- `ResplitPreview` = `{ version, count, range: { min, max }, rows: ResplitRow[], lockedTasks: { id, title, ownerMemberId: string | null }[] }`; `ResplitRow` = `{ packageId: string | null, oldIndex: number | null, index: number | null, ownerMemberId: string | null, before: number | null, after: number | null }` (new package: packageId/oldIndex/before null; removed: index/after null).
- `NotificationView` = `{ id, type, projectId, projectTag, projectColor, audience, mine, createdAt, read, payload: NotificationPayload, swap: { id, status, voidReason, voidedByRequester: boolean } | null, projectOpen: boolean }`; `projectTag`/`projectColor` come live from the project (null without one). `NotificationPage` = `{ items, nextCursor, unreadCount }`.
- `ActivityView` = `{ id, type, createdAt, actor: { memberId, name, color } | null, payload: ActivityPayload }`; `FeedPage` = `{ items, nextCursor }`.
- `NotificationPayload` / `ActivityPayload`: discriminated unions by `type` (§8/§9); every person in a payload is `{ memberId, name }` so the app can say 「你」.
- `SplitLargeInput` etc. from M2 stay.

## 8. Notifications (zh verbatim; en to match)

Meta: `{projectTag} · {audience label} · {relativeTime}`; GROUP 「全组都收到」, ONLY_YOU 「只有你收到」, ONLY_LEADER 「只有组长收到」, null → no label. Names in text: full names in bold. Never notify the actor.

| Type | To (audience) | Emoji / tint | Text (zh) | Actions |
|---|---|---|---|---|
| SWAP_REQUEST | target (null) | 🔁 tang | pending: `<b>{requester}</b> 想用自己的「任务包 {rp}」换你的「任务包 {tp}」。两个包都还没开工，你同意就立刻互换。` · accepted: `你同意了互换，现在「任务包 {rp}」是你的。` · declined: `你拒绝了 <b>{requester}</b> 的互换请求。` · cancelled: `<b>{requester}</b> 取消了互换请求。` · expired: `<b>{requester}</b> 的互换请求已失效：3 天没有回应。` · void or swap = null: `<b>{requester}</b> 的互换请求已失效{，因为 reason}。` reasons (voidedByRequester?): SWITCHED 你换了别的任务包 / TA 换了别的任务包; STARTED 你已经开工了 / TA 已经开工了; SWAPPED_ELSEWHERE 其中一个包已经换给别人了; LEFT TA 退出了项目; RESPLIT 组长重新分了包 | pending only: 拒绝 (soft) / 同意互换 |
| SWAP_ACCEPTED | requester (ONLY_YOU) | 🔁 tang | `<b>{target}</b> 同意了互换，现在「任务包 {tp}」是你的。` | |
| SWAP_DECLINED | requester (ONLY_YOU) | 🔁 tang | `<b>{target}</b> 拒绝了你的互换请求。` | |
| SWAP_EXPIRED | requester (ONLY_YOU) | 🔁 tang | `你发给 <b>{target}</b> 的互换请求已失效：3 天没有回应。` | |
| SWAP_VOID | requester (ONLY_YOU) | 🔁 tang | `你发给 <b>{target}</b> 的互换请求已失效，因为{reason}。` SWITCHED TA 换了别的任务包; STARTED TA 已经开工了; SWAPPED_ELSEWHERE TA 已经和别人换了; LEFT TA 退出了项目 | |
| MEMBER_NEEDS_PACKAGE | leader (ONLY_LEADER) | 👋 mint | joined: `<b>{name}</b> 加入了 {tag}，但任务包都有人选了。重新分包后，TA 才会有自己的包。` · otherwise: `<b>{name}</b> 还没有任务包，任务包都有人选了。重新分包后，TA 才会有自己的包。` | 重新分包 → project page `?open=resplit` |
| TASK_ADDED | receiving package's owner (ONLY_YOU) | 📦 gum | `组长把新任务「{title}」放进了你的「任务包 {n}」。所有任务按比例换算，现在你的包共 {pts} 分。` | |
| TASK_MOVED_IN | new owner (ONLY_YOU) | ↔️ sky | from owned: `组长把「{title}」从 <b>{from}</b> 的包移到了你的「任务包 {n}」。` · from free: `组长把「{title}」从「任务包 {m}」移到了你的「任务包 {n}」。` · + `已交的证据也一起移过来了。` when `hasEvidence` (false in M3) | |
| TASK_MOVED_OUT | old owner (ONLY_YOU) | ↔️ sky | to owned: `组长把「{title}」从你的「任务包 {m}」移到了 <b>{to}</b> 的「任务包 {n}」。` · to free: `组长把「{title}」从你的「任务包 {m}」移到了「任务包 {n}」（还没人选）。` | |
| RESPLIT | active members except the leader (GROUP, mine) | 🔀 lilac | same number: `组长重新分了包：没开始的任务重新平均分配，你的「任务包 {n}」现在共 {pts} 分。已开始的任务没有变。` · renumbered: `组长重新分了包：没开始的任务重新平均分配。你的包现在是「任务包 {n}」，共 {pts} 分。已开始的任务没有变。` · no package, free > 0: `组长重新分了包，还有 {free} 个任务包没人选，先到先得！` · no package, free = 0: `组长重新分了包。` | no package & free > 0: 去选任务包 → pick |
| PACKAGE_ASSIGNED | assignee (ONLY_YOU) | 📦 gum | `组长把「任务包 {n}」指派给了你。还没开工时，你也可以换到别的空包。` | |
| LEADER_TRANSFERRED | new leader (ONLY_YOU) | 👑 lemon | `<b>{from}</b> 把组长转给了你。现在你可以管理任务、成员和项目设置。` | |
| MEMBER_LEFT | remaining active members (GROUP, mine false) | 🚪 sky | `<b>{name}</b> 退出了 {tag}。做完的分数会保留；没做完的 {k} 个任务现在没人负责。` (k = 0: `<b>{name}</b> 退出了 {tag}。做完的分数会保留。`) | |
| MEMBER_REMOVED | remaining active members except the leader (GROUP, mine false) | 🚪 sky | `组长把 <b>{name}</b> 移出了 {tag}。做完的分数会保留；没做完的 {k} 个任务现在没人负责。` (k = 0 like above) | |
| REMOVED_YOU | the removed person (ONLY_YOU) | 🚪 sky | `组长把你移出了 {tag}。你做完的分数会保留在团队报告里。` | |

Payloads snapshot names/titles/indexes as they were (`{ memberId, name }` for people). `{tag}` in text = the live `projectTag`.

Read model: unread items show the grape dot; when the 通知 tab has loaded its first page it calls `POST /notifications/read { upToId: first item id }` and refreshes the badge, but keeps the dots for this visit. Badge = `unreadCount`, refreshed on app foreground, tab-bar mount, every 60 s while open, after home loads, and after marking read. Tapping a card opens its project when `projectOpen` (MEMBER_NEEDS_PACKAGE → `?open=resplit`, RESPLIT without a package → pick); buttons act in place (accept/decline call the swap API, then reload the list). 「跟我有关」 requests `mine=1`. Footer hint verbatim (proto §4.3). Empty: `还没有通知` / "No notifications yet". Load more with `Screen.onEndReached`.

## 9. Feed (动态 tab)

Short names (`givenName()`), 「你」 when the memberId is the viewer; bold; newest first; `relativeTime`; load more with `onEndReached`.

| Type | zh |
|---|---|
| PLAN_CONFIRMED | `<b>{actor}</b> 把任务分成了 {n} 个任务包` |
| JOINED | `<b>{actor}</b> 加入了项目` |
| LEFT | `<b>{actor}</b> 退出了项目` |
| REMOVED | `<b>{actor}</b> 把 <b>{name}</b> 移出了项目` |
| PICKED | `<b>{actor}</b> 选了「任务包 {n}」` |
| SWITCHED | `<b>{actor}</b> 从「任务包 {m}」换到了「任务包 {n}」` |
| SWAPPED | `<b>{actor}</b> 同意了 {requester} 的互换请求` |
| ASSIGNED | `<b>{actor}</b> 把「任务包 {n}」指派给了 <b>{name}</b>` |
| TASK_ADDED | `<b>{actor}</b> 加了新任务「{title}」，放进「任务包 {n}」` |
| TASK_MOVED | `<b>{actor}</b> 把「{title}」从「任务包 {m}」移到了「任务包 {n}」` |
| TASK_STARTED | `<b>{actor}</b> 开始做「{title}」` |
| RESPLIT | `<b>{actor}</b> 重新分了包，现在有 {n} 个任务包` |
| LEADER_TRANSFERRED | `<b>{actor}</b> 把组长转给了 <b>{name}</b>` |

Empty: `还没有动态` / "Nothing here yet".

## 10. App screens

Routes (Step 0 creates placeholder files rendering `<DevNote milestone="M3" />` and registers the Stack screens): `project/[id]/index`, `project/[id]/pick`, `project/[id]/settings`, `project/[id]/members`, `project/[id]/task/[taskId]`. `?open=resplit` on the project page opens the re-split sheet (leader).

`useProject(id)` (Step 0, `features/project/useProject.ts`): `{ project, error, reload, setProject, onError(err) }`; reloads when the screen regains focus. `onError`: toast `t.errors[code]`; for 409 codes and FORBIDDEN also `reload()`; NOT_FOUND → toast and a quiet reload, which goes home (`router.dismissTo('/')`, no second toast) only when the project itself is gone or the viewer is no longer in it. Every screen: ActivityIndicator while loading, an error card with 再试一次 before the first load succeeds.

**Project page** (`ProjectLeader` + `NoPackage`; proto §4.5):
- AppBar: title = project tag; sub leader `你是组长 · {n} 人` (`你是组长（只管理） · {n} 人`), member `你是组员 · 组长：{leader full name}`; right: settings gear (aria 「项目设置」) for everyone (members see read-only settings).
- Hero: name, meta `{courseName} · {groupLabel} · 截止 {M月D日}` (skip empty parts), ring `{earned}` + `/ 100 分` in the project colour, chips `⏳ 还剩 {d} 天` (`今天截止` at 0, `已过截止` below), next milestone `🚩 {label} {name} · {M月D日}` when milestones exist, repo chip when `repoFullName`.
- Viewer needs a package: free > 0 → card `还没选任务包` / `还有 {free} 个任务包没人选，先到先得！` + `去选任务包` → pick. free = 0, member → warn card `你还没有任务包` / `任务包都有人选了。已经提醒组长重新分包，分好后你会收到通知。` (mockup wording minus 「你加入的时候，」, which isn't true for everyone). free = 0, leader (not only managing) → warn card `任务包都被选走了` / `你也要做任务的话，重新分包多分出一个包。` + `重新分包`.
- Leader, others need a package and free = 0 → banner `有 {n} 位组员还没有任务包` + `重新分包` (the Resplit mockup's title).
- Seg `任务包` / `排行` / `动态`. 排行 → `DevNote milestone="M4"`.
- 任务包 tab: one collapsible card per package in index order (the viewer's opens by default): number tile in the owner colour (waiting grey when free), owner avatar + full name or `我的任务包`, chip bad `{k} 个过期`, progress bar earned/points in the owner colour (none when free), right `{earned} 分` / `共 {pts} 分` (free: `共 {pts} 分`), chevron. Free: `还没人选` + leader soft small `指派给…` (only when someone needs a package) → Assign sheet. Expanded: mini tasks `{status emoji} {title}` + `{pts} 分`; tap → task page; leader `⋯` (aria 「移动任务」) on unfinished tasks → Move sheet. Viewer's own package, not started: soft button `🔁 换包或申请互换` at the bottom (confirmed 2026-09-19) → pick. Tasks with no package (finished work of people who left) aren't listed.
- Leader tools card (`LeaderTools variant="project"`): `组长工具` + chip grape `只有你看得到`, soft small `加任务` / `重新分包`, hint verbatim.
- Footer hint verbatim. 动态 tab: feed (§9).

**Leader sheets** (inside `features/project/`, opened by `LeaderTools` and the package list):
- `AddTaskSheet` (`AddTaskActive`): name, kind (wizard `KindPicker`), points in 分 (0.1–99.9), optional due (wizard `DateTimeField`), text `加进去后，会<b>自动放进目前最轻的任务包</b>（任务包 {n}）。所有任务的贡献值会按比例换算，总分还是 100 分。`, button `加进去` → toast `已加入目前最轻的任务包`.
- `MoveTaskSheet` (`MoveTask`): `移动任务`, `把「{title}」（{pts} 分）移到哪个包？`; the current package first (sub `现在在这里`, disabled), then the others in index order: tile, `任务包 {n} · {owner}`(`（你）`)/`还没人选`, sub `{before} → {after} 分`; hint verbatim. Tap → move → toast `已移到「任务包 {n}」`.
- `AssignSheet` (`AssignPackage`): `指派任务包 {n}`, text verbatim, rows for members who need a package (sub `刚加入 · 还没有任务包` when joined < 24 h, else `还没有任务包`), hint verbatim. Tap → toast `已指派给 {name}`.
- `ResplitSheet` (`Resplit`): intro verbatim; stepper `分成几个包` starting at `max(current count, min)`, disabled outside the range, small `· 至少要和现在的成员人数一样多（{min} 人）` when min = members who should hold a package, else `· 至少 {min} 个`; preview table (debounce 250 ms; while loading keep the old table dimmed; on error show the error with 再试一次 and disable the button): rows `{index} · {owner}`, `{index} · 还没人选`, bold `{index} · 新的包` (before `—`), `{oldIndex} · 会删掉` (after `—`), and `（原任务包 {oldIndex}）` after a renumbered owner; locked hint `已开始的任务不会动：陈思远的「a」「b」、林晓雯的「c」。` (ownerless `没人负责的「x」`; after 6 titles `等 {k} 个`; none: `现在还没有人开始做任务。`); when someone needs a package and the result has free packages: `新的包先是灰色，可以让{names}自己选，或由你指派。`; button `重新分包` → ConfirmSheet (`重新分包？` / `没开始的任务会重新分配，大家会收到通知。` / confirm `重新分包`) → POST with `version` → toast `已重新分包，大家会收到通知`; `STALE_PREVIEW` → reload the preview + toast.
- `LeaderTools({ project, onChange, variant })`: `variant="pick"` hides the hint sentence about 「⋯」.

**Pick screen** (proto §4.7 + `PickPending`):
- AppBar `选任务包`, sub `{tag} · {n} 人 · 先到先得`, gear → settings.
- Title (`packageSpread` in `app/src/lib/packages.ts`, the same test as wizard step 6): all packages equal → `每包都是 {pts 分}，<br>挑你最想做的` (highlighter in the viewer's colour); within 2.0 分 and none empty → `每包大约 {avg 分}，<br>挑你最想做的` (avg = the packages' sum / count); otherwise `各包的分数不一样，<br>挑你最想做的` (no highlighter) and the sub starts `最多 {max} 分，最少 {min} 分。`. Totals use `formatTotal`. Sub verbatim. Viewer needs a package and free = 0 → the project page's warn card above the carousel.
- Carousel: cards 84% wide, snap to centre, 14 px gap, bleeding to the edges; starts at the viewer's package, else the first free; dots below (active 20 px wide).
- Card: band in owner colour or waiting grey with `任务包 {n}`, `约 {h} 小时` when known, big `{pts}` + `分`, `贡献值`; scalloped bottom edge (react-native-svg, r6 every 14 px); body rows: kind tag, `{status emoji} {title}`, right `{pts} 分` over `M/D` (deadline when none) — tap → task page.
- Foot, someone else's package, first match wins: (1) its owner asked me → `{name} 想和你互换` + `拒绝` / `同意互换` (+ `取消申请` link below if I asked them too); (2) my request targets it → `⏳ 已申请互换，等{name}同意`, link `取消申请` (→ toast `已取消互换申请`), hint `3 天没回应会自动失效。任何一方开工或换包，申请也会失效。`; (3) I have no package → owner line only; (4) theirs started → disabled `对方已开工，不能互换`; mine started → disabled `你已开工，不能互换`; (5) my request is elsewhere → disabled `一次只能申请一个互换`; (6) soft `🔁 申请互换`. Owner line always first: avatar + `已被 {全名} 选走` (+ ` · 已开工`). Mine: avatar + `这是你的任务包 ✓` + soft `去看我的任务` → the first unfinished task's page. Free: leaderManages leader → hint `只管理的组长不用选任务包`; my package started → disabled block + hint `你已开工，不能换包`; else highlighter block `选我！` / `换成这个` (+ hint `你还没开工，可以直接换` when I have one).
- Pick/switch → confetti (proto §2.8; skip under reduced motion) + toast `🎉 任务包 {n} 是你的了！` / `换好了，现在任务包 {n} 是你的`. Swap request → `已向 {name} 发出互换请求，对方同意才会换`. Accept → `互换好了！任务包 {n} 是你的了`; decline → `已拒绝互换`.
- `LeaderTools variant="pick"` + footer hint: planSource AI/MODEL `截止日期是 AI 按里程碑建议的，组长可以再改。`, RULES `截止日期是按项目截止日平均排的，组长可以再改。`, MANUAL none.
- `SwapActions({ swap, project, onChange })` (features/pick) renders (1)/(2) and calls the API (all three swap endpoints return ProjectView).

**Task page (temporary)**: AppBar `任务详情`, sub `{tag} · 任务包 {n}` (or `{tag}`); card with title, kind chip, status chip, `{pts} 分`, due, owner (or `没人负责`), description; the owner sees `开始做` while TODO and not started → toast `已开始。开工后就不能直接换包或互换了。`; `DevNote milestone="M4"`; in `__DEV__` a 「开发测试」 card with 待开始 / 进行中 / 完成 / 拿一半 calling the dev endpoint (hide it when the task has no owner or package).

**Settings** (`SettingsLeader`):
- AppBar `项目设置`, sub `{tag} · 你是组长|你是组员`.
- `项目信息` + small `{name} · 截止 {M月D日（周X）HH:mm} · {城市}时间` (`t.members.zoneLabel(city)`; en `{city} time`) + leader `编辑` → `ProjectInfoSheet` (name*, 简称, 课程或团队, 组别, deadline + time zone via wizard `Field`/`DateTimeField`/`ZoneSheet`; PATCH; toast `已保存`; with `adjustedTasks` also the wizard's adjusted-dates toast).
- `成员` + small `{people} · 转让组长、移出成员` (members: `{people}`), where `{people}` = `{n} / {teamSize} 人` while n < teamSize, else `{n} 人`; avatar stack + chevron → members.
- 邀请码 card: code box + `复制链接` (toast `邀请链接已复制`); leader: link `重新生成邀请码` (toast `已生成新的邀请码`) + hint verbatim.
- Leader only: AI card, integrations, 结束项目 exactly as the mockup but disabled, each with a `DevNote` (AI → M6, GitHub → M8, Discord/Telegram → M9, 结束项目 → M5).

**Members** (`Members` + `MemberActions`):
- AppBar `成员`, sub `{tag} · {people}`.
- Active: leader first. Row: avatar, full name + chips (`组长` grape, `你`), sub `任务包 {n} · 已开工|还没开工` / `还没有任务包` (+ ` · 刚加入` when joined < 24 h) / `组长（只管理）`. Leader sees `⋯` on everyone else → MemberActions.
- `已退出` (left or removed): faded rows, sub `{M月D日}退出 · 做完的 {pts} 分会保留在报告里` (removed: `{M月D日}被移出 · …`).
- `邀请组员` soft block → `InviteSheet` (code box + copy + email/GitHub field; extract `InvitePanel` into `features/members/`, don't edit DoneStep).
- Danger card: member `退出项目` → ConfirmSheet (`退出 {tag}？` / `你做完的分数会保留；没做完的任务会变成没人负责。之后还可以用邀请码回来。` / confirm `退出项目`, danger) → leave → home + toast `已退出 {tag}`. Leader: disabled + hint `你是组长，要先把组长转给别人才能退出。`
- MemberActions: title name, sub `任务包 {n} · {package total} 分 · 已开工|还没开工` (or `还没有任务包`), options verbatim (👑 transfer, 🚪 remove danger), hint verbatim. Transfer → ConfirmSheet `把组长转给 {name}？` / `你会变成普通组员。` (+ when leaderManages `你选了「只管理」，转让后会取消：你会变成还没有任务包的组员。`) / confirm `转让组长` → toast `{name} 现在是组长了`. Remove → ConfirmSheet danger `把 {name} 移出项目？` / the option's text / confirm `移出` → toast `已移出 {name}`.

**Notifications tab** (`NotifsM3` + proto §4.3): title, seg `全部` / `跟我有关`, cards per §8, unread dot, footer hint, pull to refresh, load more.

**Home**: tapping an ACTIVE card opens pick when `needsPackage && freePackages > 0`, else the project page. Chip `needsPackage && freePackages === 0` → warn `你还没有任务包`. Refresh the unread badge after home loads.

**Wizard step 6**: `去选我的任务包` goes to `/project/{id}/pick` (not the project page) when the leader doesn't only manage.

**Join**: `preview.full` → `t.errors.TEAM_FULL` in the existing error state; add `TEAM_FULL` to `CODE_ERRORS`; check `alreadyMember` first.

## 11. Step 0 checklist (foundation agent; one agent, before any builder)

1. Schema + migration (§3, including the data UPDATE for leaderDueAt) + `npx prisma generate`.
2. `shared/types.ts` (§7), `shared/api.ts` codes (§6), `shared/format.ts` (§4); `app/src/features/home/format.ts` re-exports.
3. `server/src/lib/package-state.ts`, `services/tx.ts` `lockAsMember`, `services/notify.ts` — fully implemented (small, shared).
4. Server stubs that compile: `services/{packages,swaps,resplit,active-tasks,members,notifications,feed}.ts` exporting the functions the routes need, each throwing `new AppError(501, "INTERNAL", "Not implemented")`; routers `routes/{packages,swaps,members,notifications}.ts` wired to them and mounted in `app.ts`; the ACTIVE branch of `POST /projects/:id/tasks` calling `addActiveTask`. Placeholder values for every new view field in `services/views.ts`, `home.ts`, `join.ts` (e.g. `started: false`, `swaps: []`, `full: false`) so the tree typechecks.
5. `server/tests/project-fixtures.ts`: helpers `activeWith(n, { leaderManages? })` → `{ projectId, leader, members: LoginResult[], view }` (creates an ACTIVE project with n−1 joined members), `pickAs(token, projectId, index)`, `viewAs(token, projectId)`, `startAs(token, projectId, taskId)`, `devStatus(taskId, status)`. Update `server/tests/projects.test.ts` so the "ACTIVE add → NOT_A_DRAFT" assertion is gone (M3 allows it).
6. App: `app/src/lib/time.ts`; `labels.relative/status/statusEmoji` (zh + en); `Screen.onEndReached`; error strings for the new codes (zh + en); i18n sections `project`, `pick`, `members`, `notifs` created (empty objects) and registered in zh.ts/en.ts; `features/project/useProject.ts`; `features/project/LeaderTools.tsx` stub (`LeaderTools` returning null, final props); `features/pick/SwapActions.tsx` stub; `features/notifs/useUnread.tsx` stub provider mounted in the root layout; placeholder route files + Stack screens.
7. `cd server && npx tsc --noEmit && npx vitest run` and `cd app && npx tsc --noEmit` pass (Metro is running, so typed routes regenerate; wait and re-run if a new route is missing).

## 12. Builders and file ownership (after Step 0)

- **srv-packages**: implement `services/{packages,swaps,resplit,active-tasks}.ts` and `routes/{packages,swaps}.ts`; the dev endpoint in `routes/dev.ts`; tests `server/tests/{packages,swaps,resplit,active-tasks}.test.ts` (assert database state and responses; view-field details belong to srv-core).
- **srv-core**: implement `services/{members,notifications,feed}.ts`, `routes/{members,notifications}.ts`, the real view fields in `services/{views,home,join}.ts`, join/invite effects, PLAN_CONFIRMED in `services/projects.ts`, the M2 follow-up (`leaderDueAt` in `services/projects.ts` rescheduling and `services/tasks.ts`/split copying); tests `server/tests/{members,notifications,feed}.test.ts` + updates to `home`, `join`, `invites`, `projects` tests.
- **app-project**: `app/src/app/project/[id]/index.tsx`, `app/src/app/project/[id]/task/[taskId].tsx`, `app/src/features/project/**` except `useProject.ts`, `sections/project.{zh,en}.ts`.
- **app-pick**: `app/src/app/project/[id]/pick.tsx`, `app/src/features/pick/**` (carousel, card, scallop, confetti, SwapActions), home (`app/src/app/(tabs)/index.tsx`, `app/src/features/home/**` except `format.ts`), wizard step-6 navigation (`features/wizard/DoneStep.tsx` goPick only, `features/wizard/nav.ts`), `sections/pick.{zh,en}.ts` (+ keys you add to `home`).
- **app-members**: `app/src/app/project/[id]/{settings,members}.tsx`, `app/src/features/members/**`, `sections/members.{zh,en}.ts`.
- **app-notifs**: `app/src/app/(tabs)/notifs.tsx`, `app/src/app/(tabs)/_layout.tsx`, `app/src/features/notifs/**`, `app/src/features/join/**`, `sections/notifs.{zh,en}.ts` (+ keys you add to `join`).

## 13. Tests (server, vitest)

Must include: two simultaneous pickers → one wins, the other `PACKAGE_TAKEN`; switch frees the old package and re-owns tasks; `PACKAGE_STARTED` after start; getting someone else's started task (move in, or picking a package with one) does NOT block switching; leaderManages leader can't pick; swap request/accept (package owners AND task owners on both sides; other swaps voided + SWAP_VOID), decline, cancel, `SWAP_LIMIT`, expiry after 72 h (lazy; exactly one SWAP_EXPIRED with two concurrent reads), stale accept after the requester switched → `SWAP_NOT_PENDING` AND the swap row is VOID afterwards, void on start/leave/remove/resplit (no SWAP_VOID to a departing member); assign (+ errors); add task (lightest, typed points exact, total 1000, finished tasks rescaled, owner notified); move (owners, release into a free package, notifications, TASK_FINISHED, same package); resplit (preview = result, locked stay, min/max, new free packages, removing + renumbering, teamSize, STALE_PREVIEW incl. preview → start → apply, heavy preload keeps feature groups whole, swaps voided); concurrent actor races (two transfers → one leader; remove vs pick; transfer vs leave); leave (package freed, finished/REVIEWING detached with points, others released, LEADER_MUST_TRANSFER); remove (+ can't rejoin, REMOVED_YOU); transfer (roles, leaderManages off, reminder when no free package); TEAM_FULL at 8 (code and invite; rejoin); joining twice → one event/notification; MEMBER_NEEDS_PACKAGE dedupe; notifications list/pagination/mine=1/read upToId/unread-count; feed order + pagination; view fields (earned, started, overdue, swaps only for the two people); leaderDueAt: earlier then later deadline gives the leader's date back.

## 14. Done means

- `cd server && npx tsc --noEmit && npx vitest run` passes.
- `cd app && npx tsc --noEmit` passes.
- Final report: files created/changed, anything not done, and every decision the spec didn't settle (flagged — the user must be asked).
