# MeritAI: implementation spec from the approved UI prototype

Source: `C:/Users/user/MeritAI/MeritAI/docs/prototype/index.html` (1,677 lines, read in full). I also checked it against `REQUIREMENTS.md` (v2) and the screenshots in `docs/screenshots/` (01-home, 03-task-review, 04-leaderboard, 07-home-dark). The screenshots match the current prototype code.

Conventions in this document:
- Chinese UI copy is quoted **verbatim** inside `code` spans. `{x}` is an interpolated value.
- **[Q]** marks something uncertain that must be asked, not guessed (the user's standing rule).
- **[DEMO]** marks something that must not ship.
- **[BUG]** marks a hard-coded value or inconsistency inside the prototype that the real app must compute or fix.

---

## 0. Key findings

1. The prototype covers 15 routes: `home, tasks, notifs, me, project, settings, pick, task, badges, new1..new6`. It also has 4 bottom sheets (`fab, commit, addtask, resplit`), a toast, confetti, and a demo-only "map" sidebar. There is no login screen, no join-by-code screen, no member management, no report-PDF view, no English copy, and no loading, error, or offline states. See §9.3.
2. The design system is small and consistent: 13 base tokens plus 6 highlighter colours plus 3 semantic pairs, all redefined for dark mode. It relies heavily on CSS `color-mix(in oklab…)`, which React Native does not support. §1.2 gives precomputed hex values for every mix, in both themes.
3. The grade and status vocabulary is fixed. Grades: `优秀 / 合格 / 拿一半 / 不通过`. Completion methods: `自己标记` (shown as `完成`) and `组长判定通过` (shown as `通过`). Statuses: `待开始 / 进行中 / 已过期 / 拿一半 / 不通过` plus done. Status icons: ✅🔨⭕🐢❌🌓.
4. The 12 badges and their unlock rules, the leaderboard/podium, the activity feed, the per-package hour estimates, the team-size range 2–8, and the rule "packages ≥ members" appear **only in the prototype**. They are not in REQUIREMENTS.md and need confirmation (§9.2).
5. Two big behavioural gaps: (a) when no AI key is set, doc/design/research tasks cannot be reviewed, and the prototype never shows how such a task gets completed; (b) the prototype never defines what makes a task or package "started" (`todo`→`doing`), yet swap and re-split rules depend on it.

---

## 1. Design tokens

### 1.1 Base colour tokens (light / dark)

The light values sit on `:root`. The dark values apply under `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` and under `:root[data-theme="dark"]` (the two blocks are identical).

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--paper` | `#F5F4FA` | `#15131E` | App background (the screen), sheet-free surfaces, highlighter mix base |
| `--card` | `#FFFFFF` | `#1F1C2B` | Cards, lists, tab bar, sheet, inputs, avatar ring border |
| `--card-2` | `#EFEDF7` | `#2A2639` | Secondary surface: chips, seg track, soft buttons, bar track, file chip, formula box, mini-task, sheet options, code box |
| `--ink` | `#1E1B2E` | `#F3F1FA` | Primary text; **also** background of the toast, the weekly-summary card and the milestone tag (these invert in dark mode) |
| `--ink-2` | `#4A4660` | `#CFCAE3` | Secondary text (descriptions, chip text, field labels) |
| `--muted` | `#625D76` | `#A7A2BE` | Tertiary text, hints, meta, inactive tabs |
| `--line` | `#E1DEEC` | `#332F46` | Dividers, input borders, dashed borders, off toggle, sheet grab handle, soft-button lip |
| `--grape` | `#6246EA` | `#6A52F0` | Primary brand/action (buttons, FAB, focus ring, checked boxes, unread dot, progress steps) |
| `--grape-press` | `#4429C4` | `#4A33C8` | Primary-button 3D lip |
| `--grape-soft` | `#ECE8FF` | `#2D2652` | Active tab pill, `chip.grape` bg |
| `--grape-text` | `#4E33D2` | `#BCAFFF` | Grape-coloured text (links, active tab label, commit SHA, "全部" link) |
| `--on-grape` | `#FFFFFF` | `#FFFFFF` | Text/icon on grape |
| `--on-hl` | `#1E1B2E` | `#1E1B2E` (not redefined) | Text on highlighter colours (avatars, package number, pcard band, logo) |
| `--good` | `#0B7A4C` | `#52D69B` | Pass/done text, toggle-on bg |
| `--good-soft` | `#DDF6EA` | `#173A2C` | Good chip / result bg / done panel bg |
| `--warn` | `#8F5100` | `#F4B35A` | Warn text |
| `--warn-soft` | `#FFEFD2` | `#3A2C14` | Warn chip / result bg / warn-box |
| `--bad` | `#B8223C` | `#FF7A8F` | Fail/overdue/urgent text, tab badge bg |
| `--bad-soft` | `#FFE4E9` | `#401B24` | Bad chip / result bg / danger button bg |
| `--on-bad` | `#FFFFFF` | `#1E1B2E` | Text on `--bad` (tab badge number) |
| `--on-ink-good` | `#3FD89B` | `#0B7A4C` | Green number on the inverted weekly card |
| `--hl-strength` | `100%` | `48%` | How strongly highlighter colours mix into the paper (dark mode mutes them) |
| `--backdrop` | `#E7E5F1` | `#0D0B14` | **[DEMO]** page behind the phone mock |
| `--bezel` | `#1E1B2E` | `#2A2638` | **[DEMO]** phone bezel |

Fixed colours that are not tokens:
- Sheet scrim `rgba(20, 16, 36, 0.45)` (both themes).
- Toggle knob `#fff`.
- Seg-selected shadow `0 1px 4px rgba(0,0,0,0.08)`.
- The Google logo's four brand colours `#4285F4 #34A853 #FBBC05 #EA4335`.

### 1.2 Highlighter palette ("荧光笔") and precomputed mixes

The six member/package/project colours:

| Name | Light | Dark |
|---|---|---|
| `lemon` | `#FFD84A` | `#F2C94C` |
| `gum` | `#FF86BA` | `#F07AAE` |
| `mint` | `#3FD89B` | `#36C98E` |
| `sky` | `#5AAEFF` | `#4F9EF0` |
| `tang` | `#FF9E47` | `#F0913E` |
| `lilac` | `#B794FF` | `#A987F5` |

React Native has no `color-mix`. The table below precomputes every opaque mix the prototype uses, calculated in OKLab by my script (`scratchpad/gap/mix.js`). Values are approximate to about ±1 per channel.

**Light**

| colour | hl band (c @100% into paper) | doc-scan mark (into card-2) | kind tile 30% into card | `chip.c` / podium block 34% | notif emoji tile 32% | badge coin 40% | `.btn.hlb` lip (62% c + #000) |
|---|---|---|---|---|---|---|---|
| lemon | `#FFD84A` | `#FFD84A` | `#FFF4D1` | `#FFF3CA` | `#FFF4CE` | `#FFF1C1` | `#867122` |
| gum | `#FF86BA` | `#FF86BA` | `#FFDCEA` | `#FFD7E7` | `#FFD9E9` | `#FFD0E3` | `#864360` |
| mint | `#3FD89B` | `#3FD89B` | `#D0F4E1` | `#C9F3DD` | `#CCF4DF` | `#BFF1D7` | `#1C714F` |
| sky | `#5AAEFF` | `#5AAEFF` | `#D0E8FF` | `#C9E4FF` | `#CCE6FF` | `#C0E0FF` | `#2B5986` |
| tang | `#FF9E47` | `#FF9E47` | `#FFE3CC` | `#FFDFC5` | `#FFE1C8` | `#FFDABB` | `#865121` |
| lilac | `#B794FF` | `#B794FF` | `#E8DFFF` | `#E5DBFF` | `#E7DDFF` | `#E1D5FF` | `#5E4B86` |

**Dark**

| colour | hl band (c @48% into paper) | doc-scan mark (c @48% into card-2) | kind tile 30% | `chip.c` / podium 34% | notif emoji tile 32% | badge coin 40% | `.btn.hlb` lip |
|---|---|---|---|---|---|---|---|
| lemon | `#75643D` | `#82704E` | `#564B3D` | `#5E523F` | `#5A4F3E` | `#6B5C42` | `#7F6824` |
| gum | `#76425E` | `#844E6F` | `#58374F` | `#603B54` | `#5C3952` | `#6C405C` | `#7E3D59` |
| mint | `#2E6352` | `#3C7062` | `#2F4B48` | `#30524C` | `#2F4E4A` | `#325C52` | `#176848` |
| sky | `#33517A` | `#405D8B` | `#304060` | `#324568` | `#314264` | `#354C73` | `#25517E` |
| tang | `#754C35` | `#835846` | `#573D38` | `#5F423A` | `#5B4039` | `#6B493B` | `#7E491C` |
| lilac | `#56477D` | `#63528E` | `#443A61` | `#4A3E69` | `#473C65` | `#524475` | `#574480` |

Other opaque mixes:

| Use | Light | Dark |
|---|---|---|
| Invite card bg (lilac 22% into card) | `#EEE8FF` | `#3A3152` |
| `.choice` selected bg (grape-soft 60% into card) | `#F4F1FF` | `#272242` |
| `.btn.danger` lip (bad 30% into card) | `#F1C1C1` | `#5C3848` |

Mixes with `transparent` are just the colour at that alpha:

| Use | Value |
|---|---|
| Appbar bg | paper @ 0.88, with `backdrop-filter: blur(10px)` |
| Row/commit hover | card-2 @ 0.60 |
| `.override` border | grape @ 0.40 |
| Weekly `.wk` tile | paper @ 0.10 over the ink card |
| AI-scan sweeper gradient | `transparent → lemon@0.55 → transparent` |
| **[DEMO]** `.proto` dashed border | grape @ 0.55 |

In dark mode, surfaces that sit on a highlighter colour at full strength keep the undimmed colour. These are: avatars, `pkg-num`, pcard band, `proj .code`, `.logo`, `.btn.hlb`, `.bar > i` fills, the split bar, `.pdot`, the badge-coin border, and the ring stroke. Only the `.hl` marker and the doc-scan marks use `--hl-strength`. Screenshot 07 confirms this: the avatar stays bright yellow in dark mode.

**Colour roles.** The same six colours play four different roles:
- **Member colour.** `P[k].c` is one colour per person, and it is the same across projects. Avatars, a picked package, podium blocks, rank bars and the ring all use it.
- **Project colour.** `PROJ.c` is CS302 = lemon, MKT201 = gum, ENG101 = lilac, club = mint. It is used for the project code tag, the home progress bar, the `kind` tile tint and `pdot` in task rows, the task-detail kind chip, and the project ring.
- **Waiting colour of an unpicked package.** MKT201 uses `['gum','sky','lilac','mint','tang']` per package index. new6's split bar uses `['gum','sky','lilac','mint','tang','lemon','gum','sky']`.
- **Page-title marker colour.** Each screen picks one: new1 mint, new2 sky, new3 lemon, new4 gum, new5 lilac, new6 mint, pick gum (the project colour), home greeting lemon (default).

Open questions on colour:
- **[Q]** Is a member's colour global per user or assigned per project? The palette has only 6 colours but a team can have up to 8 people (§9.2), so collisions will happen.
- **[Q]** Is "待选色" one neutral colour or a different colour per package, as in the prototype? With per-package colours, an unpicked package can look like it belongs to the member who has that colour.
- **[Q]** How is the project colour assigned?
- **[Q]** Should the home greeting marker use the user's own colour? The code uses the default lemon, which only happens to be 思远's colour.

### 1.3 Radii

| Element | Radius |
|---|---|
| Card, list, `.proj` | 20 |
| Sheet (top corners), pcard | 26 |
| Result panel, done panel, doc-scan, weekly card | 22 |
| ev-opt, override, badge tile, choice, code-box | 18 |
| file-chip, toast, sheet-opt, podium block | 16 (podium block is `16 16 6 6`) |
| Button | 15 |
| seg track, input, stepper, formula box, warn-box, `pkg-num`, weekly `.wk` | 14 |
| `kind` tile, notif emoji tile | 13 |
| `.btn.sm`, icon-btn, mini-task | 12 |
| file-chip `.ico` | 11 |
| seg button, `proj .code` | 10 |
| `.logo`, `.del` | 9 |
| choice checkbox, `ms .tag`, `pl-task .dt` | 8 |
| `.check .box`, `ptask .tg` | 7 |
| doc-scan line | 6 |
| scan line | 5 |
| step bar, grab handle | 3 |
| chip, tab icon pill, bar, toggle | 999 (pill) |
| Avatar, radio box, unread dot | 50% |
| Carousel dots | 50%; active dot is 20×7 with radius 4 |
| Focus ring | 8 |
| **[DEMO]** phone | 52 |

### 1.4 Shadows and elevation

| Name | Light | Dark |
|---|---|---|
| `--shadow` (cards, lists, badges, pcard, toast) | `0 1px 0 rgba(30,27,46,.04), 0 10px 28px -16px rgba(30,27,46,.28)` | `0 1px 0 rgba(0,0,0,.2), 0 12px 28px -16px rgba(0,0,0,.7)` |
| Seg selected | `0 1px 4px rgba(0,0,0,.08)` | same |
| **3D button lip** (signature) | `.btn`: `0 4px 0 var(--grape-press)`; pressed → `translateY(3px)` and `0 1px 0`, transition .08s | same |
| `.btn.sm` | `0 3px 0 grape-press` | |
| `.btn.soft` | `0 3px 0 var(--line)`; pressed `0 1px 0` | |
| `.btn.hlb` | `0 4px 0 mix(c 62%, #000)` | |
| `.btn.danger` | `0 3px 0 mix(bad 30%, card)` | |
| `.logo` | `3px 3px 0 var(--gum)` (hard offset), rotated −6° | |
| Disabled button | opacity .45, no transform | |

RN note: React Native 0.76+ with the New Architecture supports the CSS-like `boxShadow` style, including negative spread. **[Q/verify]** Check this against the Expo SDK version actually installed. The fallback is to draw the 3D lip as an extra View offset under the button.

### 1.5 Borders

| Element | Border |
|---|---|
| List row dividers | 1px `--line` (`.list > * + *`) |
| Tab bar top | 1px line |
| Input and stepper | 2px line; focused input gets a 2px grape border |
| `ev-opt`, `.drop` | 2px **dashed** line; ev-opt hover → grape |
| `.choice` | 2px line; selected → grape |
| `.check .box`, `.choice .box` | 2px line; checked → grape fill |
| Avatar | 2px card-coloured ring (3px on `lg`), so stacked avatars read as separate |
| Badge coin | 3px solid `c`; locked → dashed, plus grayscale and opacity .4 |
| Override box | 2px grape@40% |
| `pl-task + pl-task` | 1px dashed line |

### 1.6 Spacing

The prototype has no formal scale. These are the values it uses:
- **Screen:** padding `4px 18px 28px` (so the side gutter is 18), vertical gap between blocks **18**.
- **Card:** padding 16. **List row:** 13×14. `stack-v` gap 10.
- **Sheet:** padding `10 18 (28+safe-bottom)`, gap 10.
- **Chip:** `2px 9px`, gap 4. **Button:** `13×18` (sm `8×13`). **Seg:** 4 padding, 4 gap, button `8×6`.
- **Tab bar:** padding `6 8 (18+safe-bottom)`.
- **Appbar:** `8×12` with a `-4 -18 0` negative margin so it runs edge to edge.
- **Section header:** `margin: 2px 2px -6px` (it hugs the list below it).
- Numbers that recur: 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 28.

Proposed tokens: `xxs 2, xs 4, s 6, sm 8, m 10, 12, 14, l 16, gutter 18, xl 20, 22, xxl 28`.

### 1.7 Fonts and weights

Loaded from Google Fonts:
- `Bricolage Grotesque`, opsz 12..96, weights **500 / 700 / 800**.
- `DM Mono`, weights **400 / 500**.
- `Noto Sans SC`, weights **400 / 500 / 700 / 900**.

Font stacks:
- `--font-display`: `"Bricolage Grotesque", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`. Bricolage renders Latin and digits; CJK glyphs fall back to Noto Sans SC.
- `--font-body`: `"Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`.
- `--font-mono`: `"DM Mono", ui-monospace, "SFMono-Regular", Menlo, monospace`.
- Base text: `15px/1.55` body font, antialiased. Numbers often use `font-variant-numeric: tabular-nums` (RN: `fontVariant: ['tabular-nums']`).

Weights actually used:
- Bricolage: 700 and 800. Weight **900** is requested (h1, project name, me name, grade), but Bricolage tops out at 800. Latin in those places renders at 800; CJK renders at Noto 900. Bricolage 500 is loaded but never used.
- DM Mono: only 500 is used. 400 is loaded but unused.
- Noto Sans SC: 400, 500, 700, 900. **600** is requested in many places (chip, tab label, toast, ring label, podium label, mini-task/pl-task points, badge source) but is not loaded, so browsers render it at **700**. **[Q]** Map 600 → 700 or load 600?

Implementation risks, all **[Q]** to decide:
- React Native does not fall back glyph by glyph between custom fonts. A Bricolage heading containing CJK will use the system CJK font on native. On Android that is Noto Sans CJK, visually the same family, but weight 900 may not be honoured.
- Bundling Noto Sans SC in the APK costs several MB per weight. Options: rely on Android's system Noto CJK plus Google Fonts on web/PWA (free, sliced), or bundle a subset.
- Is Bricolage available as an `@expo-google-fonts/*` package? Verify. It is OFL/free either way.

### 1.8 Type scale

Values are size / line-height / weight / family. "Display" means Bricolage with Noto fallback.

| Role | Spec |
|---|---|
| Page title `h1.title` | 27 / 1.25 / 900 display, letter-spacing −0.01em, balanced wrap. Pick screen overrides to **23**, task detail to **24** |
| Project hero name `.p-hero .name` | 21 / 1.25 / 900 display |
| Me name `.me-head b` | 20 / 900 display |
| Brand wordmark | 18 / 800 display, −0.02em; logo glyph "M" 17/800 |
| Grade word `.result .grade` | 34 / 1 / 900 display, +0.02em |
| pcard points `.big` | 44 / 0.95 / 800 display, −0.03em; unit `small` 17 |
| Ring number | 22/1/800 display; label 10.5/600 body |
| Podium number | 22/1/800 display; unit 11/600 |
| Weekly title | 17/800 display; weekly number 22/800 display |
| Rank earned | 18/800 display; "包内共…" 11/500 |
| Package number tile | 19/800 display |
| Stepper value | 19/800 display |
| Appbar title | 16/700; sub 11.5/500 muted |
| Project card name | 16.5/1.3/900; meta 12.5 muted |
| Sheet title h4 | 16; sheet option title 15; sub 12.5 muted; sheet p 13.5 ink-2 |
| Body / input / button | 15 (button 700) ; `btn.sm` 13 |
| Section header h3 | 15/700; its action link 13/700 grape-text |
| Workstream header | 14.5/900; points 15/800 display grape-text |
| Row title `.row .t` | 14.5/1.35/700; row meta 12.5 muted |
| Choice name | 15/900; reason 12.5 ink-2 |
| Toast | 14/600 |
| Notification text | 14/1.5; time 11.5 muted |
| Task description | 14 ink-2 |
| Set-row | 14; sub 12 muted |
| Feed item | 13.5; time 11.5 |
| Seg button | 13.5/700 |
| Mini-task / ptask / pl-task / ms row / check | 13.5 |
| Field label | 13/700 ink-2; its `small` 500 muted |
| Hint / warn-box / formula | 12.5 (formula line-height 1.6) |
| Due column | 12/700 muted (urgent → bad), tabular |
| Chip | 12/600 |
| Step label | 12/700 muted |
| Mono: commit SHA | 12/500 grape-text; line counts 11.5/500 |
| Mono: milestone date, plan date | 12 and 11.5/500 |
| Mono: invite code | 22/500, letter-spacing 0.12em |
| Badge tile | name 12.5/1.3; condition 10.5/1.35 muted; source 10/600 grape-text |
| Tab label | 11/600; badge counter 10/17px 700 display |
| Avatar glyph | 14/900 (sm 11.5, lg 26) |
| Emoji sizes | kind tile 19, notif tile 20, sheet option 22–24, invite 30, badge coin 26, done panel 42, medal 22 |

### 1.9 Motion (all disabled under `prefers-reduced-motion`)

- `sweep`: the highlighter grows from 0% to 100% width. 0.7s with a 0.15s delay, `cubic-bezier(.2,.7,.3,1)`. Only on the home greeting (`.hl.sweep`).
- `rise`: the sheet enters from translateY 40 and opacity 0, over 0.22s ease-out.
- Toast: fade plus translateY(−8→0), 0.2s. Visible for **2.8s**.
- `scan`: the AI-review sweeper moves left→right, 1.1s linear infinite.
- `mark`: each doc-scan line is highlighted with scaleX 0→1, 0.6s, staggered 0.25s.
- `spin`: 16px ring spinner, 0.8s linear infinite (grape top border).
- Chevron rotates 90° on expand (0.2s). Tab pill bg 0.2s. Carousel dots: width/colour 0.2s. Toggle knob 0.15s.
- Button press: 0.08s (see §1.4).
- Confetti: see §2.8.
- With reduced motion, the new3 analysis auto-advances after 800ms instead of 3,600ms, the fake review takes 300ms instead of 1,800ms, and confetti is skipped.

### 1.10 Icons (inline SVG, 24 viewBox, `fill:none; stroke:currentColor; round caps/joins`, stroke 2 unless noted)

| Name | Paths (verbatim) | Sizes used |
|---|---|---|
| home | `M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z` | 22 (tab) |
| tasks | `rect 3,3 18×18 rx5` + `m8 12 3 3 5-6` | 22 |
| bell | `M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9` + `M10.3 21a1.94 1.94 0 0 0 3.4 0` | 22 |
| user | `circle 12,8 r4` + `M4 21a8 8 0 0 1 16 0` | 22 |
| plus (stroke 2.6) | `M12 5v14M5 12h14` | 26 FAB, 16 |
| back (2.4) | `m15 18-6-6 6-6` | 22 |
| close (2.4) | `M18 6 6 18M6 6l12 12` | 22/18/16/14 |
| gear (a sliders glyph) | `M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1` + circles (15,6)(9,12)(17,18) r2 | 20 |
| upload | `M12 15V4M7 9l5-5 5 5` + `M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4` | 22/18 |
| file | `M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z` + `M14 3v5h5` | 20 |
| copy | `rect 8,8 12×12 rx2` + `M4 16V5a1 1 0 0 1 1-1h11` | 16 |
| chevron | `m9 18 6-6-6-6` | 18 |
| sparkle | `M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z` | 18 |
| shuffle | `M16 3h5v5`, `M4 20 21 3`, `M21 16v5h-5`, `m15 15 6 6`, `M4 4l5 5` | 16 |
| check (3) | `m5 12 5 5L20 7` | 18/16/14 |
| github | filled brand mark (lines 597–598) | 20/18/13 |
| google | 4-colour brand mark (lines 599–600) | 22/20/18 |

Emoji are used as icons throughout. Kinds: `💻 代码`, `📄 文档`, `🔎 调研`, `🎨 设计`, `🗣️ 开会`. Statuses: see §5.2. Notifications: 🐢📦🔁⏰🏁🗑️📊✅🏅. Chips: ⏳🚩⏰. Settings rows: 💬 ✈️. Sheets: ✨🔑🚫. Medals: 🥇🥈🥉. Badge coins: §4.

---

## 2. Global layout and behaviour

### 2.1 App shell
- A column: the screen scroll area (`flex:1`, overscroll contained, scrollbar hidden, children `flex-shrink:0`), then the tab bar.
- Overlays, in z-order from bottom to top: FAB (8), sheet (30), confetti canvas (35), toast (40). The appbar is z 5 and sticky.
- Mock frame is 390×844. Content width is 354 after 18px gutters.
- **[DEMO]** Below 900px the prototype fills the viewport, hides the fake status bar and home indicator, and pads with `env(safe-area-inset-*)`.
- **[Q]** No desktop layout exists. REQUIREMENTS §10 says "网页版：电脑浏览器使用". Should desktop show a centred phone-width column, or does it need its own layout?

### 2.2 Top bars (three variants)
1. **Root-tab header `.top`.** No back button. Padding-top 6.
   - Home: brand (logo tile "M" in lemon, rotated −6°, with a gum offset shadow, plus the wordmark `MeritAI`) on the left; an avatar button (`aria-label="我的"`) on the right that navigates to `me`.
   - Tasks, notifications and me: a large `h1.title` only (`我的任务` / `通知` / `我`).
2. **Pushed-screen `appbar`.**
   - Sticky, 3-column grid: back button (`aria-label="返回"`) / centred title + optional subtitle / optional right action.
   - Background is translucent paper with a 10px blur. In RN, use a semi-opaque paper or expo-blur.
   - Used by project, settings, pick (right action is a gear, `aria-label="项目设置"`), task and badges.
3. **Wizard `flowTop`.**
   - Grid of 40 / 1fr / 40: back (`aria-label="上一步"`, hidden on steps 1 and 3), a 6-segment progress bar (segment height 6, grape when ≤ current step), close ✕ (`aria-label="关闭"`).
   - Below it, the step label `新建项目 · 第 {n} / 6 步`.
   - Close discards everything and returns to home **without confirmation**. **[Q]** Should it confirm?

### 2.3 Bottom tab bar
- Four equal tabs, from `[['home','首页'],['tasks','任务'],['notifs','通知'],['me','我']]`, with icons home / tasks / bell / user at 22px.
- Card background, 1px line on top.
- Active tab: label in `--grape-text`, a 48×30 pill in `--grape-soft` behind the icon, `aria-current="page"`.
- Inactive tab: `--muted`, 11px/600 label.
- **Unread counter on 通知:** a red pill (`--bad` bg, `--on-bad` text), min 17×17, positioned top 3 / left 50%+9px, `aria-label="{n} 条未读"`. It counts unread notifications no matter which filter is selected. Sample value: `4`.
- Hidden during the new-project wizard (`new*`). Visible on all other screens, including pushed ones. The highlighted tab is the root of the current stack.

### 2.4 Navigation model
- The app keeps a stack. Tapping a root tab replaces the stack with `[tab]`. Other routes push.
- Back pops, or falls back to `home`.
- `new3` (analysing) is transient: leaving it removes it from the stack, so Back on new4 returns to new2.
- Deep link to "rank" = the project screen with the `排行` segment selected. From the weekly card it is pushed on top of the current stack. From the map it resets to `['home','project']`.
- Opening `project` via its card always resets the segment to `任务包`.
- Finishing the wizard sets the stack to `['home','pick']`. Exiting it sets `['home']`.
- **[Q]** Android hardware back and web browser history are not modelled. Proposed: close the open sheet first, then pop.

### 2.5 FAB (home only)
- 58×58, radius 20, grape, plus icon at 26px, `aria-label="新建或加入项目"`.
- Absolute position: right 18, bottom 96 (above the tab bar; on mobile `92 + safe-area`).
- A 56px spacer ends the home list so the FAB never covers the last card.
- Opens the sheet `fab`.

### 2.6 Bottom sheets
- Container: full-screen scrim `rgba(20,16,36,.45)`. The sheet is card-coloured, has 26px top radius, max-height 88% (scrolls beyond that), a 40×5 grab handle in `--line`, and the `rise` animation.
- Accessibility: `role="dialog" aria-modal="true" aria-label="选项"`. On open, focus moves to the first button or input; on close, focus returns to the opener.
- Closes on: a scrim tap, Esc, or any button inside it. Buttons that show a toast also close the sheet.
- **[Q]** The swipe-down-to-dismiss gesture is implied by the grab handle but not implemented.

| Sheet | Content (verbatim) |
|---|---|
| `fab` | h4 `要做什么？`. Option ✨ **`新建项目`** / `你当组长，上传作业要求让 AI 拆任务` → `new1`. Option 🔑 **`用邀请码加入`** / `组员分享给你的邀请码或链接` → in the prototype only toasts `输入组员给你的邀请码，例如 MKT-7Q4P`; **a real join screen is needed**. |
| `commit` | h4 `这个提交属于哪个任务？`; p `AI 自动归类的，归错了就改一下。`. Then one option per **my open tasks in that project**: kind emoji, **task title**, `{pts} 分 · {due}` → toast `已把这个提交改归到「{title}」`. Then 🚫 **`不属于任何任务`** / `例如改错字、改格式` → toast `这个提交不会算进任何任务`. |
| `addtask` (leader) | h4 `加一个任务`. Field `任务名称` (sample `补充访谈：学生消费者`). Field `贡献值` (sample `4 分`). p `加进去后，会<b>自动放进目前最轻的任务包</b>。所有任务的贡献值会按比例换算，总分还是 100 分。`. Button `加进去` → toast `已加入目前最轻的任务包`. **[Q]** There are no fields for kind, due date or description. |
| `resplit` (leader) | h4 `重新分包`. p `还没开始的任务会重新平均分配；已经开始或完成的任务，留在原来的人那里。有人加入或退出时可以用。`. Stepper `分成几个包` (value 5): − → toast `至少要和现在的成员人数一样多`; + → toast **[DEMO]** `样稿里固定 5 个包`. Button `重新分包` → toast `已重新分包，大家会收到通知`. |

### 2.7 Toasts
- Position: top 52 in the mock; on devices `12px + safe-top`. Left and right 16.
- Style: radius 16, `--ink` bg with `--paper` text (inverted), 14/600 centred, shadow.
- `role="status" aria-live="polite"`, no pointer events, 2.8s, a new toast replaces the current one.
- Full list, verbatim:
  - `已加入「迎新晚会筹备」，记得去选任务包` · `已拒绝邀请`
  - `ENG101 已结束。大家有 14 天下载贡献报告` · `正在下载 ENG101 团队贡献报告.pdf`
  - `🎉 任务包 {n} 是你的了！` (first pick) · `换好了，现在任务包 {n} 是你的` (switch)
  - `已向 {name} 发出互换请求，对方同意才会换`
  - `互换好了！任务包 {n} 是你的了` · `已拒绝互换`
  - `任务完成！+{pts} 分` (AI 优秀/合格) · `AI：拿一半，先拿 {pts/2} 分` · `AI：不通过，改好可以重交`
  - `完成！+{pts} 分` (self-marked)
  - `已推翻 AI 判断，你拿满 {pts} 分，全组看得到` / `已推翻 AI 判断，{name}拿满 {pts} 分`
  - `已把这个提交改归到「{title}」` · `这个提交不会算进任何任务`
  - `已加入目前最轻的任务包` · `至少要和现在的成员人数一样多` · `已重新分包，大家会收到通知`
  - `邀请链接已复制`
  - `可以一次上传多个文件，例如评分标准 + 作业说明`: an explanation standing in for a real file picker
  - `输入组员给你的邀请码，例如 MKT-7Q4P`: a placeholder for the join screen
  - **[DEMO]** `选包页面和 MKT201 一样，样稿里没有重复做`, `样稿只做了中文，正式版有 English`, `这是样稿，不会真的退出`, `样稿里不会真的连接 Telegram`, `样稿里不会真的结束项目`, `样稿里保留这个例子文件`, `样稿里固定 5 个包`

### 2.8 Confetti
- Full-screen canvas above content, no pointer events.
- 110 rectangles in the six highlighter colours (resolved for the current theme).
- Spawn point: horizontal centre ±30px, 42% of the height.
- Initial velocity: vx ∈ ±5.5, vy ∈ [−17, −5]. Gravity +0.35 per frame, vx damping 0.99, random spin.
- Size 6–12 × half that. Runs 2.2s, then clears.
- **Fires on:** picking or switching a package; the AI result 优秀/合格 (task done); self-marking a meeting task done.
- **Not fired** on a leader override or on 拿一半/不通过. Skipped under reduced motion.

### 2.9 Dialogs
- The prototype has **no confirmation dialogs**. These actions fire immediately: sign out, end project, override AI, re-split, remove file, exit wizard, decline invite, and accept/decline swap.
- **[Q]** Which of these need a confirm step? At least end project, override, re-split and sign out look like candidates.

### 2.10 Focus and accessibility
- `:focus-visible` → 3px solid grape outline, 2px offset, radius 8.
- On route change, focus moves to the page `h1[tabindex=-1]` or the appbar `h2[tabindex=-1]`, without scrolling. Scroll position resets to top.
- On a re-render within the same route, focus is restored to the element with the same `data-act`, `data-go` or id.
- Avatars: `role="img" aria-label="{full name}"`.
- Decorative emoji and SVGs: `aria-hidden`.
- The ring has `role="img" aria-label="已完成 {x} 分，共 100 分"`.
- Segmented controls: `role="group" aria-label=…`, buttons use `aria-pressed`. Toggles use `aria-pressed` plus `aria-label`. Package expanders use `aria-expanded`. The team-size stepper output is `aria-live`. The AI scan card and the analysis checklist are `aria-live="polite"`.
- Labels: `aria-label="移除文件"` / `"移除 Google 文档"` / `"删除任务 {n}"` / `"删除 {name}"` / `"减少小组人数"` / `"增加小组人数"` / `"减少任务包"` / `"增加任务包"` / `"任务 {n} 名称"` / `"任务 {n} 贡献值"`. Pcard `aria-label="任务包 {n}"`. Nav `aria-label="主导航"`.
- Esc closes a sheet.
- RN equivalents: `accessibilityRole`, `accessibilityState {selected, checked, expanded, disabled}`, `AccessibilityInfo.setAccessibilityFocus`, `accessibilityLiveRegion` (Android), and `useReducedMotion`.

### 2.11 Dark mode
- Three modes, set in Me → `外观`: `跟随系统` (removes the `data-theme` attribute), `浅色`, `深色`.
- The token swap is complete (§1.1). The toast, the weekly card and the `ms .tag` invert, because they use ink as their background.
- The prototype does not persist the choice. **[Q]** Store it per device (local) or per account?

### 2.12 Hover-only affordances
`button.row:hover`, `.commit:hover`, `.icon-btn:hover`, `.ev-opt:hover`, `.del:hover` (turns bad-red) and `.map-link:hover` have no touch equivalent. Use pressed states on native.

---

## 3. Shared components

| Component | Spec |
|---|---|
| `card` | card bg, radius 20, `--shadow`, padding 16 |
| `list` | card with no padding and 1px line dividers between children |
| `row` | flex, gap 12, padding 13×14. Leading tile, then `grow` (title `.t` + meta `.m` with 6px-gap items), then trailing |
| `chip` | pill, `2×9`, 12/600. Variants: default (card-2 / ink-2), `.c` (member/project colour 34% / ink), `.good`, `.warn`, `.bad`, `.grape` |
| `pdot` | 8px colour dot (project colour) at the start of row meta |
| `av` avatar | circle 34 (sm 26, lg 64). Member colour bg, `--on-hl` glyph 900, 2px card ring (3px on lg). `.stack` overlaps by −9px |
| `kind` tile | 40×40, radius 13, project colour 30% mix, emoji 19 |
| `due` column | right-aligned 12/700 muted, two lines (`明天<br>09:30`); `urgent` → bad |
| `bar` | 8px track card-2, fill in colour `c` |
| Buttons | `btn` (grape primary, 3D lip), `.block` (full width), `.sm`, `.soft` (card-2/ink), `.hlb` (highlighter colour with a darker lip), `.danger` (bad-soft/bad), `[disabled]`. `link` = text button in grape-text/700 |
| `seg` | segmented control on a card-2 track; selected segment = card bg + ink + soft shadow |
| `toggle` | 44×26 pill; on = good green, off = line; 20px white knob |
| `stepper` | bordered, radius 14; −/+ buttons 46×44 (20/700); value 19/800 display |
| `input` | 2px line border, radius 14, card bg, `12×14` padding, focus border grape. textarea min-height 132, line-height 1.6, vertically resizable |
| `field` | column with gap 6: label 13/700 ink-2, optional `small` qualifier (muted 500) |
| `hint` | 12.5 muted |
| `warn-box` | warn-soft bg, warn text 12.5, radius 14, `10×12` |
| `section-h` | h3 15/700 + optional right link 13/700 grape-text |
| `hl` highlighter | a band 0.5em tall behind text at 88% of the line height, with slanted ends (gradient at 100°, 0.4em in from the left, 0.3em in from the right), colour `c` mixed at `--hl-strength` into paper, repeated on each wrapped line. Signature element. **RN needs a custom component** (measure lines via `onTextLayout` and draw Views/SVG behind the text); there is no inline background-image in RN |
| `ring` | 86px SVG, r 36, stroke 10, track card-2, round cap, project colour, starts at 12 o'clock; centre text `{x}` + `/ 100 分` |
| `file-chip` | card-2 row: 38px card-coloured icon tile, name (break-all) + meta, remove ✕ |
| `code-box` | card-2 row: invite code in mono 22 with 0.12em spacing, plus the button `复制链接` (copy icon) |
| `result` panel | radius 22, padding 18. good/warn/bad bg, grade word 34/900 in the matching colour, gain line 13.5/700, optional `by` line, bullet reasons |
| `override` box | 2px grape@40% border, card bg, radius 18 |
| `done-panel` | centred on good-soft: 🎉 42, bold 17 in good colour, hint |
| `choice` | 2px bordered selectable card (checkbox, or radio when `.radio`). Name 15/900, reason 12.5, chips row. Selected = grape border + grape-soft tint |
| `check` | inline checkbox button (22px box) + label 13.5 |
| `carousel` + `pcard` | see pick screen (§4.7) |
| `sheet-opt` | card-2 row with radius 16, emoji + title 15 + sub 12.5 muted |

---

## 4. Screens

Sample persona: 陈思远 (you, lemon). Sample "today" is about Fri 2026-09-18: tomorrow is 9/19 and "周日" is 9/20.

### 4.1 `home` (首页, tab 1)
**Purpose:** a daily dashboard: pending invitations, my next to-dos, my projects and their lifecycle actions, and the entry point for new or join.

Top to bottom:
1. **Header:** logo + `MeritAI`; my avatar on the right → `me`.
2. **Greeting:** `h1` `嗨，{给名}！`, with the name marked in the highlighter and swept in. Sample: `嗨，思远！`.
   - Sub-line when there are due items: `这周有 {n} 个任务要交，最近的明天截止。`, where n = my open tasks in buckets `明天` and `这周`.
   - Sub-line when there are none: `这周没有要交的任务，喘口气 ☕`.
   - **[BUG]** `最近的明天截止` is hard-coded. It must become `最近的{relative due}截止`. **[Q]** Exact copy for today, a weekday, a date, or overdue.
3. **Invitation card** (only while an invite is pending; lilac-tinted card):
   - 🎉 `<b>何嘉欣</b> 邀请你加入 <b>迎新晚会筹备</b>` with a hint line `管理学院学生会 · 6 人 · 不是课程作业也能用`.
   - Buttons `拒绝` (sm soft) and `接受邀请` (sm primary).
   - Accept → toast `已加入「迎新晚会筹备」，记得去选任务包`; the card disappears and a new project card appears. Decline → toast `已拒绝邀请`.
   - **[Q]** `不是课程作业也能用` reads like narration aimed at the reviewer. Is the real meta just `{course/team} · {n} 人`?
   - Data: inviter name, project name, course/team label, member count, invite id.
   - **[Q]** Several pending invites → stack several cards?
4. **Section `我的待办`**, with link `全部` → `tasks`.
   - A list of up to **4** of my open tasks, sorted by due date.
   - Empty: `没有待办，全部搞定 🎉`.
   - Task row (`todoRow`):
     - Kind tile (emoji on the project-colour tint).
     - Title.
     - Meta `● {PROJ} · 贡献值 {pts} 分 · {kind label}`. Append ` · 要重交` (bold, bad) if the status is fail, or ` · 可重交拿满` (bold, warn) if half.
     - Right-hand due column `{due}` split onto two lines at the space; red when urgent.
   - Tap → `task`.
   - Data: task id, title, project code and colour, points, kind, status, due (formatted), urgent flag.
5. **Section `我的项目`.** Project cards (`.card.proj`). Each has a head (rotated code tag in the project colour, then name 16.5/900, then meta), then variant content:
   - **In progress (CS302, member)** → `project`.
     - Meta `软件工程 · 第 7 组 · 4 人 · 组长晓雯`.
     - Progress bar = earned points out of 100, in the project colour.
     - Foot: member avatar stack, plus `{earned} / 100 分` (tabular) and ` · 还剩 32 天`.
   - **Packages still being picked (MKT201, you are leader)** → `pick`.
     - Meta `市场营销原理 · 4 / 5 人 · 你是组长` (joined / planned).
     - Foot: avatars plus a chip. If I haven't picked: warn chip `还有 {n} 个任务包没人选`. If I have: member-colour chip `你的包：任务包 {n}`.
   - **Just joined (club, no GitHub).**
     - Code tag `社团` (mint). Name `迎新晚会筹备`. Meta `管理学院学生会 · 6 人 · 没有连 GitHub`.
     - Foot: avatars + warn chip `去选任务包`.
     - The prototype taps into a demo toast; the real target is `pick` for that project.
     - **[Q]** When there is no course code, is the tag the literal word `社团`? What rule chooses the tag?
   - **Past deadline, awaiting leader confirmation (ENG101).**
     - Not tappable. Meta `学术英文 · 3 人 · 你是组长`.
     - Foot: warn chip `已过截止日 · 等你确认` + button `确认已交` → toast `ENG101 已结束。大家有 14 天下载贡献报告`, which moves the card to the grace state.
   - **Grace period (ENG101 after confirmation).**
     - Chip `14 天后删除` + soft button `下载贡献报告` → (download) `正在下载 ENG101 团队贡献报告.pdf`.
     - **[Q]** Does the chip count down (`{n} 天后删除`)? What do non-leaders see while it awaits confirmation?
   - Data per card: code, name, course/team, group label (`第 7 组`), member count / planned size, leader name, or `你是组长`, project colour, earned total, days left, members (avatars), my package index, number of free packages, GitHub-connected flag, lifecycle state, days until deletion.
6. **FAB** → sheet `fab`.

**[BUG]** `还剩 32 天` is hard-coded; derive it from the deadline.

### 4.2 `tasks` (任务, tab 2)
- `h1` `我的任务`.
- Seg (`aria-label="任务筛选"`): `待完成 · {n}` / `已完成 · {n}`.
- **待完成:**
  - Groups in order `明天`, `这周`, `之后`. Each is a `section-h` over a list of task rows (same as home). Empty groups are hidden.
  - If I haven't picked a package in some project: `MKT201 还没选任务包，选好后任务会出现在这里。`, centred hint, with the project code interpolated.
  - Open statuses are `todo, doing, overdue, fail, half`.
- **已完成:** rows with the kind tile, title, meta and a status chip (§5.2).
  - Meta is `{PROJ} · 自己标记完成 · +{pts} 分` or `{PROJ} · AI：{grade} · +{pts} 分`.
  - **[BUG]** An overridden task would read `AI：组长判定通过`. Proposed: `组长判定通过`.
- **[Q]** Buckets are missing for `今天` and `已过期`. Where do overdue tasks, and failed tasks that are already past due, go?
- **[Q]** Empty-state copy for both segments does not exist.
- Note: `已完成` lists only `status === done`. Half and fail tasks stay under `待完成`, in line with the "half = still open" reading (§9.1).

### 4.3 `notifs` (通知, tab 3)
- `h1` `通知`.
- Seg (`aria-label="通知筛选"`): `全部` / `跟我有关`.
- Items are cards. Each has a 40×40 emoji tile in a colour tint, text 14/1.5, a meta line `{PROJ} · {audience} · {relative time}`, and optional action buttons.
- Unread items show an 8px grape dot at the top right.
- The weekly summary is its own inverted card.
- Footer hint: `提醒只跟截止日期走：到期前 24 小时提醒负责人，过期了通知全组，每种只发一次。`
- The full copy is in §5.3.
- Filter `跟我有关` hides the "全组" overdue item about someone else and the weekly card. Everything flagged `mine` stays.
- **[Q]** Is there a read/unread model? Does tapping mark an item read, and is there a "mark all read"? Are notification rows themselves tappable? Only the buttons are, in the prototype.
- **[Q]** Pagination and retention: notifications of deleted projects?

### 4.4 `me` (我, tab 4)
1. `h1` `我`.
2. Profile: 64px avatar, name `陈思远` (20/900), email `siyuan.chen@gmail.com`.
3. Linked accounts list:
   - GitHub icon, `GitHub`, small `@siyuan-chen · 项目连了仓库时，用来识别你的提交`, chip good `已连接`.
   - Google icon, `Google`, small `siyuan.chen@gmail.com · 也能选 Google 文档当证据`, chip good `已连接`.
   - **[Q]** Not-connected state: button copy `连接`? Disconnect?
4. Badges card (row) → `badges`: `我的徽章` / `已解锁 6 / 12 · 永久保存 · ⚡ ✅ ⏰ 🤝 🎨 🗓️` + chevron.
5. Settings list:
   - `外观` seg `跟随系统` / `浅色` / `深色`.
   - `语言` seg `中文` / `English` (**[DEMO]** toast `样稿只做了中文，正式版有 English`; real: switch the locale).
   - `推送通知` / `任务快到期、过期、换包请求` toggle (`aria-label="推送通知"`).
   - `每周进度小结` / `每周日晚上 8 点` toggle.
6. Danger block button `退出登录` (**[DEMO]** toast).
- Data: user name, email, GitHub login, Google email, connection states, badge count and unlocked emojis, theme, locale, pushEnabled, weeklyEnabled.
- **[Q]** Is push per device? Does "每周进度小结" also control the Discord/Telegram weekly post? It shouldn't; that is per project.
- **[Q]** Timezone for "周日晚上 8 点" (the user's own, or the project's)?

### 4.5 `project` (pushed; sample CS302 as a member)
- Appbar title `CS302`, sub `你是组员 · 组长：晓雯`. There is no right action.
  - **[Q]** When the leader views their own project page, is there a gear to settings? MKT201 in the prototype only reaches settings via `pick`.
- **Hero card:**
  - Name `校园二手交易 App`, meta `软件工程 · 第 7 组 · 截止 10月20日`.
  - Ring with `{earned}` and `/ 100 分`.
  - Chips: `⏳ 还剩 32 天`, `🚩 M2 核心功能 · 9月30日` (next milestone: key, name, date), and `{github icon} campus-market` (repo name; only when connected).
- **Seg** (`aria-label="项目内容"`): `任务包` / `排行` / `动态`.
- **任务包 tab:** one card per package.
  - Header button (`aria-expanded`): 42px number tile in the owner's colour; owner avatar + name (or `我的任务包`); chip bad `1 个过期` if any task is overdue; progress bar earned/total in the owner's colour; right side `{got} 分` / `共 {total} 分`; chevron.
  - Expanded (package 1 opens by default) shows mini-task buttons: status emoji, title, right side `{grade or 完成} · {pts} 分` if done, else `{pts} 分`. Tap → `task`.
  - Footer hint: `全组都能看到每个人的任务和 AI 审核结果。`
  - **[BUG]** `1 个过期` is hard-coded; use the count.
  - **[BUG]** An overridden grade shows as `组长判定通过`; should be `通过`.
  - **[Q]** Unpicked packages on this page: no owner means no colour/name. Copy?
- **排行 tab:**
  - Podium card: 2nd / 1st (large avatar) / 3rd, medals `🥈 🥇 🥉`, short name (`你` for me), a block in the member-colour tint with height `40 + earned×2.4` px showing `{earned}` + `分`.
  - Ranked list: number, avatar, full name + `（你）`, inline badge emojis (sample 晓雯 `🏆⚡✅`, 你 `⚡🗓️`, 子杰 `✅`), bar earned/25, right side `{earned} 分` + `包内共 25 分`.
  - Formula box: `<b>怎么算：</b>整个项目 100 分，每个任务值几分。AI 审核「优秀」「合格」拿满，「拿一半」拿一半，「不通过」是 0。写代码、写报告、开会都一样算。`
  - Soft block button `🏅 看我的徽章` → `badges`.
  - **[BUG]** 25 is hard-coded; it should be that member's package total (packages aren't exactly equal).
  - **[Q]** Ties; fewer than 3 members; members with no package; which badges show inline (only ones from this project?).
- **动态 tab (feed)**, avatar + sentence + time (verbatim):
  - `<b>晓雯</b> 完成「图片上传与压缩」，AI：合格，+8 分` / `昨天`
  - `<b>子杰</b> 推了 3 个提交，AI 把它们归到「聊天模块」` / `1 小时前`
  - `🐢 <b>博文</b> 的「数据库设计」过期了，已通知全组` / `2 小时前`
  - `<b>你</b> 完成「需求分析文档」，AI：优秀，+9 分` / `9月10日`
  - `<b>晓雯</b> 同意了子杰的互换请求` / `9月2日`
  - **[BUG]** The sample order is not chronological. Sort newest first.
  - **[Q]** Full event list: overrides (REQ says overrides are visible to all), re-splits, member joined/left, task added, commit reassigned.

### 4.6 `settings` (项目设置, leader; sample MKT201)
- Appbar `项目设置`, sub `MKT201 · 你是组长`.
- **AI card:**
  - Title `AI`; seg `Gemini` / `Claude` / `OpenAI`.
  - Field label `组长的 {provider} API key` + small `· 全组共用`, showing a masked input (`AIzaSy••••••••••••3kQ` / `sk-ant-••••••••••••9fX` / `sk-proj-••••••••••••2bT`).
  - Hint `不填也能用，会换成免费的规则解析：拆任务比较粗糙，认不出选择题，也不能审核上传的文件。`
  - **[Q]** A key is stored per provider, or one active key? Save/validate/remove buttons and their error copy (invalid key, quota exhausted) are missing. The key must never be returned to the client; show only a masked suffix.
- **Integrations list:**
  - GitHub icon, `GitHub 仓库` / small `没有写代码的作业可以不连。连了之后，成员才需要连 GitHub`, chip `未连接`. **[Q]** Connect flow and copy.
  - 💬 `Discord 群` / `过期通知和每周小结也会发到群里`, chip good `#mkt201-group`.
  - ✈️ `Telegram 群`, soft sm button `连接` (**[DEMO]** toast).
- **Card `邀请码`:** code-box `MKT-7Q4P` + `复制链接` → toast `邀请链接已复制`.
- **Card `结束项目`:**
  - Hint `确认作业已经交了之后，大家有 14 天可以下载团队贡献报告，之后整个项目会被删除（徽章会保留）。截止日过了 7 天还没确认，会自动结束。`
  - Danger button `确认已交，结束项目` (**[DEMO]** toast).
- Missing but required by REQUIREMENTS: see §9.3. That covers members, invite by email or username, the deadline, renaming, AI key removal, and GitHub connect.

### 4.7 `pick` (选任务包; sample MKT201, 5 packages of 20 分)
- Appbar `选任务包`, sub `MKT201 · 5 人 · 先到先得`, right gear → `settings`.
- Title (23px): `每包都是 <hl gum>20 分</hl>，<br>挑你最想做的`.
  - **[Q]** Copy when packages aren't equal (100/3 people) → new6 says `每包大约 …`.
- Sub: `左右滑动看看。还没开工可以直接换到没人选的包；想换别人的包，要对方同意，而且两个包都还没开工。`
- **[DEMO]** A `.proto` box `原型 这里固定用 5 人的例子。` appears when the wizard team size isn't 5.
- **Carousel:**
  - Cards are 84% wide, snap to centre, 14px gap, bleed to the screen edges.
  - Initial position: my package; otherwise the first free package.
  - Dot indicator below: 7px dots, the active one 20px wide in ink.
- **Package card `pcard`** (`aria-label="任务包 {n}"`):
  - **Band** in the owner's colour (or the waiting colour):
    - Contents: `任务包 {n}` (900), `约 {h} 小时` (right), big `{pts}` + `分`, `贡献值` (right).
    - Bottom edge is scalloped: semicircles of r6 every 14px. Needs an SVG in RN.
  - **Body:** one row per task.
    - Row contents: kind tag (`代码/文档/调研/设计/开会`), `{status emoji} {title}`, right side `{pts} 分` over `{due}`.
    - Tap a row → `task`.
  - **Foot variants:**
    - **Mine:** avatar + bold `这是你的任务包 ✓` + soft block button `去看我的任务` → the first task of the package. **[Q]** Should this go to the tasks tab instead?
    - **Taken by someone else:** `已被 {全名} 选走`, plus ` · 已开工` if their package has started. Then:
      - I haven't picked yet: no button.
      - Mine not started and theirs not started: soft button `🔁 申请互换` → toast `已向 {全名} 发出互换请求，对方同意才会换`.
      - Otherwise: disabled `对方已开工，不能互换` or `你已开工，不能互换`.
      - **[Q]** A pending state for my own outgoing request (`已申请，等对方同意`?) and cancelling it are missing.
    - **Free:** a highlighter-coloured block button with the label `选我！` (not picked yet) or `换成这个` (already picked). It is disabled if my package has started.
      - When I already have a package, a hint below: `你还没开工，可以直接换` or `你已开工，不能换包`.
      - Picking or switching fires confetti plus a toast (§2.7).
- **Leader tools card:** `组长工具` + chip grape `只有你看得到`; soft sm buttons `加任务` (plus icon) → sheet `addtask`, `重新分包` (shuffle icon) → sheet `resplit`.
- Footer hint: `截止日期是 AI 按里程碑建议的，组长可以再改。`
- **[Q]** No UI exists for the leader to edit due dates or move a single task (REQ §3), even though this hint promises it.
- Data per package: index, points sum, estimated hours, owner (name/colour/avatar) or waiting colour, started flag, tasks (kind, status, title, points, due), my package index, my started flag, pending swap state, viewer-is-leader.

### 4.8 `task` (任务详情)
- Appbar `任务详情`, sub `{PROJ} · 任务包 {n}`.
- **Head:**
  - Chips: project-colour `{emoji} {kind}`, grape `贡献值 {pts} 分`, and `⏰ {due}` (bad when urgent or overdue).
  - `h1` (24px) with the title; description paragraph if present.
  - Owner bar: avatar + `负责人：你` / `负责人：{全名}`, or chip warn `还没人选这个任务包`.
  - If the AI suggested a due date: hint `截止日期由组长设定 · AI 原本建议 {aiDue}`. **[BUG/Q]** It shows even when the due date equals the suggestion. Show only when it differs?
- **Evidence block**, one of:
  1. **Reviewing:** card with an animated scan, bold `AI 正在看你的提交…` (code) / `AI 正在看你的文件…` (file), three skeleton lines, a lemon sweeper, hint `通常 10–30 秒，看完会自动更新`, aria-live. Real app: poll or push until the review lands.
  2. **Someone else's task, not reviewed:** card with `{全名}还没交证据` or `这个任务包还没人选`. Hint: `🐢 已经过了截止时间，全组都收到了通知。` when overdue, else `截止 {due}。交了证据、AI 审核通过就会自动完成。`.
     - **[Q]** REQ says all data is public. Can others see this person's commits/files before review? The prototype hides them.
  3. **Result** (any viewer, status done/half/fail):
     - **Self-marked done:** done-panel `🎉` / `完成！+{pts} 分` / hint `开会这类任务，自己标记就算完成。`, or `…负责人标记就算完成。` for other viewers.
     - **Done (优秀/合格):** green panel with the grade, `拿满 {pts} 分`, plus ` 🎉 任务完成` if it is mine, then the AI reason bullets.
     - **Overridden:** grade word `通过`, then `AI 原本判「不通过」，组长（你）推翻了这个判断。全组都看得到。`. **[BUG]** When the leader isn't you it reads `组长推翻了…` with no name.
     - **拿一半:** amber panel `拿一半`, `现在拿 {pts/2} 分`, plus `，改好重交可以拿满` if mine, then reasons, then (mine) soft block `修改后重新提交`.
     - **不通过:** red panel `不通过`, `暂时 0 分，任务还没完成`, reasons, (mine) soft block `重新提交`. Then:
       - Viewer is leader: override box with bold `你是这个项目的组长`, hint `觉得 AI 判错了？你可以推翻它，这个任务就算通过（自己的任务也可以）。全组都会看到是你推翻的。` (the parenthetical only on own tasks), sm button `推翻 AI，算通过`.
       - Otherwise: hint `觉得 AI 判错了？组长{短名}可以推翻 AI 的判断。`
     - Resubmitting resets the status to in progress and clears the evidence. **[Q]** Should half points be kept until the new review finishes?
  4. **My meeting task (`meet`):** card `这类任务不用交文件`, hint `开会、沟通协调这种没有文件的任务，开完会自己标记完成就算。`, block button (check icon) `我开完了，标记完成` → confetti + `完成！+{pts} 分`.
  5. **My code task:**
     - Section `GitHub 提交 · AI 自动归类`.
     - A list of commits, each a button that opens the `commit` sheet: mono SHA, message, and a line `+{add} −{del} · {day}`, with chip good `有效` or chip `太小，不算`. Samples: `a41f9c2 feat: 登录表单与字段验证 +182 −12 · 周二`, `d09b3e1 feat: 注册页 + 邮箱验证码 +240 −30 · 昨天`, `7c2e5aa style: 调整按钮间距 +6 −6 · 今天`.
     - Hint `平时推的提交会自动归到这个任务，归错了点一下就能改。做完了再点下面的按钮，AI 会看全部提交来评级。`
     - **[DEMO]** outcome switch.
     - Primary block button (sparkle) `我做完了，交给 AI 审核`.
     - **[Q]** Empty state with no commits yet. Should the button be disabled? A code task in a project with no repo?
  6. **My file-type task (doc/research/design):**
     - Section `交证据` + hint `交了证据，AI 审核通过，任务就自动完成。`
     - Two dashed option tiles: upload icon `上传文件` / `Word、PDF、PPT、图片 · 最大 25MB`; Google icon `选 Google 文档` / `从你的 Google Drive 选一个，只读这一个文件`.
     - After choosing: a file chip. For a file: `{name}` / `1.8 MB · Word`. For a Google Doc: `{title}（Google 文档）` / `编辑记录：思远 82% · 晓雯 18%`. Remove ✕ in both.
     - **[DEMO]** outcome switch.
     - Block button (sparkle) `交给 AI 审核`, disabled until evidence is attached.
     - **[Q]** Multiple files? Oversize/unsupported-type error copy? Upload progress? How is the "82%" edit share computed? Drive revision history only gives the last modifier per revision, so a percentage is an approximation.
     - **[Q]** What if the project has no AI key (REQ: files cannot be reviewed)? The prototype has no path.
- Data: task (id, title, desc, kind, points, due, aiDue, status, grade, completion method, reasons, overriddenBy), project (code, colour, leader), package number, owner, viewer role, evidence (commits with attribution and validity; file meta; gdoc meta and edit shares), review state.

### 4.9 `badges` (我的徽章)
- Appbar `我的徽章`, sub `已解锁 6 / 12`.
- Hint `徽章永久保存在你的个人资料里，项目删除后也还在。`
- A 3-column grid of tiles: coin (56px circle, colour tint, 3px border), name, condition, and a source line.
  - Unlocked: `{date} · {project code}`.
  - Locked: grayscale, dashed coin, muted name, and the source line shows progress text (`还没有`, `2 / 3`, …). The full list is in §4.10.

### 4.10 Badge list (verbatim)

| Emoji | Name | Condition | Colour | Sample state |
|---|---|---|---|---|
| ⚡ | `先下手为强` | `第一个选任务包` | lemon | `9月14日 · CS302` |
| 🗓️ | `全勤` | `连续 4 周都有进展` | tang | `9月13日 · CS302` |
| ✅ | `一次过` | `连续 3 次 AI 第一次审核就通过` | mint | `8月30日 · ENG101` |
| ⏰ | `准时王` | `5 个任务都在截止前完成` | sky | `8月30日 · ENG101` |
| 🤝 | `好队友` | `同意过一次换包` | gum | `8月12日 · ENG101` |
| 🎨 | `全能选手` | `完成 3 种不同类型的任务` | lilac | `8月28日 · ENG101` |
| 🧯 | `救火队员` | `接手别人放下的任务` | tang | locked · `还没有` |
| 🏆 | `本周最佳` | `一周内拿到全组最多贡献值` | lemon | locked · `还没有` |
| 🌟 | `三次优秀` | `AI 给了 3 次「优秀」` | mint | locked · `2 / 3` |
| 📚 | `报告达人` | `完成 5 个文档任务` | sky | locked · `3 / 5` |
| 🔥 | `三连冠` | `连续 3 周本周最佳` | gum | locked · `0 / 3` |
| 🐢 | `压哨王` | `在截止前 10 分钟才交（不太光彩）` | lilac | locked · `还好没有` |

**[Q]** None of these are in REQUIREMENTS.md; each rule needs confirming and precise definitions:
- "进展" (activity): with REQ §6 dropping inactivity tracking, what counts?
- "接手别人放下的任务": no hand-over feature exists.
- "准时": 5 tasks total, or 5 in a row?
- Whether 🐢 is a public "shame" badge; whether `拿一半` counts as "通过" for 一次过; whether 本周最佳 needs a minimum score.
- Unlocking is per user across projects, and the source keeps the project code even after the project is deleted, so the badge must store a snapshot of that code.
- `全能选手`: "类型" = the 5 kinds?

### 4.11 New-project wizard (tab bar hidden)

**`new1` — `新建项目 · 第 1 / 6 步`**
- Title `先说说<hl mint>这个项目</hl>`.
- Field `项目名称` (sample `市场营销报告`).
- Field `课程或团队` + small `· 选填，不是课程作业也可以` (sample `MKT201 市场营销原理`).
- Row: `截止日期` (sample `10月15日 23:59`; needs a real date-time picker) and `小组人数` stepper (−/+, range **2–8**, default 5, output aria-live).
- Hint `任务会按人数分成 {n} 个等量的任务包。`
- Field `GitHub 仓库` + small `· 选填，只有写代码的作业需要`, placeholder `例如 siyuan-chen/campus-market`.
- Block button `下一步` → new2.
- **[Q]** The home card shows a separate **code** (`MKT201`) and course (`市场营销原理`) plus a group number (`第 7 组`), but new1 has one combined field. Split or parse? Also the repo connect flow (GitHub App install / webhook) and validation.

**`new2` — step 2**
- Title `告诉 AI <hl sky>要做什么</hl>`.
- Seg (`aria-label="输入方式"`): `上传文件` / `打字描述` / `手动建任务`.
  - **上传文件:** dashed drop area holding a file chip `MKT201_Assignment2_Brief.pdf` / `3 页 · 已上传` (✕), a soft block `再加一个文件` (upload icon; multi-file allowed), and hint `评分标准、作业说明、项目需求、比赛规则都可以。PDF、Word、图片（拍照）都行。`
  - **打字描述:** textarea label `用几句话描述要做什么`, sample `我们要写一份市场营销报告：从 5 个品牌案例里任选 2 个做本地化和定价分析，加一份 50 人的问卷调查，最后 10 分钟课堂演示。`, hint `不用写得很完整，AI 会自己补上合理的步骤。`
  - **手动建任务:** a card of rows (name input, points input shown as `20 分`, delete ✕), link `+ 加一个任务` (adds `新任务` / 10). Hint `不想用 AI 也可以，自己列任务和贡献值。` Samples: `市场调研` 20, `问卷设计与分析` 25, `书面报告` 35 (total 80, which demos the rescale).
- **AI card** (not in manual mode):
  - `AI 设置` + small `· 组长填，全组共用`; provider seg; field `{provider} API key`, placeholder `粘贴你的 key`, hint `Gemini 有免费额度。之后也可以在项目设置里改。`
  - Checkbox `先不填，用免费的规则解析`. When checked, the seg and field hide and a warn-box appears: `没有 AI 的话：拆任务比较粗糙，认不出「任选题」，交上来的文件也不能审核。`
- Sticky footer button: `下一步` (manual → new5), `用规则解析` (no key → new3), or `让 AI 拆解` (→ new3).
- **[Q]** Can the free rule parser read Word or photos without AI (OCR)? Is there a max file size or count for brief uploads? Manual mode never asks for an AI key; is that intended?

**`new3` — step 3 (analysing; no back button)**
- Title `AI 正在<hl lemon>划重点</hl>…`, or `正在<hl lemon>划重点</hl>…` with no key.
- A doc-scan card: 8 grey lines (widths 92/78/86/64/95/70/88/55%) highlighted in turn in lemon, gum, mint, sky, tang, lilac, gum, lemon.
- Checklist (✓ = done in 900 good, spinner = current, muted = waiting):
  - **AI:** `读完作业说明（3 页）` ✓; `找到 4 个评分项，加起来 100%` ✓; `发现一道选择题：5 个案例任选 2 个` ✓; `估算每个任务的工作量和截止日期` (spinner); `按 {n} 人分成等量任务包` (waiting).
  - **Rules:** `读完作业说明（3 页）` ✓; `按「数字 + %」找到 4 个评分项` ✓; `按条列拆成任务（没有 AI，认不出任选题）` (spinner); `按 {n} 人分成等量任务包` (waiting).
- Soft block `跳过动画`. The prototype auto-advances after 3.6s to new4 (AI) or new5 (rules).
- **[Q]** In the real app this is actual processing: are the checklist lines real progress events or scripted? `跳过动画` makes no sense before the result exists. Error/timeout/invalid-key/quota copy is missing, as is the path when AI finds **no** choice question (proposed: skip new4).

**`new4` — step 4 (choice question; AI only)**
- **[DEMO]** switcher `原型 · 换个例子` [`任选几题` | `整组选一个做法`].
- **Pick-N variant:**
  - Title `作业说「<hl gum>5 个案例任选 2 个</hl>」`.
  - Sub `AI 按工作量和资料多少推荐 A + B（加起来约 29 小时，最省力）。你是组长，确认后才会拆成任务。`
  - Checkbox cards `{key}. {name}` / reason / chip `工作量 {level} · 约 {h} 小时`, plus chip grape `✨ AI 推荐` on recommended options:
    - `A. 星巴克的本地化`, `公开资料多，分析方向清楚。`, `中 · 约 14 小时`, recommended
    - `B. Grab 的定价策略`, `本地品牌，问卷容易找到人填。`, `中 · 约 15 小时`, recommended
    - `C. 特斯拉的品牌营销`, `数据分散，要读较多英文资料。`, `高 · 约 22 小时`
    - `D. 喜茶出海`, `马来西亚市场的数据比较少。`, `中 · 约 17 小时`
    - `E. Shopee 直播带货`, `数据变化快，容易过时。`, `高 · 约 20 小时`
  - Button: `确认选这 2 个` when exactly N are selected; otherwise disabled `要选 2 个（现在 {n} 个）`.
- **Method variant:**
  - Title `作业说「<hl gum>选一种开发流程</hl>」`.
  - Sub `例子：CS 小组项目「宿舍报修系统」。AI 按工作量和时间（5 周）推荐 Agile。你是组长，确认后 AI 就按这个流程拆任务。` (**[DEMO]** the `例子：…` framing)
  - Radio cards:
    - `Waterfall 瀑布式` / `先写完需求和设计，再一次开发完。文档多，要到最后才有能用的版本。` / `中 · 约 150 小时`
    - `Agile（Scrum）` / `每两周交一个能用的版本，老师中途检查也有东西给他看。每周要开一次短会。` / `中 · 约 140 小时` / ✨ recommended
    - `RAD 快速原型` / `先做原型，让用户试用再改。要反复找人试用，比较花时间。` / `高 · 约 165 小时`
  - Button `确认用 {name}`.
- **[Q]** REQ asks for "优缺点" per method, but the prototype shows one sentence. Separate pros/cons lists? Multiple choice questions in one brief? Load levels are `低/中/高`? (only 中/高 appear).

**`new5` — step 5 (review the plan)**
- Title `看看这样<hl lilac>分对不对</hl>`.
- Sub by mode:
  - Manual: `这是你自己列的任务。`
  - Method: `按 Agile（Scrum）拆的任务：每个 Sprint 有开发任务和回顾会。` (in general `按 {method} 拆的任务：…`; **[Q]** generic copy).
  - Otherwise: `名称、贡献值、截止日期都能直接改，也可以加任务、删任务。`
- Rules mode adds a warn-box `这是规则解析的结果，比较粗糙，请仔细检查。`.
- **[DEMO]** `.proto` `原型 这个例子只演示到这一步，后面接回 MKT201 的例子。`
- **AI/rules body:**
  - Milestone card, rows of dark tag + name + mono date:
    - Pick-N: `M1 选题与调研 9/28`, `M2 分析与初稿 10/8`, `M3 定稿与演示 10/15`.
    - Agile: `S1 Sprint 1 交付 10/9`, `S2 Sprint 2 交付 10/23`, `S3 最终交付与演示 11/6`.
  - Then one card per workstream: header `{title}` + `{sum} 分` (grape), task rows `{name}` / `{pts} 分` / date chip `{M/D}` / delete ✕, and link `+ 加任务` (adds `新任务` / 3 / `10/1`).
  - Workstreams for pick-N: `案例分析：{第1个所选}`, `案例分析：{第2个所选}`, `书面报告`, `课堂演示`, `组会`.
- **Manual body:** a single card of `{name}` / `{pts} 分` / (no date) / ✕, plus link `+ 加任务`.
- Sticky footer:
  - Chip good `合计 100 分 ✓`, or warn `合计 {total} 分，确认时会按比例换算成 100 分`.
  - Button `分成 {n} 个任务包` → new6.
- **[BUG]** The sub-line promises inline editing of name, points and date, but the prototype renders them as static text. They must be editable (REQ: 组长可以逐个修改).
- **[Q]** Every task in the app has a **kind** (💻📄🔎🎨🗣️) and **estimated hours**, but new5 never shows or edits them. Does AI infer them, and can the leader change them?
- **[Q]** Manual tasks have no due dates. How are they set?
- **[Q]** Rounding rule for the proportional rescale (integers? one decimal?).
- **[Q]** Are milestones and workstreams persisted and editable later? The milestone does appear in the project hero chip.

**`new6` — step 6 (packages done)**
- Title `分好了！<hl mint>{n} 个任务包</hl>`.
- Sub: `每包都是 {100/n} 分。`, or `每包大约 {x.x} 分。任务不能切得更细，所以会有一点点差距。`, followed by `没人选的包先用待选色，被选走后会变成主人的颜色。`
- A split bar of n equal segments in waiting colours.
- Card `把组员拉进来`:
  - Code-box `MKT-7Q4P` + `复制链接`.
  - Field `或者输入邮箱、GitHub 用户名`, placeholder `xiaowen@uni.edu, @ahmad-dev`.
  - Hint `对方登录后，会在首页看到邀请。`
  - **[Q]** There is no send/add button for the email/username field. Invite-code format is `{project code prefix}-{4 chars}`?
- Block button `去选我的任务包` → pick (stack `home, pick`).

---

## 5. Labels and copy

### 5.1 AI grade labels (REQ §5, never show 0–100)

| Label | Credit | Result-panel colour | Status chip |
|---|---|---|---|
| `优秀` | full | good (green `#0B7A4C` on `#DDF6EA`; dark `#52D69B` on `#173A2C`) | chip good `优秀` |
| `合格` | full | good (same green) | chip good `合格` |
| `拿一半` | half | warn (`#8F5100` on `#FFEFD2`; dark `#F4B35A` on `#3A2C14`) | chip warn `拿一半` |
| `不通过` | 0 | bad (`#B8223C` on `#FFE4E9`; dark `#FF7A8F` on `#401B24`) | chip bad `不通过` |

Non-AI completion methods:

| Stored as | Shown as | Colour |
|---|---|---|
| `自己标记` | `完成` (done list meta: `自己标记完成`) | good |
| `组长判定通过` (override) | `通过` | good |

### 5.2 Task status

| Status | Emoji | Chip | Notes |
|---|---|---|---|
| todo | ⭕ | `待开始` (default chip) | |
| doing | 🔨 | `进行中` (default chip) | **[Q]** what triggers todo→doing |
| overdue | 🐢 | chip bad `🐢 已过期` | due chip turns red |
| fail | ❌ | chip bad `不通过` | row meta `要重交` |
| half | 🌓 | chip warn `拿一半` | row meta `可重交拿满`; still counted as "open" |
| done | ✅ | chip good `{grade/完成/通过}` | |

"Urgent" makes the due text red. **[Q]** Is that ≤ 24h?

Due-date formats in the prototype: `明天 09:30`, `周日 20:00`, `10月18日`, `9月10日`. Plan dates: `9/24`. Relative times: `刚刚`, `12 分钟前`, `1 小时前`, `2 小时前`, `今天 08:00`, `昨天`, `9月10日`. Commit dates: `周二`, `昨天`, `今天`.

### 5.3 Notification copy (verbatim)

Meta line format: `{PROJ} · {全组都收到|只有你收到|只有组长收到} · {time}`.

| Type | Emoji / tint | Text | Meta | Actions |
|---|---|---|---|---|
| **Overdue, to the whole group (humorous)** | 🐢 sky | `「数据库设计」刚过截止时间，<b>博文</b>还在路上。大家帮他加加油？` | `CS302 · 全组都收到 · 2 小时前` | none |
| Packages ready | 📦 gum | `<b>MKT201</b> 的任务包分好了，还有 {n} 个没人选，先到先得！` | `MKT201 · 1 小时前` | `去选任务包` → pick |
| Swap request (to me) | 🔁 tang | `<b>Ahmad</b> 想用他的「任务包 5」换你的「任务包 {n}」。两个包都还没开工，你同意就立刻互换。` | `MKT201 · 刚刚` | `拒绝` (soft), `同意互换` |
| Swap accepted | 🔁 tang (read) | `你同意了互换，现在「任务包 5」是你的。` | | |
| Swap declined | 🔁 | `你拒绝了 <b>Ahmad</b> 的互换请求。` | | |
| Swap voided | 🔁 | `<b>Ahmad</b> 的互换请求已失效，因为你换了别的任务包。` | | |
| Due in 24h (owner only) | ⏰ lemon | `你的「登录与注册页面」还有 <b>24 小时</b>截止（明天 09:30），冲！` | `CS302 · 只有你收到 · 12 分钟前` | `打开任务` → task |
| Deadline passed, confirm (leader only) | 🏁 lilac | `<b>ENG101</b> 已经过了截止日 2 天。作业交了吗？确认后大家有 14 天下载贡献报告；再过 5 天没确认，会自动结束。` | `ENG101 · 只有组长收到 · 今天 08:00` | `确认已交` |
| Deletion scheduled (whole group) | 🗑️ lilac | `<b>ENG101</b> 会在 14 天后删除，记得下载团队贡献报告 PDF。你的徽章不会被删除。` | `ENG101 · 全组都收到 · 刚刚` | `下载贡献报告` |
| **Weekly summary** (inverted card) | — | Title `📊 CS302 本周小结`. Tiles: `项目进度` / `+12 分` (green) / `29 → 41 分`; `完成任务` / `3 个` / `其中 1 个「优秀」`. Lines `🏆 本周最佳：{avatar} <b>晓雯</b>，+8 分` and `🐢 过期的任务：1 个（博文）` | (none) | `看排行榜` → project/排行 |
| AI review result | ✅ mint | `AI 看完了你的「需求分析文档」：<b>优秀</b>，拿满 9 分。` | `CS302 · 9月10日` | |
| Badge unlocked | 🏅 lemon | `解锁徽章「<b>全勤</b>」：连续 4 周都有进展。` | `9月13日` | `看我的徽章` → badges |

**[Q]** Push and Discord/Telegram message wording: same as in-app? The humorous overdue template needs variants, since it currently uses "他".

**[Q]** English versions of all of this are not written anywhere.

**[Q]** There is no copy for: half/fail review results, overrides, re-split done, a new task added to my package, a member joined/left, or an invite received. Are these in-app notifications too?

---

## 6. Sample data model → proposed backend mapping

### 6.1 Prototype structures
- `P` (people): `{n: full name, s: avatar glyph, c: colour}`.
  - Keys: `me` 陈思远/远/lemon, `xw` 林晓雯/雯/gum, `zj` 黄子杰/杰/mint, `bw` 李博文/文/sky, `jx` 何嘉欣/欣/lilac, `ah` Ahmad/A/tang.
  - `short()` gives `你` for me, drops the surname for 3-character Chinese names, and otherwise keeps the full name.
  - **[Q]** Naming rules for 2- and 4-character names, compound surnames, and Latin names. Is the avatar glyph the last Chinese character or the first Latin letter? Profile photos?
- `PROJ`: `{code, name, leader, c}`: CS302 (leader xw, lemon) and MKT201 (leader me, gum). ENG101 and the club project are inline HTML only.
- `KIND`: `code 💻 代码`, `doc 📄 文档`, `research 🔎 调研`, `design 🎨 设计`, `meet 🗣️ 开会`.
- `T` (27 tasks). Fields:
  - `proj`, `pkg` (1-based), `owner` (CS302 only; MKT201 owner = package owner), `t` title, `pts`, `k` kind, `due` (a display string).
  - `status` ∈ `todo|doing|done|half|fail|overdue`.
  - `grade` ∈ `优秀|合格|自己标记|组长判定通过`, `ai` (reason strings), `desc`.
  - `aiDue` (AI-suggested due), `urgent`, `bucket` (`明天|这周|之后`), `order` (sort key).
  - CS302: packages 1–4 at 25 分 each. The sample total earned is 41 (49 after the login task). MKT201: packages 1–5 at 20 分 each.
- `MKT_WAIT` (waiting colours per package), `MKT_HOURS` `[12,11,12,10,12]` (estimated hours per package).
- `S`, the state:
  - Navigation: `stack`, `task`.
  - `invite` (pending/yes/no), `eng` (awaiting/grace), `mkt` (package owners), `swapReq {fromPkg,toPkg,status: pending|yes|no|void}`.
  - UI state: `projTab`, `openPkgs`, `ev[taskId]` (file|gdoc), `rv[taskId]` ('reviewing'), `outcome` [DEMO], `myTasksTab`, `notifFilter`, `newTab`.
  - Setup: `aiProvider`, `noKey`, `team`, `choiceType`, `choices`, `method`, `plan`, `manual [{t,p}]`.
  - Preferences: `push`, `weekly`, `theme`.
- `PLAN_PICK` and `PLAN_AGILE`: workstreams `{t | key, tasks: [[name, pts, 'M/D']]}`, each totalling 100.
- Derived:
  - `earnedOf` = pts if done, pts/2 if half, else 0.
  - `pkgStarted` = any task in the package ≠ todo.
  - `myOpenTasks` = mine, status in OPEN, sorted.
  - Unread count.

### 6.2 Proposed entities (for the backend agent; names are suggestions)

**User**
- `id`, `displayName`, `avatarGlyph?` (or derived), `primaryEmail`, `locale (zh|en)`, `pushEnabled`, `weeklySummaryEnabled`, `theme?` (**[Q]** device vs account).

**AuthAccount**
- `userId`, `provider (github|google)`, `providerUserId`, `email`, `emailVerified`, `githubLogin`, tokens (encrypted). Merges on the same verified email (REQ §8).

**Project**
- `id`, `code?` (display tag like `CS302`), `name`, `courseOrTeam?`, `groupLabel?` (`第 7 组`), `color`.
- `plannedTeamSize` (2–8?), `deadlineAt`, `githubRepo?` (`owner/name`, shown as `campus-market`).
- `aiProvider?`, `aiKeyEncrypted?`, `aiKeyHint?` (last 3 characters).
- `discordWebhook?` (+ display channel name `#mkt201-group`), `telegramChatId?`.
- `inviteCode` (`MKT-7Q4P`).
- `status (active | awaiting_confirmation | grace | deleted)`, `endedAt?`, `endReason (confirmed | auto)`, `deleteAt?`.

**ProjectMember**
- `projectId`, `userId`, `role (leader | member)`, `color` (**[Q]** per project or per user), `joinedAt`, `leftAt?`.

**Milestone**
- `projectId`, `key (M1 / S1)`, `name`, `dueAt`, `order`.

**Workstream** (**[Q]** persist or creation-only)
- `projectId`, `title`, `order`.

**Package**
- `projectId`, `index (1..n)`, `ownerMemberId?`, `waitingColor`, `pickedAt?`.
- Derived: `points`, `estimatedHours`, `started`.

**Task**
- `id`, `projectId`, `packageId?`, `assigneeMemberId?`.
  - REQ: after a re-split, started tasks stay with the original owner, so the assignee can differ from the package owner. Keep both.
- `title`, `description?`, `kind (code|doc|research|design|meet)`.
- `points` (Decimal; proportional rescaling makes non-integers possible, **[Q]** rounding).
- `estimatedHours?`, `dueAt`, `aiSuggestedDueAt?`, `milestoneId?`, `workstreamId?`.
- `status (todo | doing | reviewing | done | half | fail)`, with overdue **derived** from `dueAt < now && not done`.
- `completionMethod (ai | self | leader_override)`, `grade (EXCELLENT | PASS | HALF | FAIL)?`.
- `firstReviewPassed?` (for the 一次过 badge), `completedAt?`.
- `dueSoonNotifiedAt?`, `overdueNotifiedAt?` (REQ: each reminder sent once).

**Review**
- `taskId`, `requestedById`, `status (queued|running|done|error)`, `provider`.
- `internalScore` (**server-only**, never sent to the client), `grade`, `reasons[]`, `evidenceSnapshot`, `createdAt`.

**Override**
- `taskId`, `leaderMemberId`, `fromGrade`, `toGrade`, `createdAt`. Visible to all.

**Evidence**
- `taskId`, `type (file | gdoc)`.
- For files: `fileName`, `sizeBytes` (≤ 25MB), `mime`, `storagePath`.
- For Google Docs: `gdocFileId`, `title`, `editShares [{userId, pct}]`, `uploadedById`, `createdAt`.

**Commit**
- `projectId`, `sha`, `message`, `additions`, `deletions`, `committedAt`, `authorGithubLogin`, `authorMemberId?`.
- `taskId?`, `attribution (ai | manual | none)`, `counted: bool`, `notCountedReason?` (`太小，不算`).

**SwapRequest**
- `projectId`, `fromPackageId`, `toPackageId`, `requesterId`, `responderId`, `status (pending | accepted | declined | void)`, `createdAt`, `resolvedAt`.

**Invite**
- `projectId`, `inviterId`, target `email? | githubLogin? | userId?`, `status (pending | accepted | declined)`, `createdAt`.

**Notification**
- `userId`, `projectId?`, `type (due_soon | overdue | packages_ready | swap_request | swap_result | project_confirm_needed | project_deletion_scheduled | weekly_summary | review_result | badge_unlocked | invite …)`.
- `audience (group | only_you | only_leader)`, `payload json`, `createdAt`, `readAt?`, `actionState?`.

**PushSubscription**
- `userId`, `platform (fcm | webpush)`, token or endpoint + keys.

**ActivityEvent** (feed)
- `projectId`, `actorMemberId`, `type (task_completed | commits_attributed | overdue | swap_accepted | override | …)`, `payload`, `createdAt`.

**UserBadge**
- `userId`, `badgeKey`, `unlockedAt`, `projectCodeSnapshot`, `projectNameSnapshot?`. This survives project deletion.
- Progress is computed or stored separately.

**WeeklySummary** (optional log)
- `projectId`, `weekStart`, `pointsFrom`, `pointsTo`, `tasksCompleted`, `excellentCount`, `topMemberId`, `topMemberPoints`, `overdueCount`, `overdueMemberIds`.

**ProjectPlanDraft** (the wizard, before commit)
- `sourceType (upload | text | manual)`, `briefFiles[]`, `text`.
- `choiceQuestion {type: pick_n | method, n?, options [{key, name, reason, loadLevel, hours, recommended}], selected[]}`.
- `milestones[]`, `workstreams[{title, tasks[{title, points, dueAt, kind?, hours?}]}]`.

---

## 7. Demo-only parts that must NOT ship

1. The whole **map sidebar** (`aside.map`, "MeritAI 手机样稿", link groups, the note `虚线框是样稿专用的演示开关，正式 App 里不会出现。`). Also the mobile `页面` side-tab button (`.map-fab`) and its open/close logic.
2. The **phone mock**: `.stage` grid, `.phone` bezel/radius/shadow, fake `.statusbar` (`9:41`, signal/battery SVGs), `.home-bar`, and the tokens `--backdrop`, `--bezel` and `--phone-shadow`. Also the page `<title>MeritAI 手机样稿</title>` and the meta description.
3. Every **dashed `.proto` box**:
   - `原型 · 演示 AI 结果` (the 优秀/合格/拿一半/不通过 switch on the task screen)
   - `原型 · 换个例子` (the new4 type switch)
   - `原型 这里固定用 5 人的例子。` (pick)
   - `原型 这个例子只演示到这一步，后面接回 MKT201 的例子。` (new5)
4. **Scripted behaviour:**
   - Ahmad's automatic swap request after your first pick, and voiding it on the next switch.
   - `DEMO_REASONS` canned AI reasons, and the timeouts for review (1.8s) and analysis (3.6s).
   - `S.outcome`, fake commits, the fake file `{title}_v2.docx 1.8 MB`, the fake gdoc edit ratio, the sample brief file, and pre-filled field values.
   - The sample keys `AIzaSy••••3kQ` etc.
   - The `例子：CS 小组项目「宿舍报修系统」…` framing in new4.
   - Hard-coded numbers (`32 天`, `25 分`, `1 个过期`, `最近的明天截止`, `MKT-7Q4P`).
5. **Demo toasts** (§2.7 [DEMO] list), the club card's `选包页面和 MKT201 一样…`, and the `+` in resplit (`样稿里固定 5 个包`).
6. All sample people, projects and tasks.

---

## 8. Additional implementation notes for Expo (RN + web)

- `color-mix`: use the precomputed tables in §1.2, per theme.
- `backdrop-filter` blur on the appbar: use expo-blur (free) or an opaque fallback.
- Carousel scroll-snap: a horizontal FlatList with `snapToInterval` (card width + 14), 8% side insets, and dots tracked via `onScroll`.
- Scalloped band, ring and highlighter marker: react-native-svg or measured Views.
- Confetti: Reanimated/Skia, or 110 animated Views; respect reduced motion.
- Fonts: see §1.7 risks.
- Tabular numbers: `fontVariant`.
- The `text-wrap: balance` headings have no RN equivalent; accept normal wrapping.
- Hover styles are web-only. Pressed states on native: the button lip compresses.
- Safe areas: react-native-safe-area-context for the tab bar bottom inset (18 + inset), toast top (12 + inset) and sheet bottom (28 + inset).
- Web export for iPhone PWA: the prototype has no install ("添加到主屏幕") guidance or push-permission prompt UI. Both are needed (§9.3).

---

## 9. Conflicts with, and extensions beyond, REQUIREMENTS.md

### 9.1 Direct tensions (need a decision)

1. **拿一半 semantics.** REQ §5 defines 拿一半 as a grade (half credit). The prototype treats a half task as still **open**: it appears in to-dos with `可重交拿满`, can be resubmitted, and resubmitting drops the half points immediately.
   - REQ §4 says "AI 判断证据不够时任务不算完成" (only fail?).
   - **[Q]** Is half "done with half points" or "open"? Can it be resubmitted for full? Can the leader override half → full? The prototype only allows overriding 不通过.
2. **待选色.** REQ says one "待选色" (a single colour?). The prototype gives each unpicked package a different highlighter colour that can equal a member's colour.
3. **The leader cannot edit dates.** REQ §3 says "组长可以逐个修改" due dates. In the prototype, new5 dates are static, and after creation there is no edit UI. The pick hint `组长可以再改` promises it.
4. **Manual create/edit/delete.** REQ §3 says tasks can be created, edited and deleted by hand. After creation the prototype only has `加任务` (name + points); there is no edit, delete or move-single-task (REQ §3 "组长也可以移动单个任务").
5. **Who can invite.** REQ §8 says any member can invite. The prototype shows the invite code only in the leader's settings and in new6.
6. **Files without an AI key.** REQ §3/§9 say uploaded files cannot be reviewed without a key. The prototype has no path for completing doc/design/research tasks in that case. **[Q]** Self-mark? Leader approval?
7. **全勤 badge vs REQ §6.** REQ §6 removes the "几天没动静" rule for being annoying. The 全勤 badge `连续 4 周都有进展` still tracks activity (as a reward, not a warning). Confirm this is acceptable.
8. **Evidence visibility.** REQ §5 says all data is public to the group. The prototype hides a member's commits and uploaded evidence from others until reviewed, and never lets others open or download files.

### 9.2 In the prototype but not in REQUIREMENTS (confirm before building)

- Team size limited to **2–8** (stepper clamp). With only 6 colours, 7–8 people repeat colours.
- Re-split lets the leader choose the **number of packages**, with the rule `至少要和现在的成员人数一样多`.
- **Estimated hours** per option and per package (`约 12 小时`), and load levels (`中/高`).
- **Task kinds** (code/doc/research/design/meet) with emoji, and a mapping of kind → evidence type (code → commits, meet → self-mark, others → file/gdoc).
- **Milestones** (M1…/S1…) shown in the plan and the project hero, and **workstreams** grouping the plan.
- The **leaderboard/podium**, inline badges in the ranking, the **activity feed**, and the **12 badges** with rules (§4.10), including the negative `压哨王`.
- Commits marked `太小，不算` (AI filtering of trivial commits).
- Google Doc **edit-share percentages**.
- Swap-request **voiding** when the requester's target changes.
- The push toggle covers `换包请求`. Also a **per-user weekly summary toggle**, and in-app notifications for packages ready, swaps, AI results and badge unlocks. REQ §6 lists only due-soon, overdue, weekly and (§7) end-of-project reminders.
- A confirmation step for the AI's choice recommendation that requires **exactly N** selections.
- Confetti and toasts (cosmetic, fine).

### 9.3 Required by REQUIREMENTS but missing from the prototype (UI must be designed and approved, per the user's "UI first" rule)

- **Sign-in screen** (GitHub / Google), first-run onboarding, account-merge messaging, and sign-out confirmation.
- **Join by code/link** screen and the web invite-link landing page. The FAB option currently only toasts.
- A **"connect GitHub" prompt** for members when the project has a repo. The leader's **repo connect** flow (GitHub App/webhook).
- **Member management**: list, remove (leader), leave (member). Also invite by email or GitHub username after creation, in settings.
- **Task management after creation**: edit title/points/kind/date, delete, move a single task, edit milestones.
- Status of the swap-request **sender** (pending/cancel).
- **Contribution report PDF**: content, layout, preview, and download on Android and iOS PWA.
- **English** strings (REQ §10). Only Chinese exists.
- **iPhone PWA**: "添加到主屏幕" instructions and the notification permission prompt. **Android 13+** POST_NOTIFICATIONS prompt.
- **Discord/Telegram connect** flows (only a static chip and a demo button exist).
- **Project lifecycle** views for non-leaders: awaiting confirmation, auto-ended after 7 days, grace countdown, and what a deleted project looks like (badges remain).
- Choosing the project's **deadline** and **editing project details** after creation.
- **Loading, error, empty and offline states** everywhere: fetch failures, AI errors (bad key, quota, timeout), upload failures, >25MB, unsupported type, no commits yet, empty task/notification lists, a new project with no members.
- The path when the brief contains **no choice question**, or **several**.

### 9.4 Internal prototype bugs to fix in the real build

- `最近的明天截止`, `还剩 32 天`, `1 个过期`, `包内共 25 分` and the `/25` bar denominator are hard-coded.
- The overridden grade leaks as `组长判定通过` in the done-list meta (`AI：组长判定通过`) and in the project mini-task label. Show `通过`.
- The override by-line has no leader name when the viewer isn't the leader.
- The `AI 原本建议` hint shows even when the date is unchanged.
- The feed is not sorted by time.
- Points inputs contain the unit inside the value (`20 分`, `4 分`). Use numeric inputs with a unit suffix.
- The new1 deadline is a free-text field. Use a date-time picker.
- The home greeting marker colour isn't tied to the user's colour.
- `去看我的任务` opens only the first task of the package.
- The unread badge has no read-state model.
- The gear on the pick screen and the leader tools are not role-gated in markup (they appear because the sample user is the leader).

---

## 10. Open questions to relay to the user (Chinese)

1. 「拿一半」算完成还是未完成？能不能重交拿满？组长能不能把「拿一半」推翻成「通过」？重交期间原来的一半分还算不算？
2. 没填 AI key 的项目里，文档/设计/调研任务怎么算完成？（负责人自己标记？组长确认？）
3. 什么时候算「开工」（任务从待开始变成进行中）？第一个提交、第一次上传，还是要点一个「开始」按钮？这决定能不能换包和互换。
4. 成员颜色是每人一个全局颜色，还是每个项目分配？6 种颜色、最多 8 人时撞色怎么办？「待选色」是一种统一的颜色，还是像样稿那样每个包不同？
5. 小组人数范围 2–8、重新分包「至少和成员人数一样多」，这两条要保留吗？
6. 12 个徽章和解锁条件（含「压哨王」、「全勤」）是否都确认？「进展」「接手别人放下的任务」怎么定义？
7. 排行榜（颁奖台）、动态、每周最佳，这些是否都要做？
8. 组长在创建后怎么改任务（名称/分数/类型/截止日期）、删任务、移动单个任务、改里程碑？需要补 UI。
9. 需要补哪些新页面的 UI：登录、用邀请码加入、成员管理/退出、连接 GitHub 仓库、Discord/Telegram 连接、贡献报告 PDF、iPhone 添加到主屏幕引导、各种错误/空状态？
10. 电脑浏览器版用手机布局居中，还是另外设计宽屏布局？
11. 项目卡上的「课程代码」（如 MKT201）、「第 7 组」要不要单独的输入框？没有课程的团队显示什么标签（样稿写「社团」）？
12. 组员能不能看到别人还没审核的提交/文件，能不能下载别人的文件？
13. 其他组员（非组长）能不能看到邀请码去邀请人？
14. 哪些操作需要二次确认（结束项目、推翻 AI、重新分包、退出登录、退出新建流程）？
15. 字体：安卓 App 用系统自带的思源黑体（Noto Sans CJK）还是打包 Noto Sans SC（会让 APK 变大）？600 字重统一当 700 用可以吗？
16. 外观（深色/浅色）设置存在手机本地，还是跟账号走？每周小结的时间用谁的时区？
17. 英文版文案由谁来写/确认？推送和 Discord/Telegram 里的调侃文案要不要多几种（样稿里用了「他」）？
18. 新建流程第 3 步是真的在处理，「跳过动画」按钮还要不要？AI 失败（key 错误、额度用完）时显示什么？
