# MeritAI 重建：完整性审查、矛盾清单与问题汇总（critic）

**Role:** completeness critic and question consolidator for the from-scratch rebuild (one Expo UI for the Android APK and web/PWA, plus an API-only Next.js + Prisma backend on Vercel Hobby and Supabase Free; nothing may cost money).

**Inputs, all read in full:**
- `REQUIREMENTS.md` v2 (93 lines), cited as `REQ Lnn`.
- `proto.md`: implementation spec from the approved prototype.
- `questions.md`: 80 open decisions, cited as `Qnn`.
- `infra.md`: free-tier research.
- `lessons.md`: lessons from the old code.
- I also spot-checked `docs/prototype/index.html`, cited as `PROTO Lnn` (settings screen L965–986, invite code L979/L1329, Google Doc chip L1096), plus `README.md` and `REQUIREMENTS-v1-original.md`.

**New facts I verified today (2026-09-18), because no report covered them:**
1. **Supabase Free has no automatic database backups and no point-in-time recovery.** Backups start on Pro ($25/month, 7 days). Source: supabase.com/pricing.
2. **Android developer verification.**
   - From **2026-09-30**, certified Android devices in Brazil, Indonesia, **Singapore** and Thailand will only install apps whose developer is registered and verified with Google. This covers sideloaded APKs, so APKs downloaded from GitHub are affected. The rule goes **global in 2027**.
   - A free "limited distribution" account (students and hobbyists) can share an app with **at most 20 devices**. Full verification needs ID and a registration fee, reported as a one-time US$25 (**[verify]** the exact fee).
   - Power users can still install unverified apps through a one-time "advanced flow": turn on developer mode, restart, wait one day, then confirm with biometrics.
   - Sources: developer.android.com/developer-verification and android-developers.googleblog.com/2026/03/android-developer-verification.html.

Tags used below:
- ✅ covered correctly
- ⚠️ partly covered
- ❌ not covered by any report
- ✗ a report got it wrong
- **[verify]** not confirmed from an official source

---

## 0. Top findings (read this first)

1. **Supabase Free has no backups (❌ in every report).** It also pauses after 7 days without activity, and while the project is paused its own `pg_cron` stops. Nothing protects the data today, so this is a free-tier change the user must approve (R8-3).
2. **Android developer verification threatens "APK on GitHub Releases, free" (❌ in every report).**
   - Singapore users are blocked from 2026-09-30. Everyone else is blocked in 2027 unless the developer registers.
   - The free route caps installs at 20 devices, and the paid route costs money. The user must decide (R9-1).
3. **No report asks how many teams will use the app.** Every free-tier risk depends on that number: 1 GB storage (about 40 files of 25 MB), 5 GB egress, 4 h of active CPU on Vercel with a **30-day feature stop** when exceeded, and Gemini free-tier requests per day. Asked in R8-4.
4. **Members are never told their work goes to the leader's free Gemini account**, where Google may use it for training and humans may read it. Q75 only warns the leader (R9-3).
5. **REQ items no report covers:**
   - **PR** evidence (REQ L34).
   - Google **Slides/Sheets** (REQ L36 names only Google Docs, but PPT work is common).
   - A **Chinese** rule parser. Only lessons.md notes the old one was English-only.
   - Personal contribution shown as **points vs. share** (REQ L49 says 「0%」).
   - Who writes the **English copy**.
   - Whether an **iPhone is available** for testing the PWA.
   - The Android **ABI** choice.
   - An **APK install guide** page.
6. **Errors in the reports:**
   - infra.md asks "JDK 17 or JBR 21?". lessons.md proves Android Studio's JBR 21 already built SDK 57 release APKs on this PC, so this is not a user question.
   - Q77 says a Google Android OAuth client with a SHA-1 is required. It is not, if sign-in runs as a server-side web OAuth flow in a Custom Tab.
   - The Expo-account requirement for push is optional (direct FCM works).
   - "Daily keep-alive via pg_cron" is circular: a paused database stops pg_cron.

   Details are in §1.2.
7. **The UI-first rule is not yet mapped onto the build.** Roughly 20 screens are missing from the prototype. §6 attaches each one to the milestone that needs it, so mockups are approved just in time.
8. **Old code was never committed.** lessons.md says `git log` has only docs, so deleting it cannot be undone. I recommend moving it outside the repo instead (R7-1).

---

## 1. REQUIREMENTS.md, line by line: what the reports cover, miss or get wrong

### 1.1 Walkthrough

| REQ | Requirement | Coverage | Gap or correction → question |
|---|---|---|---|
| **§1 定位** | | | |
| L6 | A real product, finished before launch | ⚠️ Q73 (non-commercial), Q76 (OAuth publishing), Q65 (account deletion) | ❌ **No expected scale** → R8-4. ❌ **No backups on Supabase Free** (verified) → R8-3. ❌ **No crash or error reporting** while Vercel keeps logs for only 1 h (infra §1.5) → R22-4. ❌ **Android developer verification** → R9-1. "做完整再上线" means only the user's tablet gets builds until M13 (§6). |
| L7 | Student leaders and members, plus any team (clubs, small companies, competitions) | ⚠️ Q1, Q2, Q73 | ❌ **Members' work is processed under the leader's AI account**, with free-tier Gemini training; only the leader is warned (Q75) → R9-3. "小公司" and Vercel's non-commercial rule → R9-2. |
| L8 | Coding and non-coding work (reports, PPT, design, research) | ⚠️ Q13, Q39 | ❌ **Google Slides/Sheets** are not considered, although PPT-style work often lives in Slides → R10-2. Design tasks need image understanding; only Gemini and Claude see images in PDFs, and DOCX/PPTX need image extraction (infra §6.4). |
| **§2 核心功能** | | | |
| L11 | AI splits the work and shares it out evenly | ✅ proto new1–6, Q11, Q12, lessons d.2–d.4 (balancing algorithm and regression tests) | None. |
| L12 | Monitor progress, catch free-riders | ✅ Q50 (overdue notice to the team), feed | None. |
| L13 | Automatic review of contributions (code and files) | ✅ Q25–Q41 | "全部必须有", yet the no-key mode has no automatic review. The fallbacks in Q25/Q26 are the answer → R4-2, R4-3. |
| L14 | Team contribution report | ⚠️ Q64, infra §9 (CJK font), lessons f.5 | ❌ **Personal contribution as absolute points (out of 100) or as a share of what the team earned?** (REQ L49 says 「0%」) → R18-1. |
| **§3 建项目与 AI 拆任务** | | | |
| L17 | Input: any brief document or typed text; manual create/edit/delete without AI | ⚠️ Q28, Q4; proto §9.3 (no edit/delete UI after creation) | ❌ **The no-key rule parser must read Chinese briefs** (「占 30 分」「30%」); the old parser was English-only (lessons 0.9, f.4) and Q28 is silent → R12-1. Word briefs need `.docx` text extraction (free). Brief uploads must also go direct to storage because of the 4.5 MB limit (infra §1.2). Task edit/delete screens need mockups (§6, M4). |
| L18–20 | Choice questions (pick N, or one method for the whole team): AI recommends, leader confirms, then tasks are split | ⚠️ Q16 | ❌ **REQ asks for 「优缺点」 for each method; the prototype shows one sentence (PROTO new4).** Not in questions.md → R12-2. The path when there is no choice question (skip new4) is only a default in proto. A third kind of choice, "each member picks a different topic", is not in REQ → confirm out of scope (R21-4). |
| L21 | AI recommends only on workload, sources and difficulty | ✅ | A prompt rule; no question. |
| L22 | Key optional at creation; without it, rule parsing, no choice detection, no file review | ✅ Q25, Q26, Q69 | Key validation on save (one test call) is a default in M6. Manual mode never asks for a key (proto) → covered by Q69 / R18-3. |
| L23 | AI suggests a due date per task (by milestone); the leader edits each one | ✅ Q15; proto bug: new5 dates are static | None. |
| L24 | Team size → equal packages; pick one each, first come first served | ✅ Q1, Q11; lessons d.5 (race-safe claim) | None. |
| L25 | Switch to an unpicked package before starting | ✅ Q17, Q18 | None. |
| L26 | Swap needs both sides' consent and neither package started | ✅ Q21 | None. |
| L27 | Leader resplit (only unstarted tasks move) and move a single task | ✅ Q22, Q23 | Q23 recommends also moving **started** tasks, which runs against the spirit of L27 (「已开始…留在原负责人那里」). This must be the user's call → R13-4. |
| L28 | New tasks go to the lightest package; all points rescaled to keep 100 | ⚠️ Q9, Q10, Q11 | ❌ The **owner of the lightest package gets a new task without consent**, and the Q52 matrix has no notification for it → added to the R15-1 table. Can the leader pick the target package? Default: automatic, then move it (L27). |
| L29 | Highlighter colour per member; neutral colour for unpicked packages | ✅ Q24 | None. |
| **§4 任务完成与证据** | | | |
| L32 | Everything is a task, including meetings | ✅ | None. |
| L34 | Code: GitHub commits **or PRs**; AI maps commits to tasks; manual fix; graded at 「我做完了」 | ⚠️ Q26, Q34, Q35; lessons f.1 | ❌ **PRs are not asked about anywhere.** Open vs merged PRs? Squash merges create new SHAs, so commits can be double-counted → R11-3. Gemini's free quota forces batched matching (infra §6.1) → R18-4. A 「我做完了」 with zero commits is a proto [Q] (default: disabled). |
| L35 | Files (Word/PDF/PPT/images) reviewed by AI | ⚠️ Q39, Q40, infra §6.4 | ❌ **A 25 MB PDF is about 33 MB once base64-encoded, above Claude's 32 MB request limit** (infra §6.2 gives 32 MB; nobody accounted for the base64 overhead) **[verify]**. It then needs the Files API or a lower cap, which supports R8-2. |
| L36 | Pick one Google Doc from Drive; AI reads it and sees who edited it; access only that file | ⚠️ Q37, Q38, infra §7 | ❌ Slides/Sheets → R10-2. ⚠️ The revision list needs the picker to have **writer** access and may be incomplete (infra §7.4) → R10-1 wording. A GitHub-only user must connect Google first (UX, M10). |
| L37 | Tasks without files: the owner marks them done | ✅ Q42 | None. |
| L38 | Insufficient evidence means not complete; the leader can override, even on their own tasks; overrides are visible | ✅ Q31, Q32 | None. |
| **§5 计分** | | | |
| L41–42 | 100 points; contribution = points × grade | ✅ Q8 | Self-marks and overrides count as full points (proto). |
| L43–47 | Grades shown as words; internal 0–100 hidden | ✅ Q41 | In no-key leader grading there is no internal score; store null. |
| L48 | Badges are permanent | ✅ Q43–Q46 (the 12 badge definitions exist only in the prototype) | None. |
| L49 | No base points; doing nothing = 0% | ⚠️ | ❌ The "%" wording vs the prototype's 「分」 → R18-1. |
| L50 | All data public to the team | ⚠️ Q40 (files), proto §9.1.8 | ❌ No question on whether members can see **unreviewed** evidence and **open** others' files → R11-2. |
| **§6 提醒与通知** | | | |
| L53 | Push (Android, iPhone PWA), Discord/Telegram | ✅ Q52, Q54–Q57, infra §4 | ❌ Desktop web push is not in REQ; it is free and the same code → R16-4. ❌ Phones without Google Play services (e.g. Huawei) get no FCM push; disclosed in R16-4. |
| L54–57 | Each reminder once; 24 h → owner; overdue → team; Sunday 20:00 summary | ✅ Q47–Q53; lessons f.6 (unique constraint) | Timing precision is a free-tier change → R8-1. |
| L58 | Drop the "no activity for days" warning | ✅ | Tension with the 全勤 badge (proto §9.1.7) → R6-2 table. |
| **§7 项目结束与数据删除** | | | |
| L61 | Remind the leader after the deadline; auto-end after 7 days | ✅ Q59–Q61 | ❌ What non-leaders see while waiting (proto [Q]) → mockup at M5. |
| L62 | 14-day grace, report PDF, then delete everything | ✅ Q62–Q65 | PDF download differs on Android (share sheet) and web (lessons b.6.3). No backups means deletion is final. |
| L63 | 25 MB per file | ✅ Q40, infra §2.1 | A forced change → R8-2. |
| **§8 账号** | | | |
| L66 | GitHub/Google login; merge on the same verified email | ✅ Q70, lessons e.2 | The web/PWA OAuth flow needs a redesign (lessons b.6.1; one-time code exchange). A home-screen PWA on iPhone does not share storage with Safari, so users sign in again (infra §4.2). |
| L67 | GitHub required only when the project has a repo | ✅ Q36 | None. |
| L68 | Invite by code/link and by email/GitHub username; any member can invite; leave and remove | ⚠️ Q71, Q5; proto §9.1.5 | ❌ **Opening an invite link on Android** (App Links need `assetlinks.json`) is raised only in lessons b.6.2 → R14-2. The member-management UI is missing (proto §9.3). The new6 email/username field has no send button. |
| L69 | No invite emails | ✅ | The developer still needs a **working Google account** for Cloud, Firebase, Gemini and the consent-screen email (infra §10) → R7-3. |
| **§9 AI** | | | |
| L72 | The leader enters the key; the team shares it | ✅ Q66 | None. |
| L73 | Gemini, Claude, OpenAI | ⚠️ infra §6, Q67 | ❌ **Claude and OpenAI cannot be tested without paying** (infra asks; questions.md does not) → R9-4. |
| L74 | No key → rule parser | ✅ | None. |
| **§10 平台** | | | |
| L77 | Native Android APK on GitHub Releases, no store | ⚠️ infra §5.3, lessons c, Q78 | ❌ **Android developer verification** (new) → R9-1. ❌ ABI choice (only lessons c.4) → R20-1. ❌ **Install guide** ("allow unknown sources", Play Protect warning, and possibly the advanced flow) → R20-4. |
| L78 | iPhone PWA with push | ✅ Q57, infra §4.2 | ❌ **Nobody asks whether anyone has an iPhone (iOS 16.4+) to test with.** OAuth inside a home-screen PWA is known to be flaky → R20-3. |
| L79 | Desktop web | ✅ Q80 | None. |
| L80 | zh/en; Chinese in the PDF | ✅ Q72, infra §9 | ❌ **Who writes and approves the English copy?** (proto Q17, not in questions.md) → R19-3. |
| L81 | Vercel + Supabase | ✅ | None. |
| §11 | "保留" column | ✅ questions §11.14 | "保留" now means re-implementing the behaviour. |
| §12 | UI first | ⚠️ proto §9.3 lists the missing screens | ❌ No report schedules the mockups against the build → §6 gates. |

