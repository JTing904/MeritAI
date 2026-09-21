// Response and request shapes shared by the server and the app.
// Dates are ISO 8601 strings. Contribution points are integers in TENTHS (125 = 12.5 分).
import type { Highlighter, Locale } from './constants';

// ─── Accounts (M1) ────────────────────────────────────────────────────────────

/** The signed-in user, as returned by GET /api/me. */
export type MeData = {
  id: string;
  name: string;
  email: string | null;
  githubUsername: string | null;
  /** Colour for the profile avatar outside projects. */
  color: Highlighter;
  /** Language for push notifications; the app keeps it in sync with the device choice. */
  locale: Locale;
  pushEnabled: boolean;
  weeklyEnabled: boolean;
};

export type MeUpdate = Partial<Pick<MeData, 'locale' | 'pushEnabled' | 'weeklyEnabled'>>;

/** Developer one-tap login: the seeded test people (only when dev login is enabled). */
export type DevPerson = { id: string; name: string; email: string | null; color: Highlighter };

export type LoginResult = { token: string; user: MeData };

// ─── Projects (M2) ────────────────────────────────────────────────────────────

export type ProjectStatus = 'DRAFT' | 'ACTIVE' | 'AWAITING_CONFIRM' | 'ENDED';
export type TaskKind = 'CODE' | 'DOC' | 'RESEARCH' | 'DESIGN' | 'MEETING';
export type TaskStatus = 'TODO' | 'DOING' | 'REVIEWING' | 'DONE' | 'HALF' | 'FAIL';
export type PlanSource = 'MANUAL' | 'RULES' | 'MODEL' | 'AI';
export type MemberRole = 'LEADER' | 'MEMBER';

/** Step 1 of the wizard: POST /api/projects (creates a DRAFT) and PATCH /api/projects/:id. */
export type ProjectBasicsInput = {
  name: string;
  shortCode?: string | null;
  courseName?: string | null;
  groupLabel?: string | null;
  /** ISO date-time, must be in the future. */
  deadline: string;
  /** IANA time zone, e.g. "Asia/Kuala_Lumpur". */
  timezone: string;
  /** 2–8, including the leader. */
  teamSize: number;
  leaderManages: boolean;
  /** "owner/name"; optional (M8 connects it). */
  repoFullName?: string | null;
};

export type ProjectBasics = Required<ProjectBasicsInput> & {
  id: string;
  color: Highlighter;
  status: ProjectStatus;
  /** Wizard step a draft was left on (1–6). */
  draftStep: number;
  locale: Locale;
  planSource: PlanSource | null;
  /** Draft: packages it will have, teamSize − (leaderManages ? 1 : 0). Confirmed: the real number of packages (M3). */
  packageCount: number;
};

export type FeatureView = { id: string; name: string; order: number };
export type MilestoneView = { id: string; label: string; name: string; dueAt: string; order: number };

export type TaskView = {
  id: string;
  number: number;
  title: string;
  description: string | null;
  kind: TaskKind;
  /** Tenths of a point. */
  points: number;
  /** Null → the project deadline applies. */
  dueAt: string | null;
  suggestedDueAt: string | null;
  featureId: string | null;
  milestoneId: string | null;
  packageId: string | null;
  ownerMemberId: string | null;
  status: TaskStatus;
  order: number;
  startedAt: string | null;
  /**
   * Who started it (M3). A package counts as started when its owner started one of its tasks or holds
   * a finished one (whoever started that); an unfinished task someone else started doesn't count.
   */
  startedByMemberId: string | null;
  /** Started or past TODO: can't be deleted, re-pointed by hand, or moved by a re-split. */
  locked: boolean;
  /** Not finished and past its due date (or the project deadline when it has none). */
  overdue: boolean;
  /** Tenths, from `grade` (M4): EXCELLENT / PASS / SELF → points, HALF → half (rounded), else 0. */
  earnedPoints: number;
  /** The counting attempt's grade (M4); a HALF task under re-review keeps it (and stays finished). */
  grade: Grade | null;
  /** When the counting grade was earned; null while not finished. */
  finishedAt: string | null;
  /** The latest attempt (any status) was handed in after the effective due. */
  late: boolean;
  /** 前置任务: the task this one waits for. */
  prereqTaskId: string | null;
  /** Attempts with at least one piece of evidence, or GRADED. */
  attemptCount: number;
  /** Evidence in the current (DRAFT / PENDING) attempt; 0 without one. */
  evidenceCount: number;
  /** Any evidence row of the task, in any attempt. */
  hasEvidence: boolean;
  /** 作业要求（原文）: the brief item's lines, markers stripped (null for typed / added tasks). Only TaskDetail.task
   *  carries it: in ProjectView / DraftView task lists it is always null (the server leaves it out, A12). */
  briefExcerpt: string | null;
  /** A part made by 「把大任务拆开」. */
  briefSplit: boolean;
};

/**
 * How the packages would come out if the plan were confirmed now (points rescaled to 1000 first,
 * feature groups kept together, as 「分成 N 个任务包」 does). Tenths.
 */
export type BalanceView = {
  /** Points of each package, in package order. */
  packagePoints: number[];
  /** Heaviest minus lightest package. */
  spread: number;
  /** Packages with no task at all. */
  emptyPackages: number;
  /** Within 2.0 分 (spread ≤ 20) and no empty package. */
  balanced: boolean;
};

/** A task whose due date moved because the project deadline changed. */
export type AdjustedTask = { id: string; title: string; dueAt: string };

/** Everything the wizard needs for a draft (steps 2–5). GET /api/projects/:id/draft */
export type DraftView = {
  basics: ProjectBasics;
  briefFileName: string | null;
  hasBriefText: boolean;
  tasks: TaskView[];
  features: FeatureView[];
  milestones: MilestoneView[];
  /** Sum of task points in tenths (may differ from 1000 until the plan is confirmed). */
  totalPoints: number;
  /** Step 5 checks it before confirming; POST /api/projects/:id/split-large splits the big tasks. */
  balance: BalanceView;
  /** Only in the response of a PATCH that changed the deadline: the tasks whose due date moved. */
  adjustedTasks?: AdjustedTask[];
};

