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
  /** Tenths: DONE → points, HALF → half (rounded), else 0. */
  earnedPoints: number;
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

/** A project as members see it. GET /api/projects/:id (M3 extends it with the project page). */
export type ProjectView = {
  basics: ProjectBasics;
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
export type HomeData = { projects: ProjectCard[]; invites: PendingInvite[] };

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
export type SwapVoidReason = 'SWITCHED' | 'STARTED' | 'SWAPPED_ELSEWHERE' | 'LEFT' | 'RESPLIT';

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
  | 'LEADER_TRANSFERRED';

/** 全组都收到 / 只有你收到 / 只有组长收到. */
export type NotificationAudience = 'GROUP' | 'ONLY_YOU' | 'ONLY_LEADER';

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
  /** A re-split never sends this (its RESPLIT notification covers it). */
  | { type: 'SWAP_VOID'; target: PersonRef; reason: Exclude<SwapVoidReason, 'RESPLIT'> }
  /** To the leader. `joined`: the member just joined (「加入了 {tag}，但任务包都有人选了」). */
  | { type: 'MEMBER_NEEDS_PACKAGE'; member: PersonRef; joined: boolean }
  | { type: 'MEMBER_LEFT'; member: PersonRef; unfinishedCount: number }
  | { type: 'MEMBER_REMOVED'; member: PersonRef; unfinishedCount: number }
  | { type: 'REMOVED_YOU' }
  /** `packagePoints`: the receiving package's total after the rescale. */
  | { type: 'TASK_ADDED'; taskId: string; title: string; packageIndex: number; packagePoints: number }
  /** `from` null: it came from a package nobody picked. `hasEvidence` is false until M4. */
  | {
      type: 'TASK_MOVED_IN';
      taskId: string;
      title: string;
      from: PersonRef | null;
      fromPackageIndex: number;
      toPackageIndex: number;
      hasEvidence: boolean;
    }
  /** `to` null: it went to a package nobody picked. */
  | { type: 'TASK_MOVED_OUT'; taskId: string; title: string; fromPackageIndex: number; to: PersonRef | null; toPackageIndex: number }
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
  | { type: 'LEADER_TRANSFERRED'; from: PersonRef };

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
  | 'LEADER_TRANSFERRED';

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
  | { type: 'TASK_MOVED'; taskId: string; title: string; fromPackageIndex: number; toPackageIndex: number }
  | { type: 'TASK_STARTED'; taskId: string; title: string }
  | { type: 'RESPLIT'; packageCount: number }
  /** `member`: the new leader. */
  | { type: 'LEADER_TRANSFERRED'; member: PersonRef };

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