### 1.2 Errors and inconsistencies inside the reports

| # | Report | Claim | Correction |
|---|---|---|---|
| E1 | infra §5.3, §13A.6, §14 q13 | "No JDK 17 on this PC; ask JDK 17 vs JBR 21" | lessons §c.1/§c.5: the SDK 57 release APK was **built successfully with Android Studio's JBR 21.0.8**, and a Gradle-provisioned Temurin 17 also exists in `~/.gradle/jdks`. Use JBR 21 and do not ask the user. |
| E2 | questions Q77 | Google Cloud "Android client (needs the release signing key's SHA-1)" is required | Not needed when Google sign-in runs as the server-side web OAuth flow in a Custom Tab (lessons e.1, b.5). Needed **only** if the native Drive-picker fallback is used (infra §7.3). Mark it conditional. |
| E3 | questions Q56, Q77 | An Expo account is needed for Android push | Optional. Direct FCM HTTP v1 with a service account works without Expo (infra §4.1, plan B) → R22-3. |
| E4 | questions Q74 | "A daily keep-alive through the scheduler" | If the scheduler is `pg_cron` alone, a paused project stops `pg_cron` (infra §2.2), which is circular. At least one **external** trigger (GitHub Actions or cron-job.org) must call the API. The 10–15-minute tick already covers activity. |
| E5 | questions Q48 option B | GitHub Actions minutes are limited on private repos | The repo `JTing904/MeritAI` is **public** (infra §1.5), so minutes are unlimited. The real risk is that **schedules turn off after 60 days with no repo activity**. |
| E6 | lessons e.6 | Dev and prod need two GitHub **OAuth Apps** (one callback URL each) | If a **GitHub App** is chosen (infra §8, Q35), it allows several callback URLs **[verify, believed up to 10]**. It still has only one webhook URL, so a separate dev/staging app is still useful for webhooks. |
| E7 | proto §6.2 vs Q66 | Masked key hint: last 3 vs last 4 characters | Use the last 4 (Q66). Trivial. |
| E8 | questions Q38 vs infra §7.3 | Android Google Doc picking via "a hosted web picker page" vs Google's "desktop/mobile Picker with `trigger_onepick`" | Two different mechanisms, **both unverified**. Run a spike at M10 before promising anything to users; the fallback is web-only picking. |
| E9 | infra §6.1 vs §6.2 | Inline file sizes | No report considers base64 overhead: 25 MB becomes about 33.3 MB, over Claude's 32 MB request limit **[verify]**. Use the Files API or keep the per-file cap ≤ 20 MB. |
| E10 | questions Q64 | "Generate the PDF once and cache it", but "in the downloader's language" | Cache one PDF **per language** (at most 2). Minor. |
| E11 | questions §0 | 16 schema-blocking decisions | Misses schema-affecting items: separate **project code / group label** fields (proto new1 [Q]) → R1-4; **project language** (Q72); **notification read state** (proto §4.3); **evidence visibility** (R11-2). |
| E12 | lessons a.2 vs infra §2.5 | `?pgbouncer=true` | lessons says it may be ignored by Prisma 7's `pg` adapter; infra still lists it. Verify at M7 (technical, not for the user). |
| E13 | questions Q75 | Gemini data-use notice only next to the key field | Leaves out the members whose files are sent → R9-3. |
| E14 | infra §0 point 5 | Target region only inferred from this PC (Malaysia) | Must be asked (R7-4). It also sets how urgent R9-1 is (Singapore is affected from 2026-09-30). |

---

## 2. Contradictions between the prototype and the requirements

These are all things the user **approved in the prototype** that disagree with the text of REQUIREMENTS.md. Each needs an explicit decision, because the prototype does not override the spec automatically.

| # | Topic | REQUIREMENTS.md | Prototype | Question |
|---|---|---|---|---|
| C1 | Meaning of 拿一半 | L46: a grade worth half; L38: 「证据不够…不算完成」 | Stays in the open list with 「可重交拿满」. Resubmitting **clears** the half points to 0 (PROTO L1580–1583). | R4-4 |
| C2 | Colour of unpicked packages | L29: one 「待选色」 | Each unpicked package gets a different palette colour, which can match a member's colour (`MKT_WAIT`, PROTO L666) | R1-3 |
| C3 | Team size | Not specified | Stepper clamped to 2–8, but only 6 colours (PROTO L1613, L32–37) | R1-1 |
| C4 | Leader edits due dates | L23: 「组长可以逐个修改」 | new5 dates are static text; no edit UI after creation, although pick's hint promises 「组长可以再改」 | R5-3, UI gate M2/M4 |
| C5 | Manual edit/delete tasks | L17: create, edit, delete | After creation only 「加任务」 (name + points). Delete exists only inside new5. | R5-2, UI gate M4 |
| C6 | Move a single task | L27 | No UI | R13-4, UI gate M3 |
| C7 | Who can invite | L68: any member | Invite code shown only in the leader's settings (PROTO L979) and new6 (L1329); the new6 email field has no send button | R5-2, R17-1 |
| C8 | Files with no AI key | L22/L74: files can't be reviewed | No path at all to complete a doc/design/research task | R4-2 |
| C9 | Code with no AI key | Silent | Silent | R4-3 |
| C10 | Override scope | L38: general ("推翻 AI 的判断") | Only 不通过 → 通过 (PROTO L1050) | R5-1 |
| C11 | Transparency | L50: everything is public | Others' commits/files are hidden until reviewed; nobody can open another person's file | R11-2 |
| C12 | Method choice | L20: 「列出每种做法的优缺点」 | One sentence per method | R12-2 |
| C13 | Google Doc editors | L36: 「也能看谁编辑过」 | Shows 「思远 82% · 晓雯 18%」 (PROTO L1096), which the free `drive.file` scope and the Drive API cannot provide | R10-1 |
| C14 | Splitting tasks | Silent | new6: 「任务不能切得更细」, yet the sample tasks are split parts (「前半」「结论章节」) | R2-4 |
| C15 | Manual mode due dates | Reminders depend on due dates (L55–56) | Manual rows have no due-date field (PROTO L1286) | R5-3 |
| C16 | Brief photos without a key | L22: rule parser is rough | Upload hint promises 「图片（拍照）都行」 even without AI (PROTO L1180) | R12-1 |
| C17 | 25 MB | L63 | 「最大 25MB」 (PROTO L1098) | Free tier forces a change → R8-2 |
| C18 | End-of-project reminders | L54: 「每种只发一次」; L61: remind the leader | Sample notice on day 2 says 「再过 5 天没确认」, which implies repeats | R17-3 |
| C19 | Activity tracking | L58: the inactivity rule is removed | The 全勤 badge rewards 「连续 4 周都有进展」 | R6-2 |
| C20 | Notification types | L55–57: three reminder types | Also swaps, packages ready, AI results, badges, resplit; the push toggle covers 「换包请求」 | R15-1 |
| C21 | Desktop web | L79: desktop browser | Phone-only layout | R19-2 |
| C22 | GitHub repo | L67 requires connecting | new1 is a free-text field with no connect flow; settings shows 「未连接」 | R10-4, UI gate M8 |
| C23 | Project settings access | Leader tools (L27–28) | Settings is reachable only via the pick screen's gear; the project page has no gear for the leader | UI gate M3 |
| C24 | 先下手为强 badge | Not in REQ | The leader is sent to pick right after new6, so the leader almost always wins it | R6-2 |
| C25 | README | Architecture | README L84/L150 says "Next.js (web, API, PWA)", but web/PWA now come from Expo | Update README at M12 (no question) |
| C26 | Invite code format | Not in REQ | Proto `MKT-7Q4P` (project prefix + 4 characters); old code used 8 characters with no prefix | Default: `{code prefix}-{4 chars}` when a code exists, otherwise 6 random characters; include in R17-1 |
| C27 | Leaderboard, feed, 12 badges, estimated hours | Not in REQ (L48 mentions badges only as permanent) | Present and approved in the UI | Treat as **in scope, approved via the prototype**. Only the rules need answers (R6). |