/** Task create/update in a draft or (leader) in an active project. Points in tenths. */
export type TaskInput = {
  title: string;
  kind: TaskKind;
  points: number;
  dueAt?: string | null;
  description?: string | null;
  featureId?: string | null;
  milestoneId?: string | null;
};

/** Manual mode (step 2): replace all draft tasks at once. PUT /api/projects/:id/tasks */
export type ManualPlanInput = { tasks: TaskInput[] };

/** Step 2 typed description: POST /api/projects/:id/brief with JSON { text }. File uploads use multipart field "file". */
export type BriefTextInput = { text: string };

/**
 * Step 5 「把大任务拆开」: POST /api/projects/:id/split-large, JSON body optional. `locale` = the language
 * the app shows now, for the part labels (default: the user's saved language).
 */
export type SplitLargeInput = { locale?: Locale };

/** Why a brief could not be turned into tasks (not an error: the app shows a choice screen). */
export type BriefFailure =
  /** A photo or scanned PDF: the free rules can't read images. */
  | 'UNREADABLE'
  /** Plain paragraphs with no scores and no list: the free rules can't split it. */
  | 'NO_STRUCTURE'
  | 'UNSUPPORTED_TYPE'
  | 'TOO_LARGE'
  | 'EMPTY';

export type BriefResult =
  | {
      ok: true;
      source: PlanSource;
      /** SCORES: found "40% / 占 40 分 / 40 marks" items. LIST: numbered/bulleted items split equally. */
      method: 'SCORES' | 'LIST';
      /** Number of scored or listed items found. */
      found: number;
      draft: DraftView;
    }
  | { ok: false; reason: BriefFailure; fileName: string | null; sizeBytes: number | null; maxBytes: number };

export type MemberView = {
  id: string;
  userId: string;
  name: string;
  color: Highlighter;
  role: MemberRole;
  /** False after leaving or being removed (their history stays visible). */
  active: boolean;
  packageId: string | null;
  joinedAt: string;
  leftAt: string | null;
  removed: boolean;
  /** Tenths, from finished tasks they own (kept after leaving). */
  earnedPoints: number;
  /** Active, no package, and not a leader who only manages. */
  needsPackage: boolean;
  /** Tasks they own that aren't finished. */
  unfinishedCount: number;
};

export type PackageView = {
  id: string;
  index: number;
  /** Feature names of the package's tasks, e.g. "注册与登录" (null when the tasks have no features). */
  title: string | null;
  /** Tenths. */
  points: number;
  ownerMemberId: string | null;
  taskIds: string[];
  /** Its owner started one of its tasks or finished one (whoever started it): no more switching or swapping. */
  started: boolean;
  /** Tenths. */
  earnedPoints: number;
  overdueCount: number;
  /** Sum of the tasks' estimates, when any task has one. */
  estimateHours: number | null;
};

/** A pending swap request (not expired) where the viewer is the requester or the target. */
export type SwapView = {
  id: string;
  requesterMemberId: string;
  targetMemberId: string;
  requesterPackageId: string;
  targetPackageId: string;
  createdAt: string;
  expiresAt: string;
};

/**
 * Where a confirmed project is in its life (M5). Same shape on ProjectView, ProjectCard and
 * TaskDetail.project. Dates are ISO; the app counts 「还有 N 天」 from its own clock.
 *
 * - ACTIVE: every date below is null.
 * - AWAITING_CONFIRM: the deadline passed (`awaitingSince` = that deadline). Everything still works (except
 *   joining and invites, as before); the leader can 结束项目 or push the deadline later (PATCH
 *   /projects/:id with a deadline after now, which puts it back to ACTIVE). `autoEndAt` = deadline + 7
 *   days: the tick ends it then (`endedAuto`).
 * - ENDED: read-only (every write → 409 PROJECT_ENDED except grading a PENDING attempt, leaving,
 *   reopening and 为所有人删除项目). `purgeAfter` = endedAt + 14 days: deleted for good then; the leader
 *   can reopen it until then (POST /projects/:id/reopen).
 * - DRAFT: all null.
 */
export type ProjectLifecycle = {
  status: ProjectStatus;
  awaitingSince: string | null;
  autoEndAt: string | null;
  endedAt: string | null;
  /** Ended by the tick (7 days after the deadline without the leader acting). */
  endedAuto: boolean;
  /** The leader who pressed 结束项目 (null when it ended automatically or the member row is gone). */
  endedBy: PersonRef | null;
  /** ENDED only: when it is deleted for good. */
  purgeAfter: string | null;
};

// POST /api/projects/:id/end (结束项目; leader; ACTIVE or AWAITING_CONFIRM; no body) answers with the
// ProjectView. Pending swaps end as VOID (PROJECT_ENDED); everyone else gets PROJECT_ENDED.

/**
 * POST /api/projects/:id/reopen (leader; ENDED, before purgeAfter). `deadline` ("YYYY-MM-DD" = 23:59 that
 * day in the project zone, or an ISO date-time) is required when the current deadline has passed
 * (DEADLINE_REQUIRED) and must be after now (DEADLINE_IN_PAST); when the old deadline is still ahead it
 * is optional. A new deadline moves the task due dates as PATCH /projects/:id does (the answer's
 * adjustedTasks). Answers with the ProjectView.
 */
export type ReopenInput = { deadline?: string };

/**
 * POST /api/projects/:id/tasks/:taskId/delay (一键延后; leader; task unfinished, else TASK_FINISHED).
 * `dueAt`: "YYYY-MM-DD" or ISO; not after the project deadline (DUE_AFTER_DEADLINE), later than the
 * current effective due (DELAY_NOT_LATER). It becomes the leader's date (as a leader due-date edit). The
 * owner gets TASK_DELAYED. Answers with the TaskDetail.
 */
