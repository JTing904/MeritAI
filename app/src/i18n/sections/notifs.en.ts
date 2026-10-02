import { labelsEn } from './labels.en';
import type { InlinePart } from './home.zh';
import type { GradeKey, GradeText, notifsZh, OutsideText, OverrideText } from './notifs.zh';

const tasks = (k: number) => (k === 1 ? 'the 1 unfinished task now has no owner' : `the ${k} unfinished tasks now have no owner`);

const isFull = (g: GradeKey) => g === 'EXCELLENT' || g === 'PASS' || g === 'SELF';

const gradeGain = (g: GradeText | OutsideText) => {
  if (!g.counting) return `still ${g.earned} pts from before`;
  if (isFull(g.grade)) return `full ${g.pts} pts`;
  return g.grade === 'HALF' ? `${g.earned} pts for now; fix it and resubmit for full points` : '0 pts; fix it and resubmit';
};

const overrideGain = (o: OverrideText) => {
  if (!o.counting) return `still ${o.earned} pts`;
  if (isFull(o.to)) return `full ${o.pts} pts`;
  return o.to === 'HALF' ? `${o.earned} pts now` : '0 pts';
};

const pieces = (n: number, allFiles: boolean) =>
  allFiles ? (n === 1 ? '1 file' : `${n} files`) : n === 1 ? '1 piece of evidence' : `${n} pieces of evidence`;