---

## 3. Places where "free only" forces a behaviour change (the user must approve)

| # | Free-tier limit (source) | What it forces | User-visible effect | Question |
|---|---|---|---|---|
| F1 | Vercel Hobby cron runs once a day, ±59 min (infra §1.3) | External scheduler (Supabase `pg_cron` + `pg_net` every 10–15 min, backed up by GitHub Actions or cron-job.org) | 24 h, overdue and Sunday 20:00 messages arrive up to about 15 min late | R8-1 |
| F2 | Vercel request body limit is 4.5 MB (infra §1.2) | Clients upload straight to Supabase Storage with signed URLs; resumable TUS may be needed on weak mobile networks | None for users; engineering only | none |
| F3 | Supabase Storage is 1 GB **total**, 50 MB per file, 5 GB egress per month (infra §2.1) | Lower the per-file cap, keep only the latest version, set a per-project quota, or delete originals after review | May break REQ L63 (25 MB); teammates may be unable to open old versions | R8-2, R8-4 |
| F4 | Supabase pauses after 7 days of inactivity; `pg_cron` stops while paused (infra §2.2) | An external keep-alive; manual restore if it ever pauses | Holiday downtime risk | R8-3 |
| F5 | **Supabase Free has no backups** (verified today) | A free self-made backup (weekly encrypted `pg_dump` via GitHub Actions to a private place), or accept the risk | Data loss on accident | R8-3 |
| F6 | Vercel Hobby: 4 active-CPU hours per month; going over **stops the feature for 30 days** (infra §1.5) | Cache report PDFs; limit heavy DOCX/PPTX parsing; monitor usage | The whole app could go down if usage spikes | R8-4 (scale) |
| F7 | Vercel Hobby is non-commercial only (infra §1.4) | No ads or payments, ever, unless the user pays for Pro | Business model | R9-2 |
| F8 | Gemini free tier: content used to improve Google's products, human review, 18+, unsupported in China/Hong Kong, few requests per day (Flash ≈ 20/day **[verify]**) (infra §6.1) | Notices, batching, lighter models, per-task and per-project review limits | Members' privacy; slower or queued reviews | R9-3, R18-4, R7-4 |
| F9 | Claude and OpenAI have no free API tier (infra §6.2–6.3) | Ship untested adapters or postpone them | Possible bugs for leaders who use Claude or OpenAI | R9-4 |
| F10 | Only the non-sensitive `drive.file` scope is free; restricted scopes need a paid assessment (infra §7.1) | Must use the Picker (no pasted links); editor history only when the picker has edit rights; no per-person percentages; the Android picker opens in a browser | Different from the prototype's 82% / 18% chip | R10-1, R10-3 |
| F11 | Google OAuth "Testing" mode: 100 users and 7-day token expiry for Drive (infra §7.1) | Publish to production; needs a home page plus privacy and terms pages; logo brand verification is free but optional | We write and host a privacy policy | R24-3 |
| F12 | A custom domain costs money | Use `*.vercel.app` | The URL looks like `meritai-xxx.vercel.app` | R24-2 |
| F13 | FCM needs Google Play services (infra §4.1) | Discord/Telegram as the fallback | Huawei and similar phones get no push | R16-4 |
| F14 | iOS Web Push needs 16.4+ and "Add to Home Screen" (infra §4.2) | An install guide | iPhone users must install the PWA | R16-4 |
| F15 | No email (REQ L69) | Invites appear only in the app; no email sign-in or reset | The invitee has to be told out of band | R17-1 |
| F16 | GitHub Actions on a public repo: free, but schedules turn off after 60 days of repo inactivity; a private repo gets only 2,000 minutes a month (infra §3) | Keep the repo public; keep backup schedulers alive | Secrets must never be committed (the repo is public) | R23-3 |
| F17 | **Android developer verification** (verified today): free limited distribution means 20 devices; full verification costs money (reported US$25 **[verify]**) | Choose limited distribution, the advanced sideload flow, or pay | Singapore users blocked from 2026-09-30; global in 2027 | R9-1 |
| F18 | No Play Store | No auto-update; an in-app update check only; EAS Update (free up to 1K MAU) needs an Expo account | Users update by hand | R20-2 |
| F19 | No EAS Build (local Gradle, per the task) | Builds happen only on the user's PC | Releases depend on this PC and its keystore | none (info) |

---

## 4. Consolidated, de-duplicated question list (Chinese, for the user)

How to use this list:
- **At most 4 questions per round.** Each question has 2–4 options, and **the recommended option is listed first and marked 【推荐】**.
- Every question notes the source report IDs.
- **Rounds R1–R6 block the database schema.** Ask them before M1 or M2 writes Prisma models. R6 (badges) can wait until M11 if needed.
- **R7 is needed before M0 (clearing out and the skeleton).** It does not touch the schema, so you may ask it **first**, in parallel, to start M0 at once.
- For each later round, the "needed before" line says which milestone it blocks, so it can be asked just in time.

| Round | Topic | Needed before |
|---|---|---|
| R1 | 团队与角色 | M2 (schema) |
| R2 | 分数与任务 | M2 (schema) |
| R3 | 开工与人员变动 | M2 (schema) |
| R4 | 证据与评分 | M2 (schema) |
| R5 | 权限与时间 | M2 (schema) |
| R6 | 徽章 | M2 (schema), can wait until M11 |
| R7 | 开工必需 | **M0** |
| R8 | 免费限制（一） | M7 (R8-2 before M4) |
| R9 | 免费限制（二） | M6 / M13 |
| R10 | Google 文档与 GitHub | M8 / M10 |
| R11 | 证据细节 | M4 / M8 |
| R12 | 建项目流程 | M2 / M6 |
| R13 | 成员与任务包 | M3 |
| R14 | 邀请与帐号 | M2 / M10 |
| R15 | 通知（一） | M5 |
| R16 | 通知（二） | M5 / M9 |
| R17 | 项目结束与报告 | M5 / M11 |
| R18 | 隐私与 AI | M4 / M6 / M13 |
| R19 | 界面与语言 | M1 |
| R20 | 安卓发布 | M0 (R20-1) / M12 / M13 |
| R21 | 小设置与范围 | M1 |
| R22 | 技术选择（一） | M1 / M7 / M9 / M13 |
| R23 | 技术选择（二） | M0 / M7 |
| R24 | 帐号与网址 | M7 / M8 / M13 |

---

### R1 团队与角色（影响数据结构）

**R1-1【小组人数】** 小组人数允许几到几人？
- A. 2–8 人，和样稿一样；荧光笔要再加 2 种颜色 【推荐】
- B. 2–6 人，刚好 6 种颜色，不用加
- C. 2–12 人，适合社团和公司；要再加 6 种颜色，颜色会不太好分
- D. 1–8 人，允许一个人自己试用

*来源：Q1，proto §9.2*

**R1-2【组长做事】** 组长一定也要选一个任务包、自己做任务吗？
- A. 一定要，组长也算一个人 【推荐】
- B. 建项目时可以选「我只管理，不做任务」，这样任务包少一个
- C. 另外加一个不算分的「监督者」角色

*来源：Q2*

**R1-3【颜色】** 成员的颜色和「待选色」怎么定？
- A. 每个项目自动分配，同一组不重复，可以自己换；没人选的包统一用灰色「待选」 【推荐】
- B. 和 A 一样，但没人选的包像样稿那样用各种彩色
- C. 每人一个固定颜色，所有项目都一样（同一组可能撞色）

*来源：Q24，proto §1.2，矛盾 C2*

**R1-4【项目标签】** 首页卡片上的「MKT201」「第 7 组」要不要分开填？
- A. 分成三格，都是选填：简称/课程代码、课程或团队名称、组别；没填简称就用项目名的前几个字当标签 【推荐】
- B. 保持样稿的一格「课程或团队」，系统自己猜简称
- C. 不要简称标签

*来源：proto §4.1、§4.11 [Q]；questions.md 没有这一题*

---

### R2 分数与任务（影响数据结构）

**R2-1【小数】** 贡献值要不要小数？
- A. 显示一位小数（例如 33.3 分），系统保证总和永远正好 100.0；拿一半这类得分也四舍五入到一位小数 【推荐】
- B. 全部用整数，总和 100，但每次加任务时，有的任务会多或少 1 分
- C. 显示两位小数（例如 2.25 分）

*来源：Q8，lessons d.4*

**R2-2【加任务后】** 组长后来加任务，所有任务（包括已经完成的）的分数都会按比例变少。已开始、已完成的任务还能删、能改分数吗？
- A. 全部按比例换算；已开始和已完成的任务不能删、不能改分数 【推荐】
- B. 全部按比例换算；已完成的也能删、能改分数，但要二次确认，并写进「动态」
- C. 新任务的分数只从「还没完成」的任务里扣，已完成的分数不变（和需求写的不一样）

*来源：Q9、Q10*

**R2-3【等量】** 「等量任务包」和「最轻的包」按什么算？
- A. 按贡献值（分）平均分；预计小时只做参考；「最轻」= 包里总分最少 【推荐】
- B. 按贡献值平均分；「最轻」= 包里还没做完的分最少
- C. 按预计小时平均分（没有 AI key 的项目没有小时数）

*来源：Q11，lessons d.5*

**R2-4【大任务】** 大任务可以拆开吗？一个任务可以两个人负责吗？
- A. 只在规划时由 AI 拆成几部分，组长可以改；每个任务只有一个负责人 【推荐】
- B. 分包时系统自动把大任务拆开，让每包更平均
- C. 允许一个任务两人一起负责，分数平分

*来源：Q12，lessons d.3，矛盾 C14*

---

### R3 开工与人员变动（影响数据结构）

**R3-1【开工】** 什么时候算「开始做了」？开始以后就不能直接换包或互换。
- A. 第一次有证据就算：有提交归到这个任务、附上文件或文档、或者标记完成；过期了但完全没动的不算 【推荐】
- B. 每个任务要按一个「开始做」按钮
- C. 只有「交给 AI 审核」或「标记完成」才算

*来源：Q17、Q18，proto §0.5*

**R3-2【重新分包】** 组长重新分包后，大家原来的包怎么办？
- A. 每个人保留自己的包，系统把没开始的任务重新平均放进各个包；组长先看「分包前 / 分包后」预览，再确认 【推荐】
- B. 和 A 一样，但没有预览，直接执行
- C. 没开始的包全部放出来，大家重新抢

*来源：Q22，lessons d.5*

**R3-3【退出】** 组员退出或被移除后怎么办？
- A. 已完成的分数保留，排行和报告里显示「已退出」；他没做完的任务变成没人负责，组长可以移给别人，或者让新成员选 【推荐】
- B. 他做过的全部清掉，分数归零
- C. 他的任务留在他名下不动（之后会一直过期）

*来源：Q5*