export type DelayInput = { dueAt: string };

/** A project as members see it. GET /api/projects/:id (M3 extends it with the project page). */
export type ProjectView = {
  basics: ProjectBasics;
  /** M5: status and lifecycle dates (see ProjectLifecycle); lifecycle.status = basics.status. */
  lifecycle: ProjectLifecycle;
  inviteCode: string | null;
  viewerMemberId: string;
  viewerRole: MemberRole;
  members: MemberView[];
  packages: PackageView[];
  tasks: TaskView[];
  features: FeatureView[];
  milestones: MilestoneView[];
  /** Only in the response of a PATCH that changed the deadline: the tasks whose due date moved. */
  adjustedTasks?: AdjustedTask[];
  /** Tenths earned by the whole team. */
  earnedPoints: number;
  /** Sent back with POST /resplit so a stale preview is refused (STALE_PREVIEW). */
  packagesVersion: number;
  viewerNeedsPackage: boolean;
  /** Where 「加任务」 would put a new task (smallest total; lowest number on a tie). */
  lightestPackageId: string | null;
  /** Package counts a re-split accepts. */
  resplitRange: { min: number; max: number };
  swaps: SwapView[];
  /** Leader: the project's PENDING attempts, oldest submitted first (待我审核). Everyone else: []. */
  pendingReviews: PendingReview[];
  /** The project keeps the brief's text (GET /projects/:id/brief works). */
  briefAvailable: boolean;
  /** The uploaded brief's file name (null when typed or none). */
  briefFileName: string | null;
};

/** Home screen project card. */
export type ProjectCard = {
  id: string;
  name: string;
  shortCode: string | null;
  courseName: string | null;
  groupLabel: string | null;
  color: Highlighter;
  status: ProjectStatus;
  draftStep: number;
  role: MemberRole;
  leaderName: string;
  /** Active members. */
  memberCount: number;
  teamSize: number;
  /** As ProjectBasics.packageCount: planned for a draft, the real number once confirmed (M3). */
  packageCount: number;
  /** Packages nobody picked yet. */
  freePackages: number;
  /** My package number, if I picked one. */
  myPackageIndex: number | null;
  /** Points earned by the team so far, tenths (M4 fills this in; 0 before). */
  earnedPoints: number;
  deadline: string;
  members: { name: string; color: Highlighter }[];
  updatedAt: string;
  /** I'm active, have no package and am not a leader who only manages. */
  needsPackage: boolean;
  /**
   * M5 chips: AWAITING_CONFIRM → 「📮 等你确认已交」 (leader) / 「📮 等组长确认」 (member); ENDED →
   * 「🏁 已结束」 / 「🏁 自动结束」 (endedAuto) with 「{purgeAfter} 删除 · 还有 {n} 天」.
   */
  lifecycle: ProjectLifecycle;
};

export type PendingInvite = {
  id: string;
  projectId: string;
  projectName: string;
  courseName: string | null;
  inviterName: string;
  memberCount: number;
  teamSize: number;
};

/** GET /api/home */
export type HomeData = {
  projects: ProjectCard[];
  invites: PendingInvite[];
  /**
   * Effective due (ISO) of my TODO / DOING / FAIL tasks in ACTIVE / AWAITING_CONFIRM projects that are overdue or due
   * within the next 8 days (past dates included, so the home line can count 过期).
   */
  dueSoon: string[];
  /** Projects I deleted for everyone and can still restore (only the leader who deleted them sees these). */
  deletedProjects: DeletedProjectCard[];
};

/** A home card for a project the viewer deleted for everyone (为所有人删除项目). */
export type DeletedProjectCard = {
  id: string;
  name: string;
  shortCode: string | null;
  color: Highlighter;
  deletedAt: string;
  /** Deleted for good from then on (deletedAt + 7 days); restorable until then. */
  purgeAfter: string;
};

/** POST /api/projects/:id/leave-as-leader: hand the role to this active member, then leave. */
export type LeaveAsLeaderInput = { newLeaderMemberId: string };
/** POST /api/projects/:id/delete: `confirm` is the project tag, typed (case and spaces ignored). */
export type DeleteProjectInput = { confirm: string };

/** GET /api/join/:code (preview before joining). */
export type JoinPreview = {
  projectId: string;
  name: string;
  shortCode: string | null;
  courseName: string | null;
  groupLabel: string | null;
  color: Highlighter;
  leaderName: string;
  memberCount: number;
  teamSize: number;
  freePackages: number;
  members: { name: string; color: Highlighter }[];
  /** The viewer is already an active member: the app opens the project instead. */
  alreadyMember: boolean;
  /** 8 active members already (false when alreadyMember). */
  full: boolean;
};

/** POST /api/projects/:id/invites: emails and GitHub usernames, separated by commas, spaces or new lines. */
export type InviteInput = { targets: string };
export type InviteOutcome = { target: string; result: 'INVITED' | 'ALREADY_MEMBER' | 'ALREADY_INVITED' | 'INVALID' };

// ─── Packages, swaps, members, notifications (M3) ─────────────────────────────

export type SwapStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED' | 'VOID';
export type SwapVoidReason =
  | 'SWITCHED'
  | 'STARTED'
  | 'SWAPPED_ELSEWHERE'
  | 'LEFT'
  | 'RESPLIT'
  | 'PROJECT_DELETED'
  /** M5: the project ended (PROJECT_ENDED tells everyone). */
  | 'PROJECT_ENDED';
/** The reasons a SWAP_VOID notification can give (a re-split, a deleted or an ended project sends its own notice). */
export type SwapVoidNoticeReason = Exclude<SwapVoidReason, 'RESPLIT' | 'PROJECT_DELETED' | 'PROJECT_ENDED'>;

