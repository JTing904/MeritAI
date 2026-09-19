import type { Href } from 'expo-router';
import { formatTotal } from '@shared/planning';
import type { NotificationView } from '@shared/types';
import type { Messages } from '@/i18n/zh';
import type { InlinePart } from '@/i18n/sections/home.zh';
import type { Highlighter } from '@/theme/tokens';

export type NotifAction = 'decline' | 'accept' | 'resplit' | 'pick';

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
};

type Copy = Messages['notifs'];

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
 * Emoji, tint, text, buttons and tap target of one notification (M3 spec §8). Null for a type this
 * version of the app doesn't know (an older APK talking to a newer server): the list skips it.
 */
export function describeNotification(n: NotificationView, copy: Copy): NotifLook | null {
  const tag = n.projectTag ?? '';
  const id = n.projectId;
  const open = n.projectOpen && id !== null;
  const projectHref: Href | null = open ? { pathname: '/project/[id]', params: { id } } : null;
  const p = n.payload;

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
      const parts = p.from
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
    case 'TASK_MOVED_OUT':
      return {
        emoji: '↔️',
        tint: 'sky',
        parts: p.to
          ? copy.movedOut.toOwned(p.title, p.fromPackageIndex, p.to.name, p.toPackageIndex)
          : copy.movedOut.toFree(p.title, p.fromPackageIndex, p.toPackageIndex),
        actions: [],
        href: projectHref,
      };
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
      return { emoji: '👑', tint: 'lemon', parts: copy.leaderTransferred(p.from.name), actions: [], href: projectHref };
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
    default:
      return null;
  }
}