**R3-4【组长身份】** 组长可以转让或退出吗？
- A. 一个项目只有一个组长；组长可以转给任何组员；组长要退出，必须先转让 【推荐】
- B. 一个项目可以有好几个组长
- C. 不能转让；组长不能退出，只能结束项目

*来源：Q3，lessons d.5*

---

### R4 证据与评分（影响数据结构）

**R4-1【证据数量】** 一个任务可以交几份证据？
- A. 最多 5 个文件或 Google 文档，一起审核；代码任务除了提交，也可以另外附文件（例如截图、设计文档） 【推荐】
- B. 最多 5 个文件或文档，但代码任务只看提交
- C. 只能交 1 个文件或 1 个 Google 文档，和样稿一样

*来源：Q14*

**R4-2【没 key 的文件】** 项目没填 AI key 时，交上来的报告、PPT、设计由谁评？
- A. 组长手动选四个等级之一；组长自己的任务自动算「合格（组长自评）」，全组看得到 【推荐】
- B. 一上传就算合格
- C. 和开会一样，负责人自己标记完成
- D. 由另一位组员确认

*来源：Q25，矛盾 C8*

**R4-3【没 key 的代码】** 项目没填 AI key 时，代码提交怎么对应到任务？按「我做完了」后由谁评？
- A. 提交说明里写「#任务编号」就自动归类，没写的自己手动归类；按「我做完了」后由组长评 【推荐】
- B. 全部自己手动归类；有提交就算合格
- C. 全部自己手动归类；负责人自己标记完成

*来源：Q26，矛盾 C9*

**R4-4【拿一半】** 「拿一半」算完成吗？重交后怎么算？
- A. 算完成：先拿一半分，不会变成「过期」，可以重交拿满；重交后保留比较好的那次；重新审核期间，原来的分数不变 【推荐】
- B. 不算完成：过了截止就变成「过期」；重交以最新结果为准
- C. 和 A 一样，但重交以最新结果为准（可能变差）

*来源：Q30、Q31，矛盾 C1*

---

### R5 权限与时间（影响数据结构）

**R5-1【推翻 AI】** 组长推翻 AI 的判断，能改到什么程度？
- A. 四个等级都能改，也能往下改（例如怀疑抄袭、假装开过会）；必须写理由；全组看得到；可以撤销 【推荐】
- B. 只能把「不通过」或「拿一半」改成「通过」
- C. 和 B 一样，另外也能往下改，但必须写理由

*来源：Q32，矛盾 C10*

**R5-2【谁能改任务】** 建任务、改任务、删任务、改分数、改截止日期、移动任务，谁能做？
- A. 只有组长能做。组员可以选包、换包、交证据、标记完成、改自己提交的归类、邀请人、退出，也能看只读的项目设置（包括邀请码） 【推荐】
- B. 和 A 一样；另外，负责人可以改自己任务的说明，也可以申请改截止日期，由组长批准
- C. 任何组员都能加任务（加进去的任务自动放进最轻的包）

*来源：Q4，矛盾 C5、C7*

**R5-3【截止日期】** 任务的截止日期怎么规定？
- A. 每个任务都必须有截止日期，手动建的也要；只写日期就算当天 23:59；不能晚于项目截止日期；里程碑可以编辑 【推荐】
- B. 可以不填，不填的任务就没有提醒
- C. 可以晚于项目截止日期，只显示警告

*来源：Q15，矛盾 C4、C15*

**R5-4【时区】** 截止时间和「周日晚上 8 点」用谁的时区？
- A. 每个项目一个时区，默认用组长手机的时区，可以改；每个人看到的时间都自动换成自己当地的时间 【推荐】
- B. 每周小结按每个人自己的时区发，群消息按项目时区发
- C. 全部固定用马来西亚时间

*来源：Q47，infra §3*

---

### R6 徽章（影响数据结构；可以等到 M11 再问）

**R6-1【徽章范围】** 徽章怎么累计？
- A. 「连续几周」和「本周最佳」这类按项目算，「做了几次」这类跨项目累计；每个徽章记下获得的项目名和日期，项目删掉也还在 【推荐】
- B. 全部跨项目累计
- C. 全部按项目各算各的

*来源：Q43*

**R6-2【徽章规则】** 12 个徽章的具体规则，按下面附表 A 的建议可以吗？
- A. 可以 【推荐】
- B. 我要改其中几条（请告诉我哪几条）
- C. 这一版先只做其中几个徽章

*来源：Q44，矛盾 C19、C24*

**R6-3【压哨王】** 「压哨王」（截止前 10 分钟才交，不太光彩）怎么处理？
- A. 保留，但只有自己看得到 【推荐】
- B. 保留，大家都看得到
- C. 删掉这个徽章

*来源：Q45*

**R6-4【重复获得】** 同一个徽章可以拿很多次吗？
- A. 「本周最佳」这类可以重复拿，显示「×3」；其他的只拿一次，显示第一次的日期和项目 【推荐】
- B. 每个徽章都只拿一次

*来源：Q46*

#### 附表 A：徽章规则建议（给 R6-2）

| 徽章 | 样稿写的 | 建议的精确规则 |
|---|---|---|
| ⚡ 先下手为强 | 第一个选任务包 | 同一个项目里，**组长以外**第一个选包的人；之后换包也保留 |
| 🗓️ 全勤 | 连续 4 周都有进展 | 同一个项目里，连续 4 个星期（按项目时区，周一到周日）每周至少有 1 次提交归到任务、交证据或完成任务 |
| ✅ 一次过 | 连续 3 次 AI 第一次审核就通过 | 连续 3 个经过 AI 审核的任务，第一次就拿到「合格」或「优秀」；拿一半或不通过就重新算；自己标记和组长推翻的不算；跨项目累计 |
| ⏰ 准时王 | 5 个任务都在截止前完成 | 累计 5 个任务，第一次通过的提交是在截止前交的（包括自己标记完成） |
| 🤝 好队友 | 同意过一次换包 | 同意别人换包请求的人 |
| 🎨 全能选手 | 完成 3 种不同类型的任务 | 完成 3 种不同类型的任务，「开会」不算一种；跨项目累计 |
| 🧯 救火队员 | 接手别人放下的任务 | 完成一个别人开始过、或从退出成员那里移给你的任务 |
| 🏆 本周最佳 | 一周内拿到全组最多贡献值 | 同一个项目里，一周内得分最多而且大于 0；同分的人都给 |
| 🌟 三次优秀 | AI 给了 3 次「优秀」 | 累计 3 次 AI 给「优秀」（组长推翻的不算）；跨项目累计 |
| 📚 报告达人 | 完成 5 个文档任务 | 累计 5 个「文档」或「调研」任务拿到合格以上 |
| 🔥 三连冠 | 连续 3 周本周最佳 | 同一个项目里，连续 3 周拿到「本周最佳」 |
| 🐢 压哨王 | 截止前 10 分钟才交 | 某个任务第一次提交是在截止前 10 分钟内 |

---

### R7 开工必需（M0 就要用；不影响数据结构，可以最先问）

**R7-1【旧代码】** 旧代码从来没有提交到 GitHub，删了就找不回来。怎么处理？
- A. 移到仓库外面的备份文件夹（例如 `C:\Users\user\MeritAI\old-code-2026-09-18`），不再使用 【推荐】
- B. 直接删除

*来源：lessons 开头的说明；questions.md 没有这一题*

**R7-2【App 名称和包名】** App 名称和安卓包名定什么？包名以后不能改，改了用户就要重装。
- A. 名称「MeritAI」，包名 `com.meritai.app` 【推荐】
- B. 沿用旧版的 `com.meritai.mobile`
- C. 你自己定（请告诉我）

*来源：Q56，lessons b.2*

**R7-3【Google 帐号】** Google 登录、Google 文档、安卓推送、Gemini 都需要一个能正常用的 Google 帐号（之前的 Gmail 被封了）。用哪个？
- A. 新建一个专门管理 MeritAI 的 Google 帐号，只用来管理这些服务，不用来发邮件 【推荐】
- B. 用你现在自己的 Google 帐号
- C. 暂时没有能用的 Google 帐号

*来源：infra §10、§14 第 16 题*

**R7-4【用户在哪里】** 用户主要在哪里？
- A. 马来西亚和东南亚，服务器放在新加坡 【推荐】
- B. 也有中国大陆或香港的用户（Google 登录、Gemini、安卓推送在那里都用不了）
- C. 全球各地都有

*来源：infra §11.1，Q79*

---

### R8 免费限制（一）：需要你同意（R8-2 在 M4 前回答，其他在 M7 前）

**R8-1【提醒会晚一点】** 免费方案下，提醒会晚几分钟才到。最多可以晚多少？
- A. 最多晚 15 分钟（周日小结会在晚上 8:00 到 8:15 之间到） 【推荐】
- B. 最多晚 5 分钟（后台要更常检查，还是免费）
- C. 最多晚 1 小时
- D. 最多晚一天（最简单）

*来源：Q48，infra §1.3、§3，F1*

**R8-2【文件空间】** 免费存储全站只有 1GB（大约只能放 40 个 25MB 的文件），每月下载流量也只有 5GB。文件怎么处理？
- A. 单个文件最大 10MB；每个项目最多 50MB；每个任务只保留最新一版；全站快满时提醒 【推荐】
- B. 单个文件保持 25MB，其他和 A 一样（能同时用的项目会更少）
- C. 保持 25MB，但 AI 审完就删掉原文件，只留文字和审核结果（大家以后打不开原文件）
- D. 保持 25MB，所有版本都留到项目删除（空间很快会用完）

*来源：Q40，infra §2.1，F3，矛盾 C17*

**R8-3【备份和暂停】** 免费数据库没有自动备份；一周没人用，它还会自动暂停。怎么办？
- A. 用两个免费的定时器让它一直保持运行；每周自动把数据库加密备份一份（存到你电脑，或者一个私有 GitHub 仓库） 【推荐】
- B. 只让它保持运行，不做备份（万一出问题，数据就没了）
- C. 都不做（一周没人用就会暂停，要你手动去恢复）

*来源：Q74，F4、F5，今天确认的新事实*

**R8-4【规模】** 你预计同时会有多少个团队在用？免费额度有限。
- A. 20 个团队以内（大约 100 人），免费额度够用；先按这个来设计 【推荐】
- B. 20 到 100 个团队：存储和 AI 额度可能不够，需要更严格的限制
- C. 100 个团队以上：免费方案大概撑不住，需要另外想办法

*来源：questions.md 和 infra.md 都没有这一题，F3、F6*

---

### R9 免费限制（二）：需要你同意（M6 或 M13 前）

**R9-1【安卓新规定】** Google 有新规定：2026 年 9 月 30 日起，新加坡、印尼、泰国、巴西的安卓手机只能安装在 Google 登记过的开发者的 App，2027 年会推广到全球。免费登记最多只能装 20 台手机；完整登记要付费（据报道是 25 美元，还没确认）。怎么办？
- A. 现在先不用处理（马来西亚要到 2027 年才实行）；新加坡等地的用户先用网页版；2027 年之前再决定 【推荐】
- B. 马上做免费登记，最多 20 台手机，超过的人改用网页版
- C. 不登记，让用户走「高级安装」（要开开发者模式、等一天）
- D. 付费做完整登记（违反「不花钱」，要你特别同意）