/** POST /api/projects/:id/packages/:packageId/assign */
export type AssignInput = { memberId: string };
/** POST /api/projects/:id/swaps: ask the owner of this package to swap. */
export type SwapRequestInput = { packageId: string };
/** POST /api/projects/:id/tasks/:taskId/move */
export type MoveTaskInput = { packageId: string };
/** POST /api/projects/:id/resplit/preview */
export type ResplitPreviewInput = { count: number };
/** POST /api/projects/:id/resplit: `version` from the preview. */
export type ResplitInput = { count: number; version: number };
/** POST /api/dev/tasks/:taskId/status (development only). */
export type DevTaskStatusInput = { status: 'TODO' | 'DOING' | 'DONE' | 'HALF' };

/** One package before and after a re-split. New package: packageId/oldIndex/before null; removed: index/after null. */
export type ResplitRow = {
  packageId: string | null;
  oldIndex: number | null;
  index: number | null;
  ownerMemberId: string | null;
  /** Tenths. */
  before: number | null;
  after: number | null;
};

/** POST /api/projects/:id/resplit/preview */
export type ResplitPreview = {
  version: number;
  count: number;
  range: { min: number; max: number };
  rows: ResplitRow[];
  /** Tasks that stay where they are (started or past TODO). */
  lockedTasks: { id: string; title: string; ownerMemberId: string | null }[];
};

/** A person as a payload snapshots them; the app says 「你」 when memberId is the viewer's. */
export type PersonRef = { memberId: string; name: string };

export type NotificationType =
  | 'SWAP_REQUEST'
  | 'SWAP_ACCEPTED'
  | 'SWAP_DECLINED'
  | 'SWAP_EXPIRED'
  | 'SWAP_VOID'
  | 'MEMBER_NEEDS_PACKAGE'
  | 'MEMBER_LEFT'
  | 'MEMBER_REMOVED'
  | 'REMOVED_YOU'
  | 'TASK_ADDED'
  | 'TASK_MOVED_IN'
  | 'TASK_MOVED_OUT'
  | 'RESPLIT'
  | 'PACKAGE_ASSIGNED'
  | 'LEADER_TRANSFERRED'
  | 'SUBMITTED'
  | 'GRADED'
  | 'GRADED_OUTSIDE'
  | 'OVERRIDDEN'
  | 'WAITING_ON_YOU'
  | 'PREREQ_DONE'
  | 'PROJECT_DELETED'
  | 'PROJECT_RESTORED'
  // M5 (reminders from the tick, and the lifecycle)
  | 'TASK_DUE_SOON'
  | 'TASK_DUE_REVIEW'
  | 'TASK_OWNERLESS_SOON'
  | 'TASK_OVERDUE'
  | 'TASK_OWNERLESS_OVERDUE'
  | 'PREREQ_BLOCKED'
  | 'WEEKLY_SUMMARY'
  | 'PROJECT_DUE'
  | 'PROJECT_AUTO_END_SOON'
  | 'PROJECT_ENDED'
  | 'PROJECT_REOPENED'
  | 'PROJECT_DELETE_SOON'
  | 'TASK_DELAYED';

/** 全组都收到 / 只有你收到 / 只有组长收到 / 只有你和组长收到. */
export type NotificationAudience = 'GROUP' | 'ONLY_YOU' | 'ONLY_LEADER' | 'YOU_AND_LEADER';

/**
 * What a notification says, by type. Names, titles, package numbers and points are snapshotted when
 * it is sent; the project tag in the text comes live from NotificationView.projectTag. Points in tenths.
 */
