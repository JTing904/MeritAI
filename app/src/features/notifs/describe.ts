import type { Href } from 'expo-router';
import { formatPoints, formatTotal } from '@shared/planning';
import type { Grade, NotificationView } from '@shared/types';
import type { Messages } from '@/i18n/zh';
import type { InlinePart } from '@/i18n/sections/home.zh';
import { resetClock } from '@/features/ai/models';
import { dayDiff, dueLabel } from '@/lib/time';
import type { Highlighter } from '@/theme/tokens';

export type NotifAction =
  | 'decline'
  | 'accept'
  | 'resplit'
  | 'pick'
  | 'openTask'
  | 'grade'
  // M5
  | 'delay'
  | 'viewTask'
  | 'move'
  | 'end'
  | 'viewProject'
  | 'whatsapp'
  // M6
  | 'checkKey'
  | 'changeKey'
  | 'viewReasons'
  | 'viewPackages';

/** Buttons drawn as the soft (secondary) kind; the others are primary (NotifsM5 mockup). */
export const SOFT_ACTIONS: ReadonlySet<NotifAction> = new Set([
  'decline',
  'openTask',
  'viewTask',
  'move',
  'viewProject',
  'whatsapp',
  'checkKey',
  'viewReasons',
  'viewPackages',
]);

export type NotifLook = {
  emoji: string;
  /** Emoji tile tint. */
  tint: Highlighter;
  /** The text; `{ b }` parts are bold (people's full names). */
  parts: InlinePart[];
  /** Buttons under the text, in order. */
  actions: NotifAction[];
  /** Where tapping the card goes; null when the viewer can't open the project any more. */
  href: Href | null;
  /** Where a button goes when it isn't `href` (一键延后, 移给谁, 结束项目). */
  to?: Partial<Record<NotifAction, Href>>;
  /** 发到 WhatsApp: the text to send (plain, with the project tag). */
  share?: string;
};

type Copy = Messages['notifs'];
type Labels = Messages['labels'];
type AiCopy = Messages['ai'];

/** The 我 page (the AI key card): 检查 key / 换 key. */
const ME_HREF: Href = '/me';

/** The parts as plain text (no bold): what 发到 WhatsApp sends. */
const plain = (parts: InlinePart[]) => parts.map((p) => (typeof p === 'string' ? p : p.b)).join('');

/** 今天 / 明天 / 10月13日 for a due date, counted from when the reminder was sent (device zone). */
function dueDay(iso: string, sentAt: string, copy: Copy, labels: Labels): string {
  const d = new Date(iso);
  const days = dayDiff(d, new Date(sentAt));
  if (days === 0) return copy.day.today;
  if (days === 1) return copy.day.tomorrow;
  return labels.due.date(d.getMonth() + 1, d.getDate());
}

/** 11月13日 (device zone), for lifecycle dates. */
const monthDay = (iso: string, labels: Labels) => {
  const d = new Date(iso);
  return labels.due.date(d.getMonth() + 1, d.getDate());
};

/** Tile of a grade notification (M4 spec §8): full ✅ mint, 拿一半 🌓 tang, 不通过 ❌ tang. */
function gradeTile(grade: Grade): Pick<NotifLook, 'emoji' | 'tint'> {
  if (grade === 'HALF') return { emoji: '🌓', tint: 'tang' };
  if (grade === 'FAIL') return { emoji: '❌', tint: 'tang' };
  return { emoji: '✅', tint: 'mint' };
}

/** The reason shown on a void swap request, as the person who was asked reads it. */
function requestVoidReason(swap: NonNullable<NotificationView['swap']>, copy: Copy['request']['reason']): string | null {
  switch (swap.voidReason) {
    case 'SWITCHED':
    case 'STARTED':
      return swap.voidedByRequester ? copy[swap.voidReason].them : copy[swap.voidReason].you;
    case 'SWAPPED_ELSEWHERE':
      return copy.SWAPPED_ELSEWHERE;
    // 「TA 退出了项目」 is only true when the requester left; if the viewer left, say no reason.
    case 'LEFT':
      return swap.voidedByRequester ? copy.LEFT : null;
    case 'RESPLIT':
      return copy.RESPLIT;
    case 'PROJECT_DELETED':
      return copy.PROJECT_DELETED;
    default:
      return null;
  }
}