*来源：今天确认的新事实，F17*

**R9-2【商业用途】** Vercel 免费版不能用在商业用途上。MeritAI 以后会收费或放广告吗？
- A. 永远免费、不放广告、不收费（接受捐款可以） 【推荐】
- B. 以后可能收费或放广告（到时候要换成付费方案）

*来源：Q73，F7*

**R9-3【AI 隐私提醒】** 用 Gemini 免费额度时，Google 可能用交上去的作业来改进模型，也可能有人工查看；拿 key 还要满 18 岁。怎么提醒大家？
- A. 组长填 key 时提醒；组员交文件时也显示一行「这个项目用免费的 Gemini 审核，内容可能被 Google 用来改进模型」 【推荐】
- B. 只在组长填 key 时提醒
- C. 不提醒

*来源：Q75，infra §6.1，F8；questions.md 只提醒组长*

**R9-4【Claude/OpenAI】** 这两家没有免费额度，我们不花钱就没法真的测试。怎么办？
- A. 代码照样写好，界面上标「测试版」；等有组长用自己的 key 时再确认能用 【推荐】
- B. 这一版只做 Gemini，另外两家以后再加

*来源：infra §6.4、§14 第 17 题，F9*

---

### R10 Google 文档与 GitHub（M8 或 M10 前）

**R10-1【编辑记录】** 免费权限只能读「用户自己选的那个文件」，也看不到每个人写了百分之几，只能看到谁在什么时候改过；而且选文件的人要有这份文档的编辑权限。怎么处理？
- A. 显示「谁编辑过、最后什么时候编辑」，只给大家看，不影响分数；交的时候保存一份内容快照 【推荐】
- B. 和 A 一样，但 AI 发现负责人几乎没编辑过时，可以降一个等级
- C. 按编辑比例分分数（做不到精确，不建议）

*来源：Q37，infra §7.4，矛盾 C13*

**R10-2【Google 类型】** 只支持 Google 文档，还是也支持 Google 幻灯片和表格？
- A. 文档、幻灯片、表格都支持（PPT 类任务很常见） 【推荐】
- B. 只支持 Google 文档，和需求写的一样

*来源：新问题（REQ L36、L8）*

**R10-3【安卓选文档】** 在安卓 App 里选 Google 文档时，会先跳到浏览器里的 Google 选择页面，选完再回到 App。可以吗？
- A. 可以 【推荐】
- B. 安卓上不支持选 Google 文档，只能在网页版选

*来源：Q38，infra §7.3（要先做技术验证）*

**R10-4【连 GitHub 仓库】** 项目怎么连 GitHub 仓库？
- A. 用 MeritAI 的 GitHub App（只能读，不能改代码），由仓库主人安装；一个项目可以连几个仓库（例如前端和后端分开） 【推荐】
- B. 和 A 一样，但一个项目只能连一个仓库
- C. 组长自己去 GitHub 设置里贴 webhook 地址和密码（比较麻烦）

*来源：Q35，infra §8，lessons f.1*

---

### R11 证据细节（M4 或 M8 前）

**R11-1【文件类型】** 可以上传哪些文件？
- A. Word、PDF、PPT、图片，再加 Excel 和 CSV；这一版不收视频、录音和 zip 【推荐】
- B. 只收需求写的 Word、PDF、PPT、图片
- C. 在 A 的基础上，也收视频和录音

*来源：Q39*

**R11-2【公开范围】** 组员能不能看到别人还没审核的提交和文件？能不能打开别人交的文件？
- A. 都能看到，也能打开最新一版，符合「全部公开」 【推荐】
- B. 只能看到审核结果，不能打开别人的文件

*来源：Q40，proto §9.1.8，矛盾 C11*

**R11-3【提交和 PR】** 代码提交和 PR 怎么算？
- A. 只归到提交者自己的任务；所有分支都算，同一个提交只算一次；项目建立之前的提交不算；PR 合并后按里面的提交算 【推荐】
- B. 和 A 一样，但也可以归到队友的任务（算帮忙写的代码）
- C. 只算主分支上的提交

*来源：Q34；PR 是新问题（REQ L34）*

**R11-4【组员连 GitHub】** 项目连了仓库，但有组员还没连 GitHub，怎么办？
- A. 只提醒他；他的提交先放在「未识别」里，他连上 GitHub 后可以认领 【推荐】
- B. 不连 GitHub 就不能加入这个项目

*来源：Q36*

---

### R12 建项目流程（M2 或 M6 前）

**R12-1【免费规则解析】** 没有 AI key 时，免费的规则解析要做到什么程度？
- A. 中文和英文都能认（「30%」「占 30 分」「30 marks」）；找不到百分比就平均分；截止日期平均排到项目截止前；照片和扫描的 PDF 提示「需要 AI key 才能读」，并建议改成手动建任务 【推荐】
- B. 只认英文

*来源：Q28，lessons f.4（旧版只认英文），矛盾 C16*

**R12-2【选择题】** 作业里的选择题怎么处理？
- A. 有几道选择题就逐题确认，选的数量要刚好；确认后不能改选（要改就手动改任务）；「选一种做法」按需求，列出优点和缺点两栏 【推荐】
- B. 和 A 一样，但确认后还能改选（还没开始的任务会重新生成）
- C. 「选一种做法」每种只写一句话，和样稿一样

*来源：Q16，矛盾 C12*

**R12-3【草稿】** 新建项目做到一半就关掉，怎么办？
- A. 自动存成草稿，只有组长看得到；确认计划后才生成邀请码；组长可以删草稿 【推荐】
- B. 不存，关掉就没了（和样稿一样）
- C. 存成草稿，而且组员可以先加入

*来源：Q7*

**R12-4【AI 出错】** AI 额度用完或 key 失效时，怎么办？
- A. 自动排队重试；超过一天还不行，就改由组长评，同时提醒组长检查 key 【推荐】
- B. 马上改由组长评
- C. 显示错误，让负责人自己再按一次

*来源：Q29*

---

### R13 成员与任务包（M3 前）

**R13-1【人满了】** 任务包都被选走了，还有人用邀请码加入，怎么办？
- A. 让他进来，显示「还没有任务包」，并提醒组长重新分包 【推荐】
- B. 挡住，不让加入
- C. 自动重新分包

*来源：Q6*

**R13-2【没人选的包】** 一直没人选的任务包怎么办？
- A. 不设选包期限；组长可以直接指派给还没有包的人；没人负责的任务，提醒发给组长；过期时通知全组「没人认领」 【推荐】
- B. 过几天自动分给还没有包的人
- C. 没人负责的任务不发提醒

*来源：Q19*

**R13-3【换包请求】** 换包请求有什么规则？
- A. 每人同时只能发 1 个请求，发起人可以取消；3 天没回应就自动失效；任何一方开工、换包或重新分包时也会失效；组长不能强制别人互换 【推荐】
- B. 不限数量，也不会过期

*来源：Q21*

**R13-4【移动任务】** 组长移动单个任务时，有什么限制？
- A. 没完成的任务都能移，做到一半的也可以；已有的证据跟着任务走；不用对方同意，但会通知对方 【推荐】
- B. 只能移还没开始的任务（更符合「已开始的任务留在原负责人那里」）
- C. 要对方同意才能移

*来源：Q23，REQ L27*

---

### R14 邀请与帐号（M2 或 M10 前）

**R14-1【邀请码】** 邀请码有什么规则？
- A. 有效到项目结束；组长可以重新生成（旧的就失效）；用码加入不需要批准；被移除的人不能用码回来；按邮箱或 GitHub 用户名邀请的人，以后注册时会在首页看到邀请 【推荐】
- B. 和 A 一样，但用码加入需要组长批准

*来源：Q71，lessons f.7，矛盾 C26*

**R14-2【邀请链接】** 在安卓手机上点邀请链接，会打开什么？
- A. 装了 App 就直接打开 App，没装就打开网页版 【推荐】
- B. 一律打开网页版

*来源：lessons b.6.2；questions.md 没有这一题*

**R14-3【放弃包】** 组员可以只「放弃」自己的包，不选别的吗？
- A. 不行，只能换包或退出项目 【推荐】
- B. 还没开工时可以放弃

*来源：Q20*

**R14-4【帐号合并】** Google 和 GitHub 的邮箱不一样时，怎么合并成一个帐号？
- A. 登录后在「我」页手动连接另一个；如果那个帐号已经被别人用了，就拒绝，不合并两个旧帐号 【推荐】
- B. 用户可以申请把两个旧帐号合并

*来源：Q70，lessons e.2*

---

### R15 通知（一）（M5 前）

**R15-1【通知表】** 哪些事要通知谁、用什么方式？按下面附表 B 可以吗？
- A. 可以 【推荐】
- B. 我要改其中几条

*来源：Q52，proto §5.3，矛盾 C20*

**R15-2【半夜不打扰】** 半夜的通知怎么处理？
- A. 晚上 11 点到早上 8 点（按项目时区）不推送、不发群，早上 8 点再发 【推荐】
- B. 不设安静时段
- C. 每个人自己设

*来源：Q49*

**R15-3【过期文案】** 任务过期时，通知全组的文案怎么写？
- A. 点名，用几句固定的调侃文案轮流发；用名字或「TA」，不用「他/她」 【推荐】
- B. 不点名
- C. 每次由 AI 现写（会用组长的额度）

*来源：Q50*

**R15-4【每周小结】** 每周小结怎么发？
- A. 内容按样稿；每个项目各发一条；没进展的周也发；项目结束后就停 【推荐】
- B. 没进展的周就不发
- C. 把所有项目合并成一条

*来源：Q53*

#### 附表 B：通知表（给 R15-1）

| 事件 | 谁收到 | App 内 | 手机推送 | Discord/Telegram 群 |
|---|---|---|---|---|
| 任务 24 小时后到期 | 负责人（没人负责时发给组长） | ✓ | ✓ | ✗ |
| 任务过期 | 全组 | ✓ | ✓ | ✓ |
| 每周小结 | 全组 | ✓ | ✓（可以关） | ✓ |
| 收到换包请求 | 被请求的人 | ✓ | ✓ | ✗ |
| 换包结果（同意、拒绝、失效） | 发起人 | ✓ | ✗ | ✗ |
| 任务包分好了 / 重新分包了 | 全组 | ✓ | ✗ | ✗ |
| **我的包里加了新任务 / 有任务移给我**（新增） | 新负责人 | ✓ | ✓ | ✗ |
| AI 审核结果 / 组长推翻了我的任务 | 负责人 | ✓ | ✗ | ✗ |
| 组长推翻了任何任务 | 全组 | 显示在「动态」里 | ✗ | ✗ |
| **有任务等组长审核（没有 key 的项目）**（新增） | 组长 | ✓ | ✓ | ✗ |
| **AI key 失效或额度用完**（新增） | 组长 | ✓ | ✓ | ✗ |
| 解锁徽章 | 本人 | ✓ | ✗ | ✗ |
| 项目过了截止日期，请确认已交 / 快要自动结束 | 组长 | ✓ | ✓ | ✗ |
| 项目已结束 / 快要删除了 | 全组 | ✓ | ✓ | ✓ |
| 收到邀请 | 被邀请的人 | 首页卡片 | ✗ | ✗ |
| 有人加入 / 退出 / 被移除 | 全组 / 被移除的人 | ✓ | 只推给被移除的人 | ✗ |