export type NotificationPayload =
  /** To the target. Its state (pending / accepted / …) comes from NotificationView.swap. */
  | { type: 'SWAP_REQUEST'; requester: PersonRef; requesterPackageIndex: number; targetPackageIndex: number }
  | { type: 'SWAP_ACCEPTED'; target: PersonRef; targetPackageIndex: number }
  | { type: 'SWAP_DECLINED'; target: PersonRef }
  | { type: 'SWAP_EXPIRED'; target: PersonRef }
  /** A re-split or a deleted project never sends this (their own notifications cover it). */
  | { type: 'SWAP_VOID'; target: PersonRef; reason: SwapVoidNoticeReason }
  /** To the leader. `joined`: the member just joined (「加入了 {tag}，但任务包都有人选了」). */
  | { type: 'MEMBER_NEEDS_PACKAGE'; member: PersonRef; joined: boolean }
  | { type: 'MEMBER_LEFT'; member: PersonRef; unfinishedCount: number }
  | { type: 'MEMBER_REMOVED'; member: PersonRef; unfinishedCount: number }
  | { type: 'REMOVED_YOU' }
  /** `packagePoints`: the receiving package's total after the rescale. */
  | { type: 'TASK_ADDED'; taskId: string; title: string; packageIndex: number; packagePoints: number }
  /**
   * `from` null: it came from a package nobody picked (or from someone who left). `fromPackageIndex`
   * null: a leaver's released task, in no package. `hasEvidence`: any attempt of the task has evidence.
   */
  | {
      type: 'TASK_MOVED_IN';
      taskId: string;
      title: string;
      from: PersonRef | null;
      fromPackageIndex: number | null;
      toPackageIndex: number;
      hasEvidence: boolean;
    }
  /**
   * `to` null: it went to a package nobody picked. `fromPackageIndex` null: it was in no package (a
   * submission that stayed with its owner when they switched or swapped, then graded 不通过).
   */
  | {
      type: 'TASK_MOVED_OUT';
      taskId: string;
      title: string;
      fromPackageIndex: number | null;
      to: PersonRef | null;
      toPackageIndex: number;
    }
  /**
   * `package`: the recipient's package after the re-split (`oldIndex` only when its number changed),
   * or null without one; then `freePackages` says how many are left to pick.
   */
  | {
      type: 'RESPLIT';
      package: { index: number; oldIndex: number | null; points: number } | null;
      freePackages: number;
      packageCount: number;
    }
  | { type: 'PACKAGE_ASSIGNED'; packageIndex: number }
  /** `leftAfter`: the old leader left the project right after handing the role over (leave-as-leader). */
  | { type: 'LEADER_TRANSFERRED'; from: PersonRef; leftAfter?: boolean }
  // M4. points / earned in tenths; `earned` = the TASK's earned points after the write (its counting grade).
  /** To the leader. `allFiles`: every piece is a file (「{n} 份文件」, else 「{n} 份证据」). `dueAt`: effective due. */
  | {
      type: 'SUBMITTED';
      taskId: string;
      title: string;
      submitter: PersonRef;
      attemptNo: number;
      evidenceCount: number;
      allFiles: boolean;
      dueAt: string;
      late: boolean;
    }
  /** To the owner. `counting` false: a worse re-grade; the task still earns `earned` from an earlier attempt. */
  | {
      type: 'GRADED';
      taskId: string;
      title: string;
      attemptNo: number;
      grade: Exclude<Grade, 'SELF'>;
      points: number;
      earned: number;
      counting: boolean;
    }
  | {
      type: 'GRADED_OUTSIDE';
      taskId: string;
      title: string;
      grade: Exclude<Grade, 'SELF'>;
      points: number;
      earned: number;
      counting: boolean;
      outsideNote: string | null;
    }
  /** `undone`: 撤销上次推翻 (`toGrade` is the grade it went back to). */
  | {
      type: 'OVERRIDDEN';
      taskId: string;
      title: string;
      attemptNo: number;
      fromGrade: Grade;
      toGrade: Grade;
      points: number;
      earned: number;
      counting: boolean;
      undone: boolean;
    }
  /** To the prereq's owner and the leader. `forLeader`: this copy is the leader's. */
  | {
      type: 'WAITING_ON_YOU';
      waitingTaskId: string;
      waitingTitle: string;
      prereqTaskId: string;
      prereqTitle: string;
      waiter: PersonRef;
      prereqOwner: PersonRef | null;
      setBy: PersonRef;
      forLeader: boolean;
    }
  /** To the owner of each task that waited for the prereq. */
  | { type: 'PREREQ_DONE'; prereqTaskId: string; prereqTitle: string; waitingTaskId: string; waitingTitle: string }
  /** To every active member but the leader. `purgeAfter`: when it is deleted for good unless restored. */
  | { type: 'PROJECT_DELETED'; leader: PersonRef; purgeAfter: string }
  | { type: 'PROJECT_RESTORED'; leader: PersonRef }
  // ─── M5 ───
  // Reminders are sent by the tick (services/tick.ts), each once (a later or earlier due date, or another
  // owner, sends it again). Due dates are the task's EFFECTIVE due (its own, else the project deadline),
  // ISO. 「明天 23:59 / 今天 18:00」: render `dueAt` relative to NotificationView.createdAt; `timezone` is
  // the project's (use it or the device zone, as the rest of the app does). All in-app only for now.
  /** To the owner (ONLY_YOU): due within 24 h (at least 1 h left), not handed in. 「打开任务」. */
  | { type: 'TASK_DUE_SOON'; taskId: string; title: string; dueAt: string; timezone: string }
  /**
   * To the leader (ONLY_LEADER): due within 24 h, handed in, waiting for the grade (never for the leader's
   * own task). `owner`: who owns it. 「去评级」.
   */
  | { type: 'TASK_DUE_REVIEW'; taskId: string; title: string; dueAt: string; timezone: string; owner: PersonRef | null }
  /** To the leader (ONLY_LEADER): due within 24 h and nobody (active) owns it. 「移给谁」 (task page, move sheet). */
  | { type: 'TASK_OWNERLESS_SOON'; taskId: string; title: string; dueAt: string; timezone: string }
  /**
   * To every active member (GROUP; the owner's copy has mine: true): past due, unfinished, not handed in.
   * `template` 0-4 picks the roast line (stable per task; the emoji is part of the line; name or TA only):
   *  0 「🐢 {name} 的『{task}』过期了，TA 可能还在路上…」
   *  1 「⏰『{task}』的截止时间过了，{name} 还没交。大家帮 TA 加加油？」
   *  2 「🫠 大家等『{task}』等到过期了，{name} 快冲！」
   *  3 「📣 过期提醒：{name} 的『{task}』还差最后一步。」
   *  4 「🧃『{task}』过期了，{name} 要不要先喝口水，再一口气交掉？」
   * `waitingFor`: the task waits for an unfinished prerequisite → append 「（TA 在等 {owner} 的『{title}』）」.
   * Buttons: 打开任务, 发到 WhatsApp.
   */
  | {
      type: 'TASK_OVERDUE';
      taskId: string;
      title: string;
      dueAt: string;
      owner: PersonRef;
      template: number;
      waitingFor: { taskId: string; title: string; owner: PersonRef | null } | null;
    }
  /** To every active member (GROUP; mine: true for the leader): past due and nobody owns it. 「发到 WhatsApp」. */
  | { type: 'TASK_OWNERLESS_OVERDUE'; taskId: string; title: string; dueAt: string }
  /**
   * To the leader (ONLY_LEADER): 「『{waitingTitle}』被『{prereqTitle}』卡了 {blockedDays} 天，要不要延后？」 —
   * the prerequisite is unfinished 3+ days past its due while the waiting task is unfinished too.
   * 「一键延后」 opens the DelaySheet for waitingTaskId (default waitingDueAt + blockedDays days, chips +1 /
   * +blockedDays / +7, never past projectDeadline); 「看任务」 opens waitingTaskId.
   */
  | {
      type: 'PREREQ_BLOCKED';
      waitingTaskId: string;
      waitingTitle: string;
      waitingOwner: PersonRef | null;
      waitingDueAt: string;
      prereqTaskId: string;
      prereqTitle: string;
      prereqOwner: PersonRef | null;
      prereqDueAt: string;
      blockedDays: number;
      projectDeadline: string;
    }
  /**
   * To each active member with weeklyEnabled (GROUP, mine: false), Sunday 20:00 in the project zone (the
   * first tick after it that Sunday), also in a week without progress; ACTIVE and AWAITING_CONFIRM only.
   * Counts over the 7 days before the tick. `weekEnding`: that Sunday, YYYY-MM-DD in the project zone.
   * Points in tenths. 「{tag} 这周：完成 {finishedCount} 个任务（+{finishedPoints} 分），全组 {totalPoints} / 100
   * 分；过期 {overdueCount} 个；下周要交 {dueNextWeekCount} 个。{top.member} 这周最多（+{top.points} 分）。」 Leave out
   * the parts that are zero, except the total; `top` null → leave that sentence out. 「发到 WhatsApp」.
   * overdueCount: unfinished tasks overdue now; dueNextWeekCount: not-handed-in tasks due in the next 7 days.
   */
  | {
      type: 'WEEKLY_SUMMARY';
      weekEnding: string;
      finishedCount: number;
      finishedPoints: number;
      totalPoints: number;
      overdueCount: number;
      dueNextWeekCount: number;
      top: { member: PersonRef; points: number } | null;
    }
  /** To the leader (ONLY_LEADER): the deadline passed, the project is AWAITING_CONFIRM now. 「结束项目」 (EndSheet). */
  | { type: 'PROJECT_DUE'; deadline: string; autoEndAt: string }
  /** To the leader (ONLY_LEADER): it ends by itself at autoEndAt (「明天」). 「结束项目」. */
  | { type: 'PROJECT_AUTO_END_SOON'; deadline: string; autoEndAt: string }
  /**
   * `auto` false: to everyone but the leader, 「组长 {leader} 结束了 {tag}。{purgeAfter} 会彻底删除…」;
   * `auto` true (leader null): to every active member, 「组长 7 天没处理，{tag} 自动结束了…」. 「看项目」.
   */
  | { type: 'PROJECT_ENDED'; auto: boolean; leader: PersonRef | null; purgeAfter: string }
  /** To everyone but the leader: 「组长 {leader} 重新打开了 {tag}，新的截止日期 {deadline}。」 */
  | { type: 'PROJECT_REOPENED'; leader: PersonRef; deadline: string }
  /** To every active member (GROUP), 3 days and 1 day before an ENDED project is deleted: `days` 3 or 1. */
  | { type: 'PROJECT_DELETE_SOON'; days: number; purgeAfter: string }
  /**
   * To the owner (ONLY_YOU; not when the leader delays their own task): 「组长把你的『{title}』延后到
   * {dueAt}」 + 「（在等『{prereq.title}』）」 when the task waits for an unfinished prerequisite.
   */
  | {
      type: 'TASK_DELAYED';
      taskId: string;
      title: string;
      dueAt: string;
      fromDueAt: string;
      prereq: { taskId: string; title: string } | null;
    };

