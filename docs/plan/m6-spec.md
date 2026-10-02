# M6 spec — AI (approved 2026-09-23)

Rules: REQUIREMENTS.md §3, §4, §13 (「AI（M6，2026-09-23 问答）」 block and the lines after it, 前置任务, 点开任务能看到要做什么, 证据与评分). Mockups (approved): `scratchpad/m6mock/project/*.dc.html` (generator `scratchpad/m6mock/gen10.py`, published at https://claude.ai/artifact/6S9w5HVc3NhXd5CDRXisDk), including the stickies' assumptions. Conventions as M3–M5: `lockAsMember` under the project lock, `notify` / `recordEvent` / `bumpPackages`, services take `now` (= `clock.now()`) last, zh + en, no gendered pronouns, ETag tokens keep covering what views show (Project.version triggers cover new project-owned tables only if you add triggers for them).

## 1. The key (per account)

- Schema on `User`: `aiProvider` enum `GEMINI | CLAUDE | OPENAI` (nullable), `aiKeyCipher` (bytes/base64: AES-256-GCM, random 12-byte IV, auth tag; key from env `AI_KEY_SECRET`, 32 bytes base64; refuse to start in production without it; dev/test fall back to a fixed dev secret with a warning), `aiKeyLast4`, `aiKeyStatus` enum `OK | INVALID | QUOTA` (nullable), `aiKeyCheckedAt`, `aiAdultConfirmedAt`.
- `PUT /api/me/ai-key { provider, key, adult: true }`: `adult` must be true (400 `AI_ADULT_REQUIRED`). Validate the key with one cheap call (Gemini: `GET v1beta/models` with header `x-goog-api-key`; Claude: `GET /v1/models`; OpenAI: `GET /v1/models`). Invalid → 400 `AI_KEY_INVALID`, nothing stored. Store encrypted, `last4`, status OK. Rate-limit (10/h per user). `DELETE /api/me/ai-key`. `/api/me` returns `ai: { provider, last4, status, checkedAt, usageToday }` — never the key, not even to its owner.
- The key used for a project = the current leader's account key. No key → free rules (existing behaviour). Leader change → automatically the new leader's key (nothing to delete). Members see `project.ai = { provider, configured, leaderName }` only.
- Never log keys; redact `x-goog-api-key`, `Authorization`, `x-api-key` in any error you log; never send the key to the app.

## 2. Providers (`server/src/lib/ai/`)

- One interface: `generate({ tier: 'light' | 'good', system, parts, schema, maxOutputTokens })` → parsed JSON validated with zod (`schema` is a zod schema; also send a JSON schema to the provider when it supports structured output). `parts` = text blocks and inline files (`{ mimeType, bytes }` for PDF and images).
- Gemini (REST `v1beta/models/{model}:generateContent`, `x-goog-api-key`, `generationConfig.responseMimeType: application/json` + `responseSchema`): light = `gemini-flash-lite-latest`, good = `gemini-flash-latest` (env overrides `GEMINI_MODEL_LIGHT`, `GEMINI_MODEL_GOOD`). Map 429/RESOURCE_EXHAUSTED → `QUOTA`, 400 API_KEY_INVALID / 401 / 403 → `INVALID`, 5xx / timeout → `TRANSIENT`.
- Claude (REST Messages API `POST https://api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`): light `claude-haiku-4-5`, good `claude-sonnet-5` (env overrides). Structured output via a single tool with the JSON schema and `tool_choice` forcing it. Marked 测试版 (not tested with a real key).
- OpenAI: REST, JSON schema structured output; model ids from env with sensible current defaults (check the current docs with Context7 before choosing; if unsure, leave defaults configurable and say so). Marked 测试版.
- **Mock provider** (`AI_MOCK=1`, tests and dev only, refused in production): deterministic outputs for brief analysis (including one pick-N and one method question when the brief contains 「任选」/"choose" and "Waterfall"/「做法」), how-to, and grading (grade by a marker word in the evidence text, e.g. `#half`, `#fail`, default PASS); can simulate `QUOTA` / `INVALID` / `TRANSIENT` via env or a test hook.
- **Quota and pacing** (all per key = per leader user): per-minute pacing per model tier (Gemini good 5/min, light 15/min; Claude/OpenAI 30/min default) using `RateLimitBucket`; daily counters per key and tier (`AiUsage { userId, day (Pacific date for Gemini, UTC otherwise), tier, count }`). Good-tier daily limit reached (Gemini 20 by default, env `GEMINI_GOOD_RPD`) → use light for grading. Provider says QUOTA on light too → failure QUOTA.
- **Untrusted content**: brief text and evidence are data, never instructions. Put them inside clearly delimited blocks with a random nonce and tell the model to ignore instructions inside. Validate every output with zod; clamp numbers; titles ≤ 120 chars; never trust model-provided ids.

## 3. Jobs

- `AiJob { id, kind BRIEF | HOWTO | GRADE, projectId, taskId?, attemptId?, dedupeKey unique, status QUEUED | RUNNING | DONE | FAILED, tries, runAfter, leaseUntil, error, result Json?, createdAt, updatedAt }` (cascade on project).
- Run: enqueue inside the write's transaction; after commit, kick the worker in-process (`queueMicrotask`/`setImmediate`; on Vercel later use `waitUntil` — leave a TODO). The M5 tick also drains due jobs (stale lease recovery: RUNNING with `leaseUntil < now` → QUEUED). Pacing waits → `runAfter`. `TRANSIENT` → retry with backoff (30 s, 2 min, 10 min), max 3 tries, then FAILED.
- Each job writes its outcome in one transaction under the project lock, re-checking that the project/task/attempt still is in the state the job was made for (else discard).

## 4. Brief analysis (wizard)

- When the draft's leader has a key and the brief (file or typed text) is set, `POST …/brief` (and the typed-text path) enqueue a BRIEF job instead of (or after) the rules parse; the draft shows `analysis: { status: 'running' | 'done' | 'failed', steps: [...], error? }` so the wizard's step 3 polls (every 2 s, ETag) and shows the real steps (读文件 → 找出要做的事 → 认出选择题 → 估工作量和截止日期). Images and scanned PDFs are sent to the model as files (the rules can't read them).
- Output (zod): tasks `{ title, kind, points (relative weight), estimateHours, suggestedDue (date within the project), milestone?, feature?, briefFrom/briefTo line range or quote, howto: string[] (2–5), checklist: string[] (2–6), prereqTitle? }`, `questions: [{ id, type: 'PICK_N' | 'METHOD', prompt, pickCount, options: [{ key, label, summary, hours, material: 'LOW'|'MID'|'HIGH', difficulty, pros?: string[], cons?: string[], recommended: boolean, tasks: [...same task shape] }] }]`, `meetingFirst?: { title, why }` when code tasks depend on each other (add the 「一起定好接口和数据格式」 meeting task first and make the dependent tasks wait for it).
- Points: normalise to 1000 tenths (existing helpers), group by feature into packages (existing split logic keeps equal packages ±1–2 分). Prereqs by title → ids.
- Failure (QUOTA/INVALID/TRANSIENT exhausted): `analysis.status = 'failed'` with the reason; the wizard offers 再试一次 / 改用免费规则拆 (runs the existing rules path) / 手动建任务.
- Choice step (new4): the draft carries the questions; `PUT …/choices { answers: { [questionId]: optionKey[] } }` must pick exactly `pickCount` per question (400 `CHOICE_COUNT`); confirming the plan materialises the chosen options' tasks.
- **Re-choose after confirm** (leader, ACTIVE/AWAITING): `POST /api/projects/:id/choices/:questionId { picks }`. Options with any started or finished task can't be removed (409 `CHOICE_LOCKED`). Tasks of removed options that are unstarted are deleted; the new options' tasks are added into the package(s) the removed ones were in (same owners), points rescaled so the total stays exactly 1000 (reuse add-task scaling), group notified `CHOICE_CHANGED` (zh: 「组长改选了『{prompt}』：{from} 换成 {to}。」), activity `CHOICE_CHANGED`. A preview endpoint (`…/preview`) returns the diff the RechooseSheet shows.
- Persist questions/options: `ChoiceQuestion { id, projectId, prompt, type, pickCount, order }`, `ChoiceOption { id, questionId, key, label, summary, hours, material, difficulty, pros[], cons[], recommended, picked, tasksJson (template for regenerating) }`, `Task.choiceOptionId?`.

## 5. 怎么做 and checklist

- Task gets `howto String[]` and `howtoByAi Boolean`, `checklistByAi` on the task (the checklist items already exist). The BRIEF job fills them. For tasks added later by the leader while a key is set, enqueue a HOWTO job (light tier). Editing 怎么做/checklist by leader or owner clears the `ByAi` flag (the 「✨ AI 写的」 tag goes away). Endpoint to edit 怎么做: `PUT …/tasks/:taskId/howto { steps }` (leader or owner, ≤ 8 steps, ≤ 200 chars each).

## 6. Grading

- On `submit` of a non-meeting task whose owner is not the leader, when the leader has a key with status not INVALID and the per-task (3/day) and per-project (30/day) limits allow: attempt stays PENDING with `aiState = QUEUED` and a GRADE job is enqueued. Otherwise (no key, limits hit) → the existing leader-grading path (and for limits hit, a note 「今天 AI 审核次数用完了，改由组长评」).
- The job sends: the brief excerpt, 怎么做, checklist, task title/kind/points, and the evidence: PDF and images as files; DOCX/PPTX/XLSX/CSV as extracted text (reuse the worker-thread extractor with its limits; include embedded images of DOCX/PPTX if easy, else say not done); links as URL text only — the server never fetches evidence links (SSRF); if an attempt has only links, AI can't judge it → fall back to the leader with reason `LINKS_ONLY`.
- Output (zod): `{ score 0–100, reasons: string[] (0–4; 2–4 required when score < 60), suggestions: string[] (0–4; ≥1 when score < 60), summary }` in the project language. Map score to the grade bands in REQUIREMENTS §5 (≥85 优秀, 60–84 合格, 40–59 拿一半, <40 不通过). Store on the attempt: `grade`, `gradedByAi = true`, `aiModel`, `aiReasons`, `aiSuggestions`, `gradeNote` = summary; the leader can override exactly like a leader grade (existing override/undo). The score number is never shown to users.
- Notifications: owner gets the existing `GRADED` with `byAi: true` (and the reasons count); group sees it in the feed.
- **Failure** (QUOTA, INVALID, TRANSIENT after retries, LINKS_ONLY, unreadable file): `aiState = FAILED` with `aiFailReason`; the attempt shows in the leader's 待我审核 at once; leader gets `AI_REVIEW_FAILED` (per attempt, with 去评级) and, for key problems, `AI_KEY_PROBLEM` at most once per day per key (「你的 Gemini key 今天的额度用完了」 / 「你的 Gemini key 不能用了，去『我』页换一把」 with 检查 key). Update `User.aiKeyStatus`. QUOTA status clears at the next reset; INVALID until a new key is saved.
- Leader's own tasks: unchanged (合格（组长自评）). Meeting tasks: unchanged.

## 7. Views and usage

- `ProjectView.ai = { provider, configured, status, leaderName, reviewsToday, reviewsLimit: 30 }`; `TaskDetail`: `howto`, `howtoByAi`, `checklistByAi`, attempt `aiState`, `aiFailReason`, `aiReasons`, `aiSuggestions`, `gradedByAi`, `aiReviewsLeftToday` (per task), and `project.ai` for the privacy line.
- `/me.ai.usageToday = { good: { used, limit }, light: { used, limit }, resetsAt }`.

## 8. App (after the server)

All 14 mockup boards: 我 page AI card (empty / saved / error, provider segmented control with 测试版 tags, 18+ checkbox, privacy box, 「怎么拿免费的 Gemini key」 link to https://aistudio.google.com/apikey), project settings AI card (leader / member / no key), wizard step 3 real AI progress with the prototype's scan animation (respect reduced motion), failure screen, choice steps (pick-N with counter; method with 优点/缺点 columns; AI 推荐 tag), RechooseSheet from the leader tools, task page 怎么做 card + checklist with the 「✨ AI 写的」 tag, AI 审核中 state (poll the task every 5 s while QUEUED/RUNNING), AI result card (reasons + suggestions + 「AI 审核 · Gemini」 byline + 推翻评级 for the leader + 改好重交), fallback card, new notifications, member privacy line under 交证据 when the project uses Gemini.

## 9. Tests (server)

Mock provider everywhere; one opt-in live test file (`tests/ai-live.test.ts`, skipped unless `GEMINI_TEST_API_KEY` is set and `AI_LIVE=1`) that makes exactly one light call and one tiny good call. Cover: key save/validate/delete/masking/encryption round-trip, never returned; leader change switches key; brief job success/failure/retry/stale lease; choice count validation; confirm materialises picks; re-choose locked/unlocked, totals stay 1000, notifications; howto edit clears flag; grading bands; per-task and per-project limits; good→light fallback at the daily limit; pacing; QUOTA/INVALID fallback to leader + notifications once per day; LINKS_ONLY; prompt-injection text in evidence doesn't change behaviour of the mock (the fencing function is unit-tested); ETag changes when AI results land.

## Out of M6

GitHub commit mapping (M8), Google Docs evidence (M7/M10), the small trained model, the animation pass (after M6).