---

### R16 通知（二）（M5 或 M9 前）

**R16-1【再提醒】** 什么情况下要重新提醒？
- A. 截止日期改晚了，就重新提醒一次；换了负责人，新负责人会收到自己的提醒；离截止不到 24 小时才建或才分到的任务，马上提醒（剩不到 1 小时就不发） 【推荐】
- B. 每个任务只提醒一次，之后怎么改都不再提醒

*来源：Q51，infra §3 第 4 条*

**R16-2【Discord】** Discord 群怎么连接？
- A. 组长贴上频道的 Webhook 网址，连上后发一条测试消息 【推荐】
- B. 做一个 MeritAI 机器人，邀请进服务器

*来源：Q54*

**R16-3【Telegram】** Telegram 群怎么连接？
- A. 点「连接」，然后在 Telegram 里选群。这需要你用 BotFather 免费建一个机器人，名字你来定 【推荐】
- B. 把机器人拉进群，再在群里发 /link 加上一段代码

*来源：Q55*

**R16-4【推送范围】** 哪些设备能收到推送？
- A. 安卓 App、iPhone 网页版、电脑浏览器都能收；iPhone 没「添加到主屏幕」时显示教学提示，但不强制。没有 Google 服务的手机（例如华为）收不到推送，只能靠群通知 【推荐】
- B. 只做需求写的安卓和 iPhone
- C. iPhone 必须「添加到主屏幕」才能使用

*来源：Q57，infra §4，F13、F14*

---

### R17 项目结束与报告（M5 或 M11 前）

**R17-1【结束和延期】** 项目怎么结束？能延期、能重新打开吗？
- A. 组长任何时候都能结束项目（要二次确认，全组会收到通知）；截止日期可以延后；结束后 14 天内可以重新打开 【推荐】
- B. 只能在截止日期之后结束，结束后不能重新打开
- C. 组员也能按「结束项目」

*来源：Q59、Q60*

**R17-2【结束后】** 项目结束后，还能做什么？
- A. 全部冻结，不能再交证据或推翻评分；只让正在审核的跑完 【推荐】
- B. 14 天内还能交证据、推翻评分

*来源：Q62*

**R17-3【提醒次数】** 项目结束前后要提醒几次？
- A. 截止当天和自动结束前一天各提醒组长一次；删除前 3 天和前 1 天各提醒全组下载报告 【推荐】
- B. 每种只提醒一次
- C. 每天都提醒组长

*来源：Q61、Q63，矛盾 C18*

**R17-4【报告内容】** 贡献报告里放什么？
- A. 第一页是全组总结（每人得分、完成数、过期数）；后面每人一节（任务、等级、AI 的理由、组长推翻和理由、是否已退出）；用下载的人的语言；项目进行中可以在 App 里看，结束后才能下载 PDF 【推荐】
- B. 简单一点，只有一张全组表格
- C. 和 A 一样，但项目进行中也能下载 PDF

*来源：Q64*

---

### R18 隐私与 AI（M4、M6 或 M13 前）

**R18-1【个人贡献】** 个人贡献怎么显示？
- A. 显示「得了几分（满分 100）」，旁边加上「占全组已得分的百分比」 【推荐】
- B. 只显示得了几分
- C. 只显示百分比

*来源：新问题（REQ L49「0%」）*

**R18-2【删除帐号】** 要不要做「删除我的帐号」？
- A. 要做：删除后，进行中的项目里显示「已删除的用户」，分数保留在报告里 【推荐】
- B. 不做

*来源：Q65*

**R18-3【AI key】** 组长的 AI key 谁能看到？
- A. 存进去之后，连组长也只看到最后 4 位；组员只看到「Gemini · 已设置」；换组长时删掉旧的 key，新组长自己填 【推荐】
- B. 换组长时保留旧的 key

*来源：Q66、Q69，infra §11.5*

**R18-4【AI 额度】** Gemini 免费额度很少（质量好的模型可能每天只有大约 20 次）。怎么省着用？
- A. 归类提交用额度多的轻量模型，审核作业用质量好的模型；每个任务每天最多审核 3 次，每个项目每天最多 30 次；设置页显示今天用了几次 【推荐】
- B. 全部用轻量模型（额度多，但质量差一点）
- C. 不限制次数

*来源：Q67、Q68，infra §6.1，F8*

---

### R19 界面与语言（M1 前）

**R19-1【补样稿】** 样稿里还没有的页面（登录、用邀请码加入、成员管理、改/删/移动任务、组长审核、连接仓库/Discord/Telegram、AI key 管理、贡献报告、iPhone「添加到主屏幕」教学、各种错误和空白状态），怎么确认？
- A. 按开发顺序分批做样稿，你确认后再写代码（每批 2–5 页） 【推荐】
- B. 一次全部做完，再一起确认

*来源：proto §9.3，memory 里的「UI 优先」规则*

**R19-2【电脑版】** 电脑浏览器上的版面怎么做？
- A. 和手机一样的版面，居中显示 【推荐】
- B. 另外设计一个宽屏版（要先做样稿）

*来源：Q80，矛盾 C21*

**R19-3【语言】** 语言怎么定？英文文案谁来写？
- A. 第一次打开时跟随手机语言；AI 生成的任务名和群消息用「项目语言」（默认是组长的语言）；推送用每个人自己的语言；英文文案我先写，你来确认 【推荐】
- B. 和 A 一样，但一律默认中文
- C. 英文文案你来写

*来源：Q72，proto §10 第 17 题*

**R19-4【二次确认】** 哪些操作要再确认一次？
- A. 结束项目、推翻 AI、重新分包、移除成员、退出登录、新建项目中途关闭（已经填了内容时） 【推荐】
- B. 只有结束项目和移除成员
- C. 都不要，和样稿一样

*来源：proto §2.9*

---

### R20 安卓发布（R20-1 在 M0 前；其他在 M12 或 M13 前）

**R20-1【安装包】** 安装包要支持哪些手机？
- A. 一个安装包同时支持新手机和旧手机（64 位 + 32 位，大约多 15MB） 【推荐】
- B. 只支持 64 位手机（安装包更小，少数旧手机装不了）

*来源：lessons c.4（旧版只做了 64 位，43.6MB）*

**R20-2【更新】** 有新版本时怎么让用户知道？
- A. App 打开时检查 GitHub 上有没有新版本，有就提示下载 【推荐】
- B. 在 A 的基础上，再加「不用重新安装的小更新」（需要一个免费的 Expo 帐号）
- C. 不提示

*来源：Q78，infra §5.3，F18*

**R20-3【iPhone 测试】** 你或组员有没有 iPhone（iOS 16.4 或更新）可以测试网页版？
- A. 有，可以拿来测试 【推荐】
- B. 没有，iPhone 部分只能在电脑上模拟（风险比较高）

*来源：新问题*

**R20-4【安装教学】** GitHub 下载页要不要附上安装教学（例如怎么「允许安装未知来源的 App」、看到安全警告怎么办）？
- A. 要，做一个简单的中英文教学页 【推荐】
- B. 不要

*来源：新问题，F17*

---

### R21 小设置与范围（M1 前）

**R21-1【深色模式】** 外观设置（浅色、深色、跟随系统）存在哪里？
- A. 每台设备各自记住 【推荐】
- B. 跟着帐号走，所有设备一样

*来源：proto §2.11*

**R21-2【通知开关】** 通知设置只要样稿里「推送」和「每周小结」两个开关，够吗？
- A. 够了 【推荐】
- B. 还要能按项目静音，或按通知类型开关

*来源：Q58*

**R21-3【字体】** 中文字体怎么处理？
- A. 安卓上中文用手机自带的字体（样子几乎一样，App 更小）；网页版用 Google 字体 【推荐】
- B. 把中文字体打包进 App（App 会大几十 MB）

*来源：proto §1.7，infra §5.2*

**R21-4【这一版不做】** 下面这些，这一版都不做，可以吗？任务评论和聊天、App 内预览文件、邮件、日历导出、老师查看、项目模板、离线使用、iPhone 原生 App、上架应用商店、管理后台、示例项目，以及「每个组员各选不同题目」这种作业。
- A. 同意，这一版都不做 【推荐】
- B. 我要加其中几项（请告诉我是哪几项）

*来源：questions §10*

---

### R22 技术选择（一）：我按推荐做，除非你反对

**R22-1【登录方式】** 登录功能怎么做？
- A. 我们自己写 GitHub 和 Google 登录（沿用旧版验证过的设计，改成更安全的「一次性码」） 【推荐】
- B. 用 Supabase 自带的登录功能

*来源：infra §2.6，lessons e*

**R22-2【测试登录】** 测试版放到网上以后，还要保留「一键登录」方便测试吗？
- A. 只在测试服务器上开，而且要输入一个口令；正式服务器永远关闭 【推荐】
- B. 放到网上后就只能用真的 GitHub/Google 登录

*来源：lessons e.4*

**R22-3【推送帐号】** 安卓推送要不要多注册一个帐号？
- A. 直接用 Firebase，不用再注册 Expo 帐号 【推荐】
- B. 用 Expo 的推送服务（要多一个免费的 Expo 帐号）

*来源：Q56，infra §4.1，E3*

**R22-4【崩溃报告】** 要不要收集 App 崩溃的报告？
- A. 要，加免费的 Firebase 崩溃报告（和推送用同一个 Firebase 项目），隐私政策里写明 【推荐】
- B. 不加，出问题靠用户截图反馈

*来源：新问题（Vercel 日志只保留 1 小时）*

---

### R23 技术选择（二）：我按推荐做，除非你反对

**R23-1【版本】** 用哪个版本开始写？
- A. 用 Expo SDK 57 开始写，58 稳定以后再升级；数据库工具固定用 Prisma 7 【推荐】
- B. 等 Expo SDK 58 稳定了再开始（大约再等 3–4 周）

*来源：infra §5.1，lessons a.2*

**R23-2【代码结构】** 代码怎么放？
- A. 后端和 App 放在两个独立的文件夹（`server/`、`app/`），共用的类型放在 `shared/`；网页版放在第二个免费的 Vercel 项目 【推荐】
- B. 全部放在同一个项目里

*来源：lessons b.6，infra §11.6*

**R23-3【仓库公开】** GitHub 仓库保持公开吗？
- A. 保持公开（定时任务不限分钟数）；所有密码、密钥和签名文件永远不放进仓库 【推荐】
- B. 改成私有（定时任务每月只有 2000 分钟）

*来源：infra §1.5、§11.4，F16*

**R23-4【Android 工具】** 打包安卓 App 用什么工具？
- A. 用 Android Studio 自带的 Java 21（旧版已经用它成功打包过） 【推荐】
- B. 另外安装 JDK 17

*来源：纠正 infra 的第 13 题（E1）；这一题其实只是告诉你，不需要你决定*

---

### R24 帐号与网址（M7、M8 或 M13 前）