export type NotificationView = {
  id: string;
  type: NotificationType;
  projectId: string | null;
  /** Live from the project (null without one). */
  projectTag: string | null;
  projectColor: Highlighter | null;
  /** Null → no audience label in the meta line. */
  audience: NotificationAudience | null;
  /** Shown under 「跟我有关」. */
  mine: boolean;
  createdAt: string;
  read: boolean;
  payload: NotificationPayload;
  /** The swap it is about, as it is now (a pending one past its expiry reads EXPIRED); null without one. */
  swap: { id: string; status: SwapStatus; voidReason: SwapVoidReason | null; voidedByRequester: boolean } | null;
  /** The viewer can open the project (still an active member). */
  projectOpen: boolean;
};

/** GET /api/notifications?cursor=&limit=&mine=1 (newest first). */
export type NotificationPage = { items: NotificationView[]; nextCursor: string | null; unreadCount: number };

/** POST /api/notifications/read: marks this item and everything older as read. */
export type MarkReadInput = { upToId: string };
/** GET /api/notifications/unread-count and POST /api/notifications/read (the unread left). */
export type UnreadCount = { count: number };

export type ActivityType =
  | 'PLAN_CONFIRMED'
  | 'JOINED'
  | 'LEFT'
  | 'REMOVED'
  | 'PICKED'
  | 'SWITCHED'
  | 'SWAPPED'
  | 'ASSIGNED'
  | 'TASK_ADDED'
  | 'TASK_MOVED'
  | 'TASK_STARTED'
  | 'RESPLIT'
  | 'LEADER_TRANSFERRED'
  | 'SUBMITTED'
  | 'WITHDRAWN'
  | 'GRADED'
  | 'OVERRIDDEN'
  | 'MEETING_DONE'
  | 'START_UNDONE'
  | 'PREREQ_SET'
  | 'PROJECT_DELETED'
  | 'PROJECT_RESTORED'
  | 'PROJECT_ENDED'
  | 'PROJECT_REOPENED'
  | 'TASK_DELAYED';

