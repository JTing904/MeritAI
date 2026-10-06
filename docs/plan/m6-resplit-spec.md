# AI re-split for a running project (M6 follow-up, 2026-10-02)

Owner decisions: REQUIREMENTS.md §13 「项目开始后让 AI 重新拆」. Approved mockup: the Design canvas
「MeritAI 样稿 · AI 重新拆」 (claude.ai/artifact/48nmc3hFLYK9BGfPnKDUCT), six screens: leader-tools entry +
sheet, AI reading, a new choice question, the review page, notifications/feed, the no-key state.

## Rules (from the owner)

- The leader can ask any time, no count limit (only the key's quota). Not on an ended project (PROJECT_ENDED),
  not without a usable key (NO_AI_KEY), one run at a time per project (a new start cancels the old one).
- Only tasks that haven't started are replaced: status TODO with no attempt, no evidence, not started (same test
  as 改选's "started" check). Started / handed-in / done tasks stay as they are. Leader-added unstarted tasks are
  replaced too.
- The brief: the project's saved brief by default; the leader may upload a new file or type new text. A new brief
  becomes the project's brief only when the result is applied.
- Choice questions already answered keep their picks. The AI's questions are matched to the existing ones; a
  matched question uses its existing picked options (their tasks come from the AI's matching options), the
  unpicked options' `tasksJson` is refreshed so a later 改选 uses fresh tasks. A question the project doesn't
  have yet must be answered on the review flow (exact pickCount) before applying. Existing questions the new
  answer doesn't mention are left alone.
- Review before apply: the leader sees kept / removed / added, the new tasks grouped by package with points and
  due dates, and each package's points before → after. New tasks can be edited (title, kind, points, due date),
  deleted (swipe left; web: the edit sheet's delete) and added. Nothing changes until 「确认，换成新任务」.
  「不要了，保持原样」 discards. A result nobody confirms just stays until the next re-split replaces it.
- While the AI runs, members see the old tasks; the leader may leave; when it's done only the leader is told.
  AI failure (quota, invalid key, error) changes nothing; the leader is told (and the key status updated as the
  brief job does).
- Apply: unstarted tasks deleted, new tasks created, every task (kept + new) rescaled in proportion so the
  total stays exactly 1000 tenths (assertPointsTotal). New tasks go into packages automatically, keeping them
  even (balancePackages with the kept points preloaded per package); per-member copies (feature 「组员 n」 /
  「个人方案 n」 / "Member n" / "Individual solution n") go into package index n when it exists; a package's
  owner owns its new tasks. Members who picked a package don't re-pick. Everyone else is notified
  (mine = their package changed, with their package's removed / added counts and new points), a feed event is
  recorded, packages version bumped.
- Kept work must not be re-created: the prompt lists the kept tasks ("already being done, stays; split only the
  rest; their share of the 100 points is already taken"), and after brief-check any new task whose title matches a
  kept task (case/space-insensitive, copy marker included) is dropped.

## Server sketch

- New AiJob kind RESPLIT (migration). Payload: { brief?: {text|fileKey,fileName,mime}, lines }. Result on
  DONE: the checked BriefOut + model/tier (the proposal is recomputed from it and the current project state on
  every read, so a task that started meanwhile simply moves to "kept").
- Routes (leader only), under /projects/:id/ai-resplit:
  - POST (multipart or JSON: none = saved brief, `text`, or `file`): start. 409 NO_AI_KEY / PROJECT_ENDED / NO_BRIEF.
  - GET: { status: running|failed|done|none, error?, proposal? } where proposal = { kept[], removed[],
    added[] (each with a stable key, title, kind, points, dueAt, packageIndex, ownerMemberId, feature, aiWritten),
    newQuestions[] (options with pros/cons/hours/recommended), keptQuestions[] (prompt + picked labels),
    packages[] (index, owner, pointsBefore, pointsAfter), version }.
  - POST /apply { version, edits: { [key]: { title?, kind?, points?, dueAt? } }, deleted: key[], added: [{title,
    kind, points, dueAt}], answers: { [newQuestionKey]: optionKeys[] } } → applies; 409 STALE_PREVIEW when
    the packages version moved, CHOICES_REQUIRED when a new question isn't answered exactly.
  - DELETE: discard the result (or cancel a running job).
- Reuse: analyseBrief (with a `keep` list added to the brief context/prompt), checkBrief, seedFromAi,
  createSeededTasks (placement, orders, dueFallback, choiceOptionIds), apportion, balancePackages (preload),
  notify / recordEvent / bumpPackages / assertPointsTotal, lockAsMember({leader:true}), projectEnded,
  keyUsable/leaderUser, the brief route's upload handling and BRIEF_FILE_TYPES.
- Notification types: AI_RESPLIT_READY (leader), AI_RESPLIT_FAILED (leader, with reason), TASKS_RESPLIT
  (group). Event type TASKS_RESPLIT for the feed. Bump API_SHAPE_VERSION if a response shape changes.

## App sketch

- Leader tools on the project page: 「✨ 让 AI 重新拆」 (disabled with the hint and a link to the 我 page
  when the leader's key is missing / not usable).
- Sheet: brief choice (原来那份 with its file name and date / 换一份新的 → file picker or text), the quota line
  (good-model usage today from /me), 开始重新拆 / 取消.
- Route project/[id]/resplit: running (the wizard's AI reading look, real steps, 「不拆了」), failed (reason +
  再试一次 / 关闭), new questions (the wizard's ChoiceCard look, one by one), review (as the mockup), done →
  toast + back to the project. Poll every 2 s only while running and the screen is focused (no idle polling).
- Notifications/feed copy for the three types; i18n zh + en; dev gallery entries for the new screens.

## Tests

Mock AI (AI_MOCK): start → job → GET proposal; apply keeps started tasks untouched, removes unstarted, creates
the new ones, total 1000, per-member copies in package n, others balanced; matched question keeps its picks
and refreshes unpicked tasksJson; an unmatched question requires answers; edits/deletes/adds applied; stale
version → 409; discard; ended project / no key / non-leader refused; a task started between GET and apply ends
up kept (version bump → STALE_PREVIEW, re-GET shows it kept); notifications to the right people; kept titles
dropped from the new tasks.