**R24-1【GitHub 帐号】** MeritAI 的 GitHub App 和代码仓库放在哪个 GitHub 帐号下？现在仓库在 JTing904，本机的 git 用户名是 EdwardJT。
- A. 都放在 JTing904 下 【推荐】
- B. 放在 EdwardJT 下
- C. 其他帐号（请告诉我）

*来源：新问题*

**R24-2【网址】** 网站用什么网址？
- A. 用免费的 xxx.vercel.app 网址 【推荐】
- B. 买自己的域名（要花钱，不符合「不花钱」的规定）

*来源：Q77，F12*

**R24-3【Google 发布】** 为了让所有人都能用 Google 登录和选文档，要把 Google 应用「正式发布」，这需要网站上有隐私政策和使用条款页面。怎么做？
- A. 我来写草稿，你确认后放在网站上，正式上线前发布 【推荐】
- B. 先不发布，只让测试名单上的人用（最多 100 人，而且每 7 天要重新授权一次）

*来源：Q76，F11*

---

## 5. Accounts and credentials the user must create, and when

Rule: **the user owns every account.** The developer only generates local keys, and none of those ever go into the public repo.

| # | Account or credential | Purpose | Who | When (milestone) | Notes (all free) |
|---|---|---|---|---|---|
| 0 | **A working email + Google account** (R7-3) | Owner of Google Cloud, Firebase, Gemini; consent-screen support email | User | **Now** (answer R7-3); needed first at M6 | Do not use it for SMTP (that got the old Gmail banned). |
| 1 | GitHub account (exists: repo `JTing904/MeritAI`, local git user `EdwardJT`) | Repo, GitHub App, Actions, Releases | User | Now (confirm R24-1) | The repo is public (infra §1.5). |
| 2 | Local toolchain (not an account) | Android builds, local database | Developer on the user's PC | **M0** | JBR 21 at `C:\Program Files\Android\Android Studio\jbr` (proven). Set `ANDROID_HOME` permanently. Put `-Djava.net.preferIPv4Stack=true` in user-level `%USERPROFILE%\.gradle\gradle.properties` plus `JAVA_TOOL_OPTIONS`. Local PostgreSQL 17 service exists. adb is at `%LOCALAPPDATA%\Android\Sdk\platform-tools`. |
| 3 | **Android release keystore** | Signs every APK; a lost key forces users to reinstall | Developer generates; **user keeps 2 offline backups plus the password** | **M0** (sign even test builds with it, so the tablet never has to reinstall) | Never in git. Configure via user-level gradle.properties or a config plugin, because prebuild wipes `android/`. |
| 4 | Gemini API key (AI Studio, 18+) | Real AI tests | User | **M6** | Screenshot the real rate limits shown in AI Studio (the RPD numbers are unverified). |
| 5 | Supabase account + **staging** project (Singapore) | Database, Storage, pg_cron | User | **M7** | Free plan allows 2 projects: staging now, production at M13. Enable `pg_cron`, `pg_net`, Vault secrets; create a private bucket; use pooler URLs (IPv4). |
| 6 | Vercel account (Hobby, sign in with GitHub) | API hosting (and web later) | User | **M7** (API), **M12** (second project for web) | Region `sin1`. Environment variables are listed in infra §13 B.7. |
| 7 | Scheduler and backup | Tick every N minutes, keep-alive, weekly backup | User adds GitHub Actions secrets; optional cron-job.org account (needs email) | **M7** | Per R8-1/R8-3. Backup target is a private repo or the user's PC; **encrypt the dump** because artifacts in a public repo are public. |
| 8 | GitHub App (staging) | Repo webhooks; maybe login too | User creates, under the R24-1 account | **M8** | Read-only Contents/Metadata/Pull requests; Push and Pull request events; `.pem` private key; webhook secret. Use smee.io (no account) for local webhook testing. |
| 9 | A test GitHub repo | Commit-mapping tests | User | **M8** | |
| 10 | Firebase project (Spark, no card) | Android push (+ Crashlytics if R22-4 = A) | User | **M9** | Register the Android app with the **final package name (R7-2)**. `google-services.json` goes into the APK (not committed). The service-account JSON goes into Vercel env. |
| 11 | Expo account | Only if R22-3 = B or R20-2 = B | User | M9 / M13 | Not needed with the recommended options. |
| 12 | Telegram account (phone number) + bot via @BotFather | Telegram group messages | User (picks the bot's @name) | **M9** | Token goes into Vercel env. |
| 13 | Discord account + a test server | Test Discord webhooks | User | **M9** | No developer app needed (webhooks). |
| 14 | Google Cloud project (**no billing account**) | OAuth consent (External), Web OAuth client, Drive API, Picker API, API key, project number (Picker App ID) | User | **M10** | Start in "Testing" with the user as a test user (7-day token expiry). An Android OAuth client with SHA-1 is **only** needed if the native-picker fallback is used (E2). |
| 15 | VAPID key pair | Web / PWA push | Developer generates (`web-push`) | **M12** | Private key in Vercel env. |
| 16 | Privacy policy and terms pages + support email | Google OAuth production publishing | Developer drafts, user approves | **M13** | Hosted on the web app (R24-3). |
| 17 | Supabase **production** project + production Vercel env | Real users | User | **M13** | |
| 18 | Android Developer Console (limited distribution, free) | Only if R9-1 = B, or before the 2027 global rollout | User (identity may be required) | **M13 or later** | Registers the package name and signing key. |
| 19 | Claude / OpenAI keys | Not required (R9-4) | Leaders, not the user | never | |

---

## 6. From-scratch build order: backend + Android first, dev one-tap login, free rule parser

### 6.1 How every milestone is tested

- **Device:** Samsung Galaxy Tab A8 (SM-X205, arm64) over USB.
- **Daily loop:** a development build (`expo-dev-client`) with `adb reverse tcp:8081 tcp:8081` (Metro) and `adb reverse tcp:3000 tcp:3000` (local API), so the tablet's `localhost` reaches the PC.
- **End of milestone:** a signed **release APK** is installed with `adb install -r`, and the user runs the acceptance script on the tablet.
- **Several users on one tablet:** the dev one-tap login switches between 6 seeded personas matching the prototype: 思远, 晓雯, 子杰, 博文, 嘉欣, Ahmad.
- **Time-based features:** tested with a **dev "time machine"** (`/api/dev/clock` offset plus a "run tick now" button). It is available only when dev login is allowed, never in production.
- **Before every milestone:**
  1. Ask the listed question rounds.
  2. Show the listed mockups (UI-first rule).
  3. Only then write code.
- **After every milestone:** vitest green, plus a short tablet checklist.

### 6.2 Milestones

**M0 清场与骨架**

- **Needs first:**
  - Answers: R7, R20-1, R21-3, R23.
  - Accounts: #2, #3.
- **Build:**
  - Old code handled per R7-1.
  - `server/`: Next.js 16 **route handlers only**. Read `node_modules/next/dist/docs/` first, per AGENTS.md: `proxy.ts` replaces middleware, params are Promises.
  - Prisma **7.10 pinned**, `prisma-client` generator, `@prisma/adapter-pg`. Local database `meritai` recreated.
  - The `{success,data,error}` envelope with an error wrapper that never leaks internals.
  - `GET /api/health`.
  - vitest with `AI_PROVIDER=none`.
  - `app/`: Expo SDK 57 + expo-router, a `Stack.Protected` skeleton, and design tokens from proto §1 (precomputed OKLab mixes).
  - Shared components: 4-tab shell, toast, sheet, button with 3D lip, highlighter.
  - Typed zh/en `Messages` (a missing Chinese string is a type error).
  - `shared/` types.
  - Durable Android config: `expo-build-properties` for ABIs; user-level gradle.properties with the IPv4 flag; `ANDROID_HOME`; release signing via config plugin; cleartext allowed in dev builds only.
- **Tablet test:** install the APK; the 4 tabs look like the prototype; the light/dark/system switch works; 我 shows 「服务器：正常」.
- **Done when:** `expo prebuild --clean` followed by the Gradle release build succeeds with **no manual edits**.

**M1 开发者一键登录 + 帐户外壳**

- **Needs first:** R19, R21-1, R21-2.
- **UI gate:** none (the dev login screen is a dev tool). Start drafting the real login mockup for M10.
- **Build:**
  - User, Session (token hash) and AuthAccount tables.
  - Seed the 6 personas.
  - `POST /api/dev/login`: refused when `NODE_ENV=production` or the flag is unset.
  - Bearer token in SecureStore.
  - `GET /api/me`.
  - 我 page: theme, language, and push/weekly toggles, persisted.
  - Sign-out with confirmation.
  - Global `UNAUTHENTICATED` handling.
  - The zh/en error dictionary.
- **Tablet test:**
  1. Tap 思远, then home appears.
  2. Switch to 晓雯; 我 shows 晓雯.
  3. Toggles survive an app restart.
  4. In airplane mode the app stays signed in and shows a network error.

**M2 建项目：手动 + 免费规则解析 + 用邀请码加入**

- **Needs first:**
  - Answers: **R1–R5** (schema), R12-1, R12-3, R14-1.
  - Optional: R6, so badge tables can be designed up front.
- **UI gate:**
  - The 用邀请码加入 screen.
  - Editable new5 rows (name, points, **kind**, **due date**, milestones).
  - A due-date column in manual mode.
  - Rule-parser error and empty states.
  - Split new1 fields per R1-4.
- **Build:**
  - Schema: Project (timezone, language, code/label fields), Member (role, colour, leftAt), Package, Task, Milestone, Draft.
  - Wizard new1–new6 with the three input modes.
  - **Free rule parser**, zh + en:
    - PDF via `unpdf`, DOCX via `mammoth`, TXT.
    - Understands `%`, 「分」 and `marks`.
    - With no percentages, uses equal weights.
    - Dates spread evenly up to the deadline.
    - Kind guessed from keywords.
    - Images return 「需要 AI key」.
  - Balancing algorithm ported with the 4 regression cases from lessons d.2–d.4, plus new ones.
  - Point rounding per R2-1.
  - Invite code, join-by-code, home project cards (in progress / picking).
  - Storage abstraction: local disk in dev; the API is already shaped as "sign, then upload direct" for Supabase later.
- **Tablet test:**
  1. As 思远, upload a Chinese rubric PDF from the tablet's Downloads (e.g. 「报告 40%、演示 30%、调研 30%」).
  2. See tasks, edit one due date, split into 5 packages, see the invite code.
  3. Switch to 晓雯, join by code, and see the project.
  4. Repeat with typed text and with manual mode.
- **Done when:** parser unit tests pass on at least 8 sample briefs (zh/en; `%` / 分 / marks / none).

**M3 选包与包管理**

- **Needs first:** R13, R14-3, R3 (already answered).
- **UI gate:**
  - Member management: list, leave, remove, transfer leader.
  - The swap requester's pending state and cancel.
  - Leader "move task".
  - A leader entry to settings from the project page (C23).
  - How unpicked packages look on the project page.
- **Build:**
  - Pick carousel with a race-safe claim.
  - Switch; swap lifecycle.
  - Resplit with preview.
  - Add task → lightest package + rescale.
  - Move task; leave, remove, transfer.
  - Per-project colours.
  - Project page: hero ring and 任务包 tab.
  - In-app notification list with read state.
  - Feed events for these actions.
- **Tablet test:**
  1. 3 personas pick packages.
  2. 晓雯 requests a swap and 子杰 accepts.
  3. The leader adds a task and sees the total stay 100.0, with the owner notified.
  4. The leader resplits after the preview.
  5. 博文 leaves; his done points remain and his open tasks become unowned.
- **Done when:** concurrency unit tests pass (two simultaneous pickers, stale swap).

**M4 任务与证据（不用 AI）**

- **Needs first:** R4 (answered), R5-1, **R8-2**, R11-1, R11-2, R18-1.
- **UI gate:**
  - The leader review queue (no-key projects).
  - Override with 4 grades, reason and undo.
  - Edit/delete task.
  - Empty and error states: file too big, wrong type, upload failed.
- **Build:**
  - Task detail in all states.
  - Self-mark for meetings.
  - File evidence: up to N items, caps per R8-2.
  - Leader grading when there is no key.
  - Override record; resubmission history.
  - Scoring (points × grade).
  - 我的任务 tab, home to-dos.
  - 排行 podium, 动态 feed.
  - Visibility per R11-2.
  - Settings screen: AI key shown as "not set".
- **Tablet test:**
  1. 晓雯 uploads a PDF from the tablet.
  2. 思远 (leader) grades it 拿一半.
  3. 晓雯 resubmits and it becomes 合格; the points behave per R4-4.
  4. The leaderboard updates.
  5. A meeting self-mark shows confetti.

**M5 提醒与项目生命周期（App 内 + 时光机）**

- **Needs first:** R15, R16-1, R17-1–R17-3, R5-4 (answered).
- **UI gate:**
  - Lifecycle cards for non-leaders (awaiting confirmation, auto-ended, grace countdown).
  - Notification read and unread states.
- **Build:**
  - Tick engine with `NotificationLog` unique keys (task + type + dueAt snapshot).
  - 24 h, overdue and weekly summary (project timezone) messages.
  - Quiet hours.
  - End-of-project reminders; auto-end at +7 days; grace period; deletion job (badge rows survive).
  - Time machine.
  - Prototype notification copy with the R15-3 templates.
- **Tablet test:**
  1. Create a task due tomorrow 09:30.
  2. Time machine to −23 h: exactly one 24 h notice.
  3. Past due: every persona sees the overdue card.
  4. Sunday 20:05: the weekly card appears.
  5. Deadline +7 days: auto-ended. +14 days: the project is gone.

**M6 AI（Gemini，用你自己的免费 key）+ 假 AI**

- **Needs first:**
  - Answers: R9-3, R9-4, R12-2, R12-4, R18-3, R18-4.
  - Accounts: #0, #4.
- **UI gate:**
  - AI key save / validate / remove, with errors (bad key, quota).
  - Paths for "no choice question" and "several choice questions".
  - AI failure states in new3 and on the task screen.
  - The member-facing AI notice (R9-3).
- **Build:**
  - Provider adapter: Gemini REST; Claude and OpenAI per R9-4.
  - A **mock provider** for tests and demos (never in production builds).
  - Key encryption (AES-GCM with its own server secret), masked display.
  - Brief analysis: pick-N choices, method choices with pros and cons, due suggestions, hours.
  - new3 shows real progress; new4.
  - File review: PDF and images native; DOCX/PPTX as text plus embedded images.
  - Job queue with dedupe, backoff and stale-job recovery (lessons f.2).
  - Quota limits.
- **Tablet test:**
  1. Brief with 「5 个案例任选 2 个」 → new4 → confirm → packages.
  2. Submit a DOCX → grade within about 30 s.
  3. Corrupt the key → the task shows 「排队中」 and the leader gets an alert.

**M7 上云（免费测试环境）**

- **Needs first:**
  - Answers: R8-1, R8-3, R8-4, R22-2, R23, R24-2.
  - Accounts: #5, #6, #7.
- **Build:**
  - Supabase staging and migrations over the pooler; check `pgbouncer` (E12).
  - Private bucket with signed direct uploads; TUS if needed.
  - Vercel `sin1` staging.
  - `pg_cron` + `pg_net` tick, plus an external trigger (E4).
  - Encrypted weekly backup.
  - Staging dev login behind a passcode.
  - A delivery and error log table (Vercel keeps logs 1 h).
  - An APK built against the https API, with cleartext disabled.
- **Tablet test:**
  1. Unplug USB; use Wi-Fi or 4G.
  2. Run the full M2–M6 flow.
  3. Upload a 9 MB PDF.
  4. Wait for a **real** scheduled 24 h reminder and record how late it is.
  5. Restore a backup into a scratch database.

**M8 GitHub 代码证据**

- **Needs first:**
  - Answers: R4-3, R10-4, R11-3, R11-4, R24-1.
  - Accounts: #8, #9.
- **UI gate:**
  - Connect-repo flow, including sending the install link to the repo owner.
  - "Connect GitHub" prompt for members.
  - 未识别提交 list and claim.
- **Build:**
  - GitHub App install and repo linking (several repos per project).
  - Webhook signature check on the raw body (lessons f.1).
  - Push and PR ingestion: dedupe by SHA, skip merge commits, handle squash merges.
  - Author matching: until M10, personas get a dev-set GitHub username.
  - Batched AI matching, or the `#编号` rule without a key.
  - Re-assign sheet.
  - 「我做完了」 re-fetches all commits from the API, then grades.
- **Tablet test:**
  1. From the PC, push 3 commits to the test repo as 子杰.
  2. They appear on 子杰's task within a minute.
  3. Re-assign one commit.
  4. 我做完了 → a grade.

**M9 推送与群通知**

- **Needs first:**
  - Answers: R15-1, R16-2–R16-4, R22-3, R22-4.
  - Accounts: #10, #12, #13 (#11 only if chosen).
- **UI gate:**
  - Notification-permission prompt (Android 13+).
  - Discord and Telegram connect flows.
- **Build:**
  - FCM token registration and sending (direct FCM by default).
  - Dead-token cleanup.
  - Discord webhook with a test message.
  - Telegram deep-link group linking.
  - Channels wired to the R15-1 matrix.
  - Crashlytics if R22-4 = A.
  - Note: `google-services.json` requires a **new APK**.
- **Tablet test:**
  1. With the app in the background, time-machine an overdue task: a push arrives on the tablet.
  2. The Discord channel and Telegram group receive the overdue message and the weekly summary.

**M10 真登录 + Google 文档**

- **Needs first:**
  - Answers: R10-1–R10-3, R14-2, R14-4, R22-1.
  - Accounts: #14 (plus the GitHub App or OAuth login callback).
- **UI gate:**
  - Real login screen.
  - Account merge and link messages.
  - Google Doc picking hand-off to the browser.
  - Invite-link landing (App Links per R14-2).
- **Build:**
  - GitHub and Google OAuth through the system browser with a **one-time code exchange** (no token in the URL; lessons e.6).
  - Merge on verified email; manual linking and unlinking.
  - **Spike first:** Drive picker via `trigger_onepick` vs a hosted picker page (E8).
  - `drive.file` consent.
  - Export Docs/Slides/Sheets text.
  - Revision list; snapshot at submission.
  - `assetlinks.json` if R14-2 = A.
  - Dev login remains local and staging only.
- **Tablet test:**
  1. On a fresh install, sign in with Google (as a test user).
  2. Link GitHub.
  3. Attach a Google Doc you edited → AI grade → the editors list shows.
  4. Tap an invite link and the app opens.

**M11 徽章 + 贡献报告**

- **Needs first:** R6, R17-4, R18-1.
- **UI gate:** report PDF layout and the in-app report page.
- **Build:**
  - Badge engine: event hooks plus weekly jobs; lifetime counters on User; snapshot rows that do not cascade from Project.
  - Badges page and inline badges.
  - Report PDF with `@react-pdf/renderer` and a **static** Noto Sans SC TTF (not the variable font): CJK hyphenation callback, lineHeight ≥ 1.4.
  - Generated once at the end, per language, and cached in Storage; download returns a signed URL.
  - Android save/share via `expo-file-system` + `expo-sharing`.
- **Tablet test:**
  1. Time-machine a project to its end.
  2. Download the PDF on the tablet; Chinese names render correctly.
  3. Badges appear.
  4. After +14 days the project is deleted but the badges remain.

**M12 网页版 + iPhone PWA**

- **Needs first:**
  - Answers: R16-4, R19-2, R20-3.
  - Accounts: #6 (second project), #15.
- **UI gate:**
  - Desktop layout, only if R19-2 = B.
  - 「添加到主屏幕」 guide.
- **Build:**
  - Expo web export (`single`) on a second Vercel project.
  - manifest + `sw.js` (push only, no offline cache).
  - Web Push with VAPID.
  - Web OAuth via full-page redirect and code exchange.
  - Web file upload and download.
  - CORS on the API.
  - README architecture update (C25).
- **Tablet test:**
  1. Chrome on the tablet → the web URL → install the PWA.
  2. Sign in; receive a web push.
  3. If R20-3 = A: repeat on an iPhone with iOS 16.4+.

**M13 上线准备（正式版）**

- **Needs first:**
  - Answers: R9-1, R9-2, R18-2, R20-2, R20-4, R24-3.
  - Accounts: #16, #17 (#18 if chosen).
- **UI gate:** privacy and terms pages, account deletion, update prompt, APK install guide page.
- **Build:**
  - English copy complete.
  - Account deletion.
  - Production Supabase and Vercel.
  - A test asserting dev login is **impossible** in production.
  - Release APK on GitHub Releases, plus the install guide.
  - In-app update check.
  - Publish the Google OAuth app to production.
  - Android verification per R9-1.
  - Usage monitoring: Vercel CPU, Supabase storage and egress, AI quota counters.
  - A security review pass.
- **Tablet test:**
  1. Uninstall.
  2. Download the APK from GitHub Releases on the tablet.
  3. Install as a brand-new user with real Google login.
  4. Run the whole flow on production.

### 6.3 Dependency view (what can run in parallel)

- **Question rounds:** R7 → M0 can start **today**. R1–R5 must be answered before M2 starts; they can be asked while M0 and M1 are built.
- **Mockups:** each milestone's mockup batch can be drafted while the previous milestone is being built.
- **External accounts:** none are needed until **M6** (Gemini key) and **M7** (Supabase and Vercel). M0–M5 run entirely on the PC and the tablet.

---

## 7. Sources checked today (new facts only; everything else is cited in infra.md)

- Supabase pricing (Free: no automatic backups, no point-in-time recovery; Pro: 7 days): https://supabase.com/pricing
- Android developer verification overview (Brazil/Indonesia/Singapore/Thailand from 2026-09-30, global 2027; limited distribution up to 20 devices with no ID and no fee): https://developer.android.com/developer-verification
- Android developers blog, "advanced flow" (one-time, developer mode, one-day wait): https://android-developers.googleblog.com/2026/03/android-developer-verification.html
- Secondary sources on the verification fee (reported US$25, **[verify]**): https://median.co/blog/android-developer-verification-2026 and https://support.google.com/android-developer-console/answer/16561738
- Secondary source confirming no backups on Supabase Free: https://backupdrill.com/guides/supabase-free-plan-backups