/** What a feed entry says, by type (who did it is ActivityView.actor). Snapshotted when it happened. */
export type ActivityPayload =
  | { type: 'PLAN_CONFIRMED'; packageCount: number }
  | { type: 'JOINED' }
  | { type: 'LEFT' }
  | { type: 'REMOVED'; member: PersonRef }
  | { type: 'PICKED'; packageIndex: number }
  | { type: 'SWITCHED'; fromPackageIndex: number; toPackageIndex: number }
  /** The actor (the target) accepted `requester`'s request. */
  | { type: 'SWAPPED'; requester: PersonRef; requesterPackageIndex: number; targetPackageIndex: number }
  | { type: 'ASSIGNED'; packageIndex: number; member: PersonRef }
  | { type: 'TASK_ADDED'; taskId: string; title: string; packageIndex: number }
  /** `fromPackageIndex` null: a leaver's released task, in no package. */
  | { type: 'TASK_MOVED'; taskId: string; title: string; fromPackageIndex: number | null; toPackageIndex: number }
  | { type: 'TASK_STARTED'; taskId: string; title: string }
  | { type: 'RESPLIT'; packageCount: number }
  /** `member`: the new leader. */
  | { type: 'LEADER_TRANSFERRED'; member: PersonRef }
  | { type: 'SUBMITTED'; taskId: string; title: string; attemptNo: number }
  | { type: 'WITHDRAWN'; taskId: string; title: string; attemptNo: number }
  | {
      type: 'GRADED';
      taskId: string;
      title: string;
      owner: PersonRef | null;
      grade: Grade;
      attemptNo: number;
      selfGraded: boolean;
      outsideApp: boolean;
    }
  | {
      type: 'OVERRIDDEN';
      taskId: string;
      title: string;
      owner: PersonRef | null;
      attemptNo: number;
      fromGrade: Grade;
      toGrade: Grade;
      undone: boolean;
    }
  /** `attendeeCount`: the owner included. */
  | { type: 'MEETING_DONE'; taskId: string; title: string; attendeeCount: number }
  | { type: 'START_UNDONE'; taskId: string; title: string }
  /** `cleared`: the prerequisite was removed (the prereq fields are null then). */
  | {
      type: 'PREREQ_SET';
      taskId: string;
      title: string;
      prereqTaskId: string | null;
      prereqTitle: string | null;
      prereqOwner: PersonRef | null;
      cleared: boolean;
    }
  /** The actor (the leader) deleted the project for everyone / restored it (seen once it is back). */
  | { type: 'PROJECT_DELETED' }
  | { type: 'PROJECT_RESTORED' }
  /** M5. `auto`: ended by the tick (actor null); otherwise the actor is the leader who ended it. */
  | { type: 'PROJECT_ENDED'; auto: boolean }
  /** The actor (the leader) reopened it; `deadline` as it is after reopening. */
  | { type: 'PROJECT_REOPENED'; deadline: string }
  /** The actor (the leader) moved the task's due date later (一键延后). */
  | { type: 'TASK_DELAYED'; taskId: string; title: string; dueAt: string; fromDueAt: string };

export type ActivityView = {
  id: string;
  type: ActivityType;
  createdAt: string;
  /** Null when there is no actor (or the member row is gone). */
  actor: { memberId: string; name: string; color: Highlighter } | null;
  payload: ActivityPayload;
};

/** GET /api/projects/:id/feed?cursor=&limit= (newest first). */
export type FeedPage = { items: ActivityView[]; nextCursor: string | null };

// ─── Tasks and evidence (M4) ──────────────────────────────────────────────────

/** SELF: a meeting task its owner marked done. EXCELLENT / PASS / SELF earn full points, HALF half, FAIL none. */
export type Grade = 'EXCELLENT' | 'PASS' | 'HALF' | 'FAIL' | 'SELF';
/** DRAFT: evidence being collected; PENDING: 等组长审核; GRADED. */
export type AttemptStatus = 'DRAFT' | 'PENDING' | 'GRADED';
export type EvidenceKind = 'FILE' | 'LINK';

/** 待我审核 (leader): one PENDING attempt. `dueAt`: the task's effective due. */
export type PendingReview = {
  taskId: string;
  title: string;
  ownerMemberId: string | null;
  attemptNo: number;
  submittedAt: string;
  evidenceCount: number;
  late: boolean;
  dueAt: string;
};

export type EvidenceView = {
  id: string;
  kind: EvidenceKind;
  /** File name, or a link's display text (the URL without its scheme, cut to 60 characters). */
  name: string;
  /** LINK only. Files open through GET /api/evidence/:id/link. */
  url: string | null;
  sizeBytes: number | null;
  mimeType: string | null;
  addedByMemberId: string | null;
  createdAt: string;
};

/** 推翻评级 (newest first in AttemptView.changes; undone ones included). */
export type GradeChangeView = {
  id: string;
  fromGrade: Grade;
  toGrade: Grade;
  reason: string;
  byMemberId: string | null;
  createdAt: string;
  undoneAt: string | null;
};

/** One submission round (第 N 次). `counting`: its grade is the one the task earns. */
export type AttemptView = {
  id: string;
  no: number;
  status: AttemptStatus;
  submittedAt: string | null;
  submittedByMemberId: string | null;
  late: boolean;
  evidence: EvidenceView[];
  grade: Grade | null;
  gradeNote: string | null;
  gradedByMemberId: string | null;
  gradedAt: string | null;
  selfGraded: boolean;
  outsideApp: boolean;
  outsideNote: string | null;
  meeting: { summary: string; attendeeMemberIds: string[]; absentMemberIds: string[] } | null;
  changes: GradeChangeView[];
  counting: boolean;
};

export type ChecklistItemView = { id: string; text: string; done: boolean; order: number };

/** A member as the task page shows them (owner, attendees, absentees). */
export type TaskPerson = { memberId: string; name: string; color: Highlighter; active: boolean };

/** A task another task refers to (waitedBy, briefSiblings). */
export type TaskRef = { taskId: string; title: string; ownerMemberId: string | null; ownerName: string | null };