export const notifsEn: typeof notifsZh = {
  title: 'Notifications',
  filterLabel: 'Notification filter',
  filter: { all: 'All', mine: 'For me' },
  audience: { GROUP: 'Whole team', ONLY_YOU: 'Only you', ONLY_LEADER: 'Only the leader', YOU_AND_LEADER: 'Only you and the leader' },
  unread: 'Unread',
  empty: 'No notifications yet',
  footer:
    'Reminders only follow due dates: the owner hears 24 hours before a task is due, and the whole team hears once it is overdue. Each is sent only once.',
  actions: {
    decline: 'Decline',
    accept: 'Accept swap',
    resplit: 'Re-split',
    pick: 'Pick a package',
    openTask: 'Open task',
    grade: 'Grade it',
    delay: 'Delay it',
    viewTask: 'See task',
    move: 'Move it to…',
    end: 'End project',
    viewProject: 'See project',
    whatsapp: 'Send to WhatsApp',
    checkKey: 'Check the key',
    changeKey: 'Replace the key',
    viewReasons: 'See the reasons',
    viewPackages: 'See packages',
  },
  share: (tag, text) => (tag && !text.includes(tag) ? `[${tag}] ${text}` : text),
  weeklyMeta: 'Weekly summary',
  day: { today: 'today', tomorrow: 'tomorrow' },
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
      PROJECT_DELETED: 'the leader deleted the project',
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
    fromNowhere: (title, n) => [`The leader moved "${title}" to your Package ${n}.`],
    evidence: ' The evidence already handed in moved with it.',
  },
  movedOut: {
    toOwned: (title, m, to, n) => [`The leader moved "${title}" from your Package ${m} to `, { b: to }, `'s Package ${n}.`],
    toFree: (title, m, n) => [`The leader moved "${title}" from your Package ${m} to Package ${n} (nobody has picked it yet).`],
    fromNowhereToOwned: (title, to, n) => [`The leader moved "${title}" to `, { b: to }, `'s Package ${n}.`],
    fromNowhereToFree: (title, n) => [`The leader moved "${title}" to Package ${n} (nobody has picked it yet).`],
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
  leaderTransferredLeft: (from, tag) => [
    { b: from },
    ` made you the leader, then left ${tag}. You can now manage tasks, members and project settings.`,
  ],
  projectDeleted: (leader, tag) => [
    'The leader ',
    { b: leader },
    ' deleted ',
    { b: tag },
    ". It will be deleted for good in 7 days; if the leader restores it, it comes back to your Home. You keep your badges.",
  ],
  projectRestored: (leader, tag) => ['The leader ', { b: leader }, ' restored ', { b: tag }, '. It is back on your Home.'],
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

  submitted: (x) => {
    const count = pieces(x.count, x.allFiles);
    const due = labelsEn.due.date(x.month, x.day);
    const last = x.late ? `${count}, due ${due}, handed in late.` : x.no > 1 ? `${count}.` : `${count}, due ${due}.`;
    return x.no > 1
      ? [{ b: x.name }, ` resubmitted "${x.title}" (attempt ${x.no}) for your review. ${last}`]
      : [{ b: x.name }, ` handed in "${x.title}" for your review. ${last}`];
  },
  graded: (g) => {
    const word = labelsEn.grade[g.grade];
    if (!g.counting) return [`Attempt ${g.no}: the leader graded your "${g.title}": `, { b: word }, `, ${gradeGain(g)}. The reason is on the task page.`];
    const prefix = g.no > 1 ? `Attempt ${g.no}: the leader` : 'The leader';
    const reason = isFull(g.grade) ? '' : ' The reason is on the task page.';
    return [`${prefix} graded your "${g.title}": `, { b: word }, `, ${gradeGain(g)}.${reason}`];
  },
  gradedOutside: (g) => [
    `The leader completed your "${g.title}" for you: `,
    { b: labelsEn.grade[g.grade] },
    `, ${gradeGain(g)}. ${g.note ? `The evidence was handed in outside the app: "${g.note}".` : 'The evidence was handed in outside the app.'}`,
  ],
  overridden: (o) => [
    `The leader changed your "${o.title}" from "${labelsEn.grade[o.from]}" to "${labelsEn.grade[o.to]}": ${overrideGain(o)}. The reason is on the task page.`,
  ],
  overrideUndone: (o) => [`The leader undid the last override; your "${o.title}" is back to "${labelsEn.grade[o.to]}": ${overrideGain(o)}.`],
  waiting: {
    byWaiter: (waiter, prereq) => [{ b: waiter }, ` is waiting on your "${prereq}".`],
    byLeader: (waiter, waiting, prereq) => ['The leader marked ', { b: waiter }, `'s "${waiting}" as waiting on your "${prereq}".`],
    toLeader: (waiter, owner, prereq) => [{ b: waiter }, ' is waiting on ', { b: owner }, `'s "${prereq}".`],
    toLeaderNoOwner: (waiter, prereq) => [{ b: waiter }, ` is waiting on "${prereq}", which nobody is responsible for yet.`],
  },
  prereqDone: (prereq, waiting) => [`"${prereq}" is finished. You can start "${waiting}" now.`],

  dueSoon: (title, when) => [`Your "${title}" is due `, { b: when }, " and hasn't been handed in yet."],
  dueReview: (title, day, owner) =>
    owner
      ? [`"${title}" is due ${day}. `, { b: owner }, ' has handed it in, and it is waiting for your grade.']
      : [`"${title}" is due ${day}. It has been handed in and is waiting for your grade.`],
  ownerlessSoon: (title, day) => [`"${title}" is due ${day}, and nobody is responsible for it yet.`],
  overdue: {
    emoji: ['🐢', '⏰', '🫠', '📣', '🧃'],
    lines: [
      (name, task) => [{ b: name }, `'s "${task}" is overdue. They might still be on the way…`],
      (name, task) => [`"${task}" is past its due time and `, { b: name }, " hasn't handed it in yet. Cheer them on?"],
      (name, task) => [`We waited for "${task}" until it went overdue. Go, `, { b: name }, '!'],
      (name, task) => ['Overdue: ', { b: name }, `'s "${task}" is one last step away.`],
      (name, task) => [`"${task}" is overdue. `, { b: name }, ', grab a sip of water, then hand it in in one go?'],
    ],
    waiting: (owner, title) => (owner ? ` (they're waiting for ${owner}'s "${title}")` : ` (they're waiting for "${title}")`),
  },
  ownerlessOverdue: (title) => [`"${title}" is overdue, and nobody ever took it.`],
  prereqBlocked: (waiting, prereq, days) => [
    `"${waiting}" has been held up by "${prereq}" for ${days === 1 ? '1 day' : `${days} days`}. Move it later?`,
  ],
  prereqAwaitingGrade: (waiting, prereq, days) => [
    `"${prereq}" was handed in but is still ungraded ${days === 1 ? '1 day' : `${days} days`} past its due date, and "${waiting}" is waiting for it.`,
  ],
  weekly: (w) => {
    const bits: string[] = [];
    if (w.finished > 0) bits.push(`${w.finished === 1 ? '1 task' : `${w.finished} tasks`} finished (+${w.finishedPts} pts)`);
    bits.push(`the team is at ${w.total} / 100 pts`);
    if (w.overdue > 0) bits.push(`${w.overdue} overdue`);
    if (w.next > 0) bits.push(`${w.next} due next week`);
    const parts: InlinePart[] = [{ b: w.tag ? `${w.tag} this week` : 'This week' }, `: ${bits.join('; ')}.`];
    if (w.top) parts.push(' ', { b: w.top.name }, ` earned the most this week (+${w.top.pts} pts).`);
    return parts;
  },
  projectDue: (tag, autoEnd) => [
    `${tag}'s deadline has come. If it was handed in, press End project; if nobody acts by `,
    { b: autoEnd },
    ', it ends by itself.',
  ],
  autoEndSoon: (tag) => [
    `${tag} ends by itself `,
    { b: 'tomorrow' },
    '. If it was handed in you can end it now; if not, you can push the deadline later.',
  ],
  projectEnded: (leader, tag, purge) => [
    'The leader, ',
    { b: leader },
    `, ended ${tag}. It will be deleted for good on ${purge}; until then you can see the results and download the report.`,
  ],
  projectEndedAuto: (tag, purge) => [
    `The leader didn't act for 7 days, so ${tag} ended by itself. It will be deleted for good on ${purge}; until then you can see the results and download the report.`,
  ],
  projectReopened: (leader, tag, deadline) => ['The leader, ', { b: leader }, `, reopened ${tag}. The new deadline is ${deadline}.`],
  deleteSoon: (tag, days) => [
    `${tag} will be deleted for good `,
    { b: days === 1 ? 'in 1 day' : `in ${days} days` },
    '. Remember to download the contribution report.',
  ],
  taskDelayed: (title, date, prereq) => [
    `The leader moved your "${title}" later, to `,
    { b: date },
    prereq ? ` (it's waiting for "${prereq}").` : '.',
  ],
};
