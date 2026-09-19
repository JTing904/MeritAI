import type { notifsZh } from './notifs.zh';

const tasks = (k: number) => (k === 1 ? 'the 1 unfinished task now has no owner' : `the ${k} unfinished tasks now have no owner`);

export const notifsEn: typeof notifsZh = {
  title: 'Notifications',
  filterLabel: 'Notification filter',
  filter: { all: 'All', mine: 'For me' },
  audience: { GROUP: 'Whole team', ONLY_YOU: 'Only you', ONLY_LEADER: 'Only the leader' },
  unread: 'Unread',
  empty: 'No notifications yet',
  footer:
    'Reminders only follow due dates: the owner hears 24 hours before a task is due, and the whole team hears once it is overdue. Each is sent only once.',
  actions: { decline: 'Decline', accept: 'Accept swap', resplit: 'Re-split', pick: 'Pick a package' },
  toast: {
    accepted: (n) => `Swapped! Package ${n} is yours now`,
    declined: 'Swap declined',
  },

  request: {
    pending: (requester, rp, tp) => [
      { b: requester },
      ` wants to swap their Package ${rp} for your Package ${tp}. Neither package has started, so the swap happens as soon as you accept.`,
    ],
    accepted: (rp) => [`You accepted the swap. Package ${rp} is yours now.`],
    declined: (requester) => ['You declined ', { b: requester }, "'s swap request."],
    cancelled: (requester) => [{ b: requester }, ' cancelled their swap request.'],
    expired: (requester) => [{ b: requester }, "'s swap request expired: no answer for 3 days."],
    void: (requester, reason) => [
      { b: requester },
      reason ? `'s swap request no longer applies, because ${reason}.` : "'s swap request no longer applies.",
    ],
    reason: {
      SWITCHED: { you: 'you switched to another package', them: 'they switched to another package' },
      STARTED: { you: 'you started working', them: 'they started working' },
      SWAPPED_ELSEWHERE: 'one of the packages was swapped with someone else',
      LEFT: 'they left the project',
      RESPLIT: 'the leader re-split the packages',
    },
  },

  swapAccepted: (target, tp) => [{ b: target }, ` accepted the swap. Package ${tp} is yours now.`],
  swapDeclined: (target) => [{ b: target }, ' declined your swap request.'],
  swapExpired: (target) => ['Your swap request to ', { b: target }, ' expired: no answer for 3 days.'],
  swapVoid: (target, reason) => ['Your swap request to ', { b: target }, ` no longer applies, because ${reason}.`],
  swapVoidReason: {
    SWITCHED: 'they switched to another package',
    STARTED: 'they started working',
    SWAPPED_ELSEWHERE: 'they already swapped with someone else',
    LEFT: 'they left the project',
  },

  needsPackage: {
    joined: (name, tag) => [
      { b: name },
      ` joined ${tag}, but every package is taken. They'll get a package of their own after a re-split.`,
    ],
    other: (name) => [{ b: name }, " has no package, and every package is taken. They'll get a package of their own after a re-split."],
  },

  taskAdded: (title, n, pts) => [
    `The leader put a new task, "${title}", into your Package ${n}. Every task was rescaled, and your package is now worth ${pts} pts.`,
  ],
  movedIn: {
    fromOwned: (title, from, n) => [`The leader moved "${title}" from `, { b: from }, `'s package to your Package ${n}.`],
    fromFree: (title, m, n) => [`The leader moved "${title}" from Package ${m} to your Package ${n}.`],
    evidence: ' The evidence already handed in moved with it.',
  },
  movedOut: {
    toOwned: (title, m, to, n) => [`The leader moved "${title}" from your Package ${m} to `, { b: to }, `'s Package ${n}.`],
    toFree: (title, m, n) => [`The leader moved "${title}" from your Package ${m} to Package ${n} (nobody has picked it yet).`],
  },
  resplit: {
    same: (n, pts) => [
      `The leader re-split the packages: tasks nobody has started were shared out evenly again, and your Package ${n} is now worth ${pts} pts. Tasks already started didn't change.`,
    ],
    renumbered: (n, pts) => [
      `The leader re-split the packages: tasks nobody has started were shared out evenly again. Your package is now Package ${n}, worth ${pts} pts. Tasks already started didn't change.`,
    ],
    free: (free) => [
      free === 1
        ? 'The leader re-split the packages. 1 package is still free: first come, first served!'
        : `The leader re-split the packages. ${free} packages are still free: first come, first served!`,
    ],
    none: () => ['The leader re-split the packages.'],
  },
  assigned: (n) => [`The leader assigned Package ${n} to you. Until you start, you can still switch to another free package.`],
  leaderTransferred: (from) => [{ b: from }, ' made you the leader. You can now manage tasks, members and project settings.'],
  memberLeft: (name, tag, unfinished) => [
    { b: name },
    unfinished > 0 ? ` left ${tag}. Their finished points stay; ${tasks(unfinished)}.` : ` left ${tag}. Their finished points stay.`,
  ],
  memberRemoved: (name, tag, unfinished) => [
    'The leader removed ',
    { b: name },
    unfinished > 0 ? ` from ${tag}. Their finished points stay; ${tasks(unfinished)}.` : ` from ${tag}. Their finished points stay.`,
  ],
  removedYou: (tag) => [`The leader removed you from ${tag}. Your finished points stay in the team report.`],
};