/** GET /api/projects/:id/tasks/:taskId (every task write answers with it too). */
export type TaskDetail = {
  task: TaskView;
  project: {
    id: string;
    tag: string;
    color: Highlighter;
    deadline: string;
    timezone: string;
    viewerMemberId: string;
    viewerRole: MemberRole;
    leaderMemberId: string | null;
    leaderName: string | null;
    /** M5: ENDED → the task page shows the frozen note instead of actions (the leader may still grade a PENDING attempt). */
    lifecycle: ProjectLifecycle;
  };
  owner: TaskPerson | null;
  packageIndex: number | null;
  /** Oldest first. */
  attempts: AttemptView[];
  /** The DRAFT or PENDING attempt. */
  current: AttemptView | null;
  countingAttemptId: string | null;
  checklist: ChecklistItemView[];
  prereq: {
    taskId: string;
    title: string;
    ownerMemberId: string | null;
    ownerName: string | null;
    /** isFinished (a HALF task under re-review is finished). */
    finished: boolean;
    finishedAt: string | null;
    /** Effective due. */
    dueAt: string;
    status: TaskStatus;
    late: boolean;
  } | null;
  /** Tasks whose prereq is this one. */
  waitedBy: TaskRef[];
  /** Only for a 「把大任务拆开」 part: the other parts of the same brief item, in plan order; otherwise []. */
  briefSiblings: TaskRef[];
  /** Until when the owner may undo 「开始做」 (null when they can't). */
  undoStartUntil: string | null;
  storage: { usedBytes: number; capBytes: number; maxFileBytes: number; maxItems: number };
  members: TaskPerson[];
  /** = task.finishedAt. */
  finishedAt: string | null;
};

/** POST …/grade. A reason (`note`) is required for HALF and FAIL. */
export type GradeInput = { grade: Exclude<Grade, 'SELF'>; note?: string | null };
/** POST …/grade-outside (组长代为完成). */
export type GradeOutsideInput = GradeInput & { outsideNote?: string | null };
/** POST …/override. `attemptId`: default the counting attempt. */
export type OverrideInput = { grade: Exclude<Grade, 'SELF'>; reason: string; attemptId?: string };
/** POST …/meeting-done. The server adds the owner to the attendees. */
export type MeetingDoneInput = { summary: string; attendeeMemberIds: string[] };
/** POST …/evidence/link */
export type LinkEvidenceInput = { url: string };
/** PUT …/checklist: replaces every item; items keep their tick by id, new ones (no id) start unticked. */
export type ChecklistInput = { items: { id?: string | null; text: string }[] };
/** POST …/checklist/:itemId/tick */
export type TickInput = { done: boolean };
/** PUT …/prereq (null clears it). */
export type PrereqInput = { prereqTaskId: string | null };
/** PATCH /api/projects/:id/tasks/:taskId of an ACTIVE project (points 1–999; the owner may send `description` only). */
export type TaskPatchInput = Partial<TaskInput>;
/** GET /api/evidence/:id/link: a signed URL the browser opens without the bearer token. */
export type EvidenceLink = { url: string; expiresAt: string };

/** GET /api/projects/:id/brief. `from` / `to`: the line range [from, to) of `text.split('\n')`. */
export type BriefView = {
  text: string;
  fileName: string | null;
  items: { taskId: string; title: string; ownerMemberId: string | null; from: number; to: number }[];
};

/**
 * One row of 我的任务. `dueAt`: the effective due. `selfGraded` / `outsideApp` / `overridden` describe
 * the counting attempt (`overridden`: it has a GradeChange that isn't undone).
 */
export type MyTaskRow = {
  id: string;
  projectId: string;
  projectTag: string;
  projectColor: Highlighter;
  title: string;
  kind: TaskKind;
  points: number;
  status: TaskStatus;
  grade: Grade | null;
  overdue: boolean;
  late: boolean;
  dueAt: string;
  earnedPoints: number;
  finishedAt: string | null;
  selfGraded: boolean;
  outsideApp: boolean;
  overridden: boolean;
};

/** GET /api/tasks/mine: every task I own in my ACTIVE and AWAITING_CONFIRM projects (not drafts, not ENDED). */
export type MyTasksView = {
  /** TODO, DOING, REVIEWING, HALF, FAIL. */
  open: MyTaskRow[];
  /** DONE, newest finishedAt first. */
  done: MyTaskRow[];
  /** ACTIVE / AWAITING_CONFIRM projects where I still need a package. */
  withoutPackage: { projectId: string; projectTag: string }[];
};

// ─── Reminders tick and the time machine (M5) ─────────────────────────────────

/** What one tick did (POST /api/internal/tick, and the time machine's answer): counts per job. */
export type TickResult = {
  /** The server clock the tick ran at (the time machine's time), ISO. */
  now: string;
  swapsExpired: number;
  /** ACTIVE → AWAITING_CONFIRM (each with PROJECT_DUE). */
  projectsDue: number;
  autoEndWarnings: number;
  autoEnded: number;
  /** Notifications of each reminder kind sent (one per recipient). */
  dueSoon: number;
  overdue: number;
  blocked: number;
  weekly: number;
  deleteWarnings: number;
  /** Projects deleted for good (ended or deleted for everyone). */
  purged: number;
  /** Jobs or projects that failed (logged on the server); the others still ran. */
  errors: number;
};

/**
 * GET /api/dev/time-machine and the answer of POST (development only: 404 unless the server's dev gate is
 * on). The server clock is real time + offsetMs; every route uses it, ETags included (sessions,
 * idempotency keys and rate limits keep real time). The offset lives in the API process: restarting the
 * dev server resets it. `tick`: the tick POST ran right after changing the offset (null on GET).
 */
export type TimeMachineState = { offsetMs: number; now: string; realNow: string; tick: TickResult | null };

/**
 * POST /api/dev/time-machine: exactly one of `offsetMs` (set), `advanceMs` (add; may be negative) or
 * `reset: true` (back to 0). The offset must stay within ±400 days (VALIDATION). Runs one tick right
 * away; afterwards the app revalidates its caches (home, my tasks, notifications, the open project).
 * 「到下个周日 20:05」: the app computes advanceMs from TimeMachineState.now in the device zone.
 */
export type TimeMachineInput = { offsetMs: number } | { advanceMs: number } | { reset: true };