/** A SWAP_REQUEST reads differently as the request moves on (pending → accepted, declined, …). */
function swapRequestParts(n: NotificationView, p: Extract<NotificationView['payload'], { type: 'SWAP_REQUEST' }>, copy: Copy) {
  const who = p.requester.name;
  const swap = n.swap;
  switch (swap?.status) {
    case 'PENDING':
      return copy.request.pending(who, p.requesterPackageIndex, p.targetPackageIndex);
    case 'ACCEPTED':
      return copy.request.accepted(p.requesterPackageIndex);
    case 'DECLINED':
      return copy.request.declined(who);
    case 'CANCELLED':
      return copy.request.cancelled(who);
    case 'EXPIRED':
      return copy.request.expired(who);
    case 'VOID':
      return copy.request.void(who, requestVoidReason(swap, copy.request.reason));
    default:
      // The swap row is gone: it no longer applies, reason unknown.
      return copy.request.void(who, null);
  }
}

/**
 * Emoji, tint, text, buttons and tap target of one notification (M3 and M4 spec §8, M5 spec §5). Null for a
 * type this version of the app doesn't know (an older APK talking to a newer server): the list skips it.
 */
export function describeNotification(n: NotificationView, copy: Copy, labels: Labels, ai: AiCopy): NotifLook | null {
  const tag = n.projectTag ?? '';
  const id = n.projectId;
  const open = n.projectOpen && id !== null;
  const projectHref: Href | null = open ? { pathname: '/project/[id]', params: { id } } : null;
  const taskHref = (taskId: string, grade = false): Href | null =>
    open ? { pathname: '/project/[id]/task/[taskId]', params: grade ? { id, taskId, grade: '1' } : { id, taskId } } : null;
  const p = n.payload;
  const taskWith = (taskId: string, params: Record<string, string>): Href | null =>
    open ? { pathname: '/project/[id]/task/[taskId]', params: { id, taskId, ...params } } : null;
  const share = (parts: InlinePart[], emoji = '') => copy.share(tag, `${emoji ? `${emoji} ` : ''}${plain(parts)}`);

  switch (p.type) {
    case 'SWAP_REQUEST':
      return {
        emoji: '🔁',
        tint: 'tang',
        parts: swapRequestParts(n, p, copy),
        actions: n.swap?.status === 'PENDING' ? ['decline', 'accept'] : [],
        href: projectHref,
      };
    case 'SWAP_ACCEPTED':
      return { emoji: '🔁', tint: 'tang', parts: copy.swapAccepted(p.target.name, p.targetPackageIndex), actions: [], href: projectHref };
    case 'SWAP_DECLINED':
      return { emoji: '🔁', tint: 'tang', parts: copy.swapDeclined(p.target.name), actions: [], href: projectHref };
    case 'SWAP_EXPIRED':
      return { emoji: '🔁', tint: 'tang', parts: copy.swapExpired(p.target.name), actions: [], href: projectHref };
    case 'SWAP_VOID':
      return {
        emoji: '🔁',
        tint: 'tang',
        parts: copy.swapVoid(p.target.name, copy.swapVoidReason[p.reason]),
        actions: [],
        href: projectHref,
      };
    case 'MEMBER_NEEDS_PACKAGE':
      return {
        emoji: '👋',
        tint: 'mint',
        parts: p.joined ? copy.needsPackage.joined(p.member.name, tag) : copy.needsPackage.other(p.member.name),
        actions: open ? ['resplit'] : [],
        href: open ? { pathname: '/project/[id]', params: { id, open: 'resplit' } } : null,
      };
    case 'TASK_ADDED':
      return {
        emoji: '📦',
        tint: 'gum',
        parts: copy.taskAdded(p.title, p.packageIndex, formatTotal(p.packagePoints)),
        actions: [],
        href: projectHref,
      };
    case 'TASK_MOVED_IN': {
      // In no package before: 「从 X 的包」 wouldn't be true even when someone held it.
      const parts =
        p.fromPackageIndex === null
          ? copy.movedIn.fromNowhere(p.title, p.toPackageIndex)
          : p.from
            ? copy.movedIn.fromOwned(p.title, p.from.name, p.toPackageIndex)
            : copy.movedIn.fromFree(p.title, p.fromPackageIndex, p.toPackageIndex);
      return {
        emoji: '↔️',
        tint: 'sky',
        parts: p.hasEvidence ? [...parts, copy.movedIn.evidence] : parts,
        actions: [],
        href: projectHref,
      };
    }
    case 'TASK_MOVED_OUT': {
      const from = p.fromPackageIndex;
      const parts =
        from === null
          ? p.to
            ? copy.movedOut.fromNowhereToOwned(p.title, p.to.name, p.toPackageIndex)
            : copy.movedOut.fromNowhereToFree(p.title, p.toPackageIndex)
          : p.to
            ? copy.movedOut.toOwned(p.title, from, p.to.name, p.toPackageIndex)
            : copy.movedOut.toFree(p.title, from, p.toPackageIndex);
      return { emoji: '↔️', tint: 'sky', parts, actions: [], href: projectHref };
    }
    case 'RESPLIT': {
      const pkg = p.package;
      if (pkg) {
        const pts = formatTotal(pkg.points);
        return {
          emoji: '🔀',
          tint: 'lilac',
          parts: pkg.oldIndex !== null ? copy.resplit.renumbered(pkg.index, pts) : copy.resplit.same(pkg.index, pts),
          actions: [],
          href: projectHref,
        };
      }
      return {
        emoji: '🔀',
        tint: 'lilac',
        parts: p.freePackages > 0 ? copy.resplit.free(p.freePackages) : copy.resplit.none(),
        actions: open && p.freePackages > 0 ? ['pick'] : [],
        href: open ? { pathname: '/project/[id]/pick', params: { id } } : null,
      };
    }
    case 'PACKAGE_ASSIGNED':
      return { emoji: '📦', tint: 'gum', parts: copy.assigned(p.packageIndex), actions: [], href: projectHref };
    case 'LEADER_TRANSFERRED':
      return {
        emoji: '👑',
        tint: 'lemon',
        parts: p.leftAfter ? copy.leaderTransferredLeft(p.from.name, tag) : copy.leaderTransferred(p.from.name),
        actions: [],
        href: projectHref,
      };
    // Leader deleted / restored the project: a deleted one can't be opened (projectOpen is false).
    case 'PROJECT_DELETED':
      return { emoji: '🗑️', tint: 'sky', parts: copy.projectDeleted(p.leader.name, tag), actions: [], href: projectHref };
    case 'PROJECT_RESTORED':
      return { emoji: '♻️', tint: 'mint', parts: copy.projectRestored(p.leader.name, tag), actions: [], href: projectHref };
    case 'MEMBER_LEFT':
      return { emoji: '🚪', tint: 'sky', parts: copy.memberLeft(p.member.name, tag, p.unfinishedCount), actions: [], href: projectHref };
    case 'MEMBER_REMOVED':
      return {
        emoji: '🚪',
        tint: 'sky',
        parts: copy.memberRemoved(p.member.name, tag, p.unfinishedCount),
        actions: [],
        href: projectHref,
      };
    case 'REMOVED_YOU':
      return { emoji: '🚪', tint: 'sky', parts: copy.removedYou(tag), actions: [], href: projectHref };
    // M4: the task page opens on tap and through the button.
    case 'SUBMITTED': {
      const due = new Date(p.dueAt);
      const parts = copy.submitted({
        name: p.submitter.name,
        title: p.title,
        no: p.attemptNo,
        count: p.evidenceCount,
        allFiles: p.allFiles,
        month: due.getMonth() + 1,
        day: due.getDate(),
        late: p.late,
      });
      // ?grade=1 opens the grade sheet, only while the attempt is still waiting (the task page checks).
      const href = taskHref(p.taskId, true);
      return { emoji: '📨', tint: 'lemon', parts, actions: href ? ['grade'] : [], href };
    }
    case 'GRADED': {
      const href = taskHref(p.taskId);
      if (p.byAi) {
        // M6 (NotifsM6): the AI graded it. 看理由 for 拿一半 / 不通过, 打开任务 otherwise.
        const redoAi = p.grade === 'HALF' || p.grade === 'FAIL';
        const parts = ai.notifs.graded({
          title: p.title,
          grade: p.grade,
          no: p.attemptNo,
          pts: formatPoints(p.points),
          earned: formatPoints(p.earned),
          counting: p.counting,
          reasons: p.reasonsCount ?? 0,
        });
        return { ...gradeTile(p.grade), parts, actions: href ? [redoAi ? 'viewReasons' : 'openTask'] : [], href };
      }
      const text = {
        title: p.title,
        grade: p.grade,
        no: p.attemptNo,
        pts: formatPoints(p.points),
        earned: formatPoints(p.earned),
        counting: p.counting,
      };
      const redo = p.grade === 'HALF' || p.grade === 'FAIL';
      return { ...gradeTile(p.grade), parts: copy.graded(text), actions: href && redo ? ['openTask'] : [], href };
    }
    case 'GRADED_OUTSIDE': {
      const href = taskHref(p.taskId);
      const text = {
        title: p.title,
        grade: p.grade,
        pts: formatPoints(p.points),
        earned: formatPoints(p.earned),
        counting: p.counting,
        note: p.outsideNote,
      };
      const redo = p.grade === 'HALF' || p.grade === 'FAIL';
      return { ...gradeTile(p.grade), parts: copy.gradedOutside(text), actions: href && redo ? ['openTask'] : [], href };
    }
    case 'OVERRIDDEN': {
      const href = taskHref(p.taskId);
      const text = {
        title: p.title,
        from: p.fromGrade,
        to: p.toGrade,
        pts: formatPoints(p.points),
        earned: formatPoints(p.earned),
        counting: p.counting,
      };
      return {
        ...gradeTile(p.toGrade),
        parts: p.undone ? copy.overrideUndone(text) : copy.overridden(text),
        actions: href ? ['openTask'] : [],
        href,
      };
    }
    case 'WAITING_ON_YOU': {
      // The leader opens the task that waits; the prereq's owner opens their own task.
      const href = taskHref(p.forLeader ? p.waitingTaskId : p.prereqTaskId);
      let parts: InlinePart[];
      if (p.forLeader) {
        parts = p.prereqOwner
          ? copy.waiting.toLeader(p.waiter.name, p.prereqOwner.name, p.prereqTitle)
          : copy.waiting.toLeaderNoOwner(p.waiter.name, p.prereqTitle);
      } else if (p.setBy.memberId !== p.waiter.memberId) {
        parts = copy.waiting.byLeader(p.waiter.name, p.waitingTitle, p.prereqTitle);
      } else {
        parts = copy.waiting.byWaiter(p.waiter.name, p.prereqTitle);
      }
      return { emoji: '⏰', tint: 'lilac', parts, actions: href ? ['openTask'] : [], href };
    }
    case 'PREREQ_DONE': {
      const href = taskHref(p.waitingTaskId);
      return {
        emoji: '🔨',
        tint: 'sky',
        parts: copy.prereqDone(p.prereqTitle, p.waitingTitle),
        actions: href ? ['openTask'] : [],
        href,
      };
    }
    // ─── M5: reminders ───
    case 'TASK_DUE_SOON': {
      const href = taskHref(p.taskId);
      const when = dueLabel(p.dueAt, labels.due, new Date(n.createdAt));
      return { emoji: '⏰', tint: 'lemon', parts: copy.dueSoon(p.title, when), actions: href ? ['openTask'] : [], href };
    }
    case 'TASK_DUE_REVIEW': {
      const href = taskHref(p.taskId, true);
      const parts = copy.dueReview(p.title, dueDay(p.dueAt, n.createdAt, copy, labels), p.owner?.name ?? null);
      return { emoji: '📨', tint: 'gum', parts, actions: href ? ['grade'] : [], href };
    }
    case 'TASK_OWNERLESS_SOON': {
      const href = taskHref(p.taskId);
      const move = taskWith(p.taskId, { move: '1' });
      return {
        emoji: '🙋',
        tint: 'sky',
        parts: copy.ownerlessSoon(p.title, dueDay(p.dueAt, n.createdAt, copy, labels)),
        actions: move ? ['move'] : [],
        href,
        to: move ? { move } : undefined,
      };
    }
    case 'TASK_OVERDUE': {
      const href = taskHref(p.taskId);
      const i = Number.isInteger(p.template) && p.template >= 0 && p.template < copy.overdue.lines.length ? p.template : 0;
      const line = copy.overdue.lines[i]!(p.owner.name, p.title);
      const parts = p.waitingFor ? [...line, copy.overdue.waiting(p.waitingFor.owner?.name ?? null, p.waitingFor.title)] : line;
      const emoji = copy.overdue.emoji[i] ?? '🐢';
      return {
        emoji,
        tint: 'mint',
        parts,
        actions: href ? ['openTask', 'whatsapp'] : ['whatsapp'],
        href,
        share: share(parts, emoji),
      };
    }
    case 'TASK_OWNERLESS_OVERDUE': {
      const parts = copy.ownerlessOverdue(p.title);
      return { emoji: '👻', tint: 'sky', parts, actions: ['whatsapp'], href: taskHref(p.taskId), share: share(parts, '👻') };
    }
    case 'PREREQ_BLOCKED': {
      if (p.awaitingGrade) {
        const grade = taskHref(p.prereqTaskId, true);
        return {
          emoji: '📨',
          tint: 'mint',
          parts: copy.prereqAwaitingGrade(p.waitingTitle, p.prereqTitle, p.blockedDays),
          actions: grade ? ['grade'] : [],
          href: grade,
        };
      }
      const href = taskHref(p.waitingTaskId);
      const delay = taskWith(p.waitingTaskId, { delay: String(p.blockedDays) });
      return {
        emoji: '🧱',
        tint: 'mint',
        parts: copy.prereqBlocked(p.waitingTitle, p.prereqTitle, p.blockedDays),
        actions: delay ? ['delay', 'viewTask'] : [],
        href,
        to: delay ? { delay } : undefined,
      };
    }
    case 'WEEKLY_SUMMARY': {
      const parts = copy.weekly({
        tag,
        finished: p.finishedCount,
        finishedPts: formatPoints(p.finishedPoints),
        total: formatPoints(p.totalPoints),
        overdue: p.overdueCount,
        next: p.dueNextWeekCount,
        top: p.top ? { name: p.top.member.name, pts: formatPoints(p.top.points) } : null,
      });
      return {
        emoji: '📊',
        tint: 'lemon',
        parts,
        actions: projectHref ? ['viewProject', 'whatsapp'] : ['whatsapp'],
        href: projectHref,
        share: share(parts, '📊'),
      };
    }
    // ─── M5: the project lifecycle ───
    case 'PROJECT_DUE': {
      const end: Href | null = open ? { pathname: '/project/[id]', params: { id, open: 'end' } } : null;
      return {
        emoji: '📮',
        tint: 'lemon',
        parts: copy.projectDue(tag, monthDay(p.autoEndAt, labels)),
        actions: end ? ['end'] : [],
        href: projectHref,
        to: end ? { end } : undefined,
      };
    }
    case 'PROJECT_AUTO_END_SOON':
      return { emoji: '⌛', tint: 'lemon', parts: copy.autoEndSoon(tag), actions: [], href: projectHref };
    case 'PROJECT_ENDED': {
      const purge = monthDay(p.purgeAfter, labels);
      const parts = p.auto || !p.leader ? copy.projectEndedAuto(tag, purge) : copy.projectEnded(p.leader.name, tag, purge);
      return { emoji: '🏁', tint: 'lilac', parts, actions: projectHref ? ['viewProject'] : [], href: projectHref };
    }
    case 'PROJECT_REOPENED':
      return {
        emoji: '🔓',
        tint: 'mint',
        parts: copy.projectReopened(p.leader.name, tag, monthDay(p.deadline, labels)),
        actions: projectHref ? ['viewProject'] : [],
        href: projectHref,
      };
    case 'PROJECT_DELETE_SOON':
      return { emoji: '🗑️', tint: 'sky', parts: copy.deleteSoon(tag, p.days), actions: [], href: projectHref };
    case 'TASK_DELAYED': {
      const href = taskHref(p.taskId);
      return {
        emoji: '⏳',
        tint: 'sky',
        parts: copy.taskDelayed(p.title, monthDay(p.dueAt, labels), p.prereq?.title ?? null),
        actions: href ? ['openTask'] : [],
        href,
      };
    }
    // ─── M6: AI ───
    case 'AI_REVIEW_FAILED': {
      const grade = taskHref(p.taskId, true);
      const provider = p.provider ? ai.provider[p.provider] : 'AI';
      const who = p.submitter?.name ?? null;
      const f = ai.notifs.reviewFailed;
      let parts: InlinePart[];
      let tile: Pick<NotifLook, 'emoji' | 'tint'> = { emoji: '📨', tint: 'lemon' };
      const keyTrouble = p.reason === 'QUOTA' || p.reason === 'INVALID' || p.reason === 'NO_KEY';
      switch (p.reason) {
        case 'QUOTA':
          parts = f.QUOTA(provider, who, p.title);
          tile = { emoji: '⏳', tint: 'lemon' };
          break;
        case 'INVALID':
          parts = f.INVALID(provider, who, p.title);
          tile = { emoji: '❌', tint: 'gum' };
          break;
        case 'NO_KEY':
          parts = f.NO_KEY(who, p.title);
          tile = { emoji: '❌', tint: 'gum' };
          break;
        case 'LINKS_ONLY':
          parts = f.LINKS_ONLY(p.title);
          break;
        case 'UNREADABLE':
          parts = f.UNREADABLE(who, p.title);
          break;
        case 'TASK_LIMIT':
        case 'PROJECT_LIMIT':
          parts = f.LIMIT(who, p.title);
          break;
        default:
          parts = f.OTHER(who, p.title);
      }
      const actions: NotifAction[] = [];
      if (grade) actions.push('grade');
      if (keyTrouble) actions.push('checkKey');
      return { ...tile, parts, actions, href: grade, to: keyTrouble ? { checkKey: ME_HREF } : undefined };
    }
    case 'AI_KEY_PROBLEM': {
      const provider = ai.provider[p.provider];
      if (p.problem === 'QUOTA') {
        const when = p.provider === 'GEMINI' || !p.resetsAt ? ai.me.backGemini : ai.me.backAt(resetClock(p.resetsAt));
        return { emoji: '⏳', tint: 'lemon', parts: ai.notifs.keyQuota(provider, when), actions: ['checkKey'], href: ME_HREF, to: { checkKey: ME_HREF } };
      }
      return {
        emoji: '❌',
        tint: 'gum',
        parts: ai.notifs.keyInvalid(provider, ai.company[p.provider]),
        actions: ['changeKey'],
        href: ME_HREF,
        to: { changeKey: ME_HREF },
      };
    }
    case 'CHOICE_CHANGED': {
      const sep = ai.notifs.labelSep;
      return {
        emoji: '🔀',
        tint: 'lemon',
        parts: ai.notifs.choiceChanged(p.prompt, p.from.join(sep), p.to.join(sep), p.removedTitles.length, p.addedTitles.length),
        actions: projectHref ? ['viewPackages'] : [],
        href: projectHref,
      };
    }
    default:
      return null;
  }
}
