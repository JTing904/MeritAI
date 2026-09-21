import type { lifeZh } from './life.zh';

const days = (n: number) => (n === 1 ? '1 day' : `${n} days`);
const tasks = (n: number) => (n === 1 ? '1 task' : `${n} tasks`);

export const lifeEn: typeof lifeZh = {
  frozen: 'Ended: read-only',

  due: {
    leaderTitle: 'The deadline has passed. Was it handed in?',
    leaderBody:
      'If it was, press End project. After that everyone has 14 days to see the results and download the contribution report, then the whole project is deleted (badges stay).',
    end: 'End project',
    extend: 'Push the deadline later',
    leaderAuto: (date) => [
      "If you don't act by ",
      { b: date },
      ', it ends by itself, as if it was handed in. Until it ends, everyone can still hand in evidence and you can grade as usual.',
    ],
    memberTitle: 'The deadline has passed',
    memberBody: (leader, date) => [
      ...(leader
        ? ['Waiting for the leader, ', { b: leader }, ', to confirm it was handed in. ']
        : ['Waiting for the leader to confirm it was handed in. ']),
      "If the leader doesn't act by ",
      { b: date },
      ', it ends by itself.',
    ],
    memberHint: "Until it ends you can still hand in evidence; after that it's read-only.",
  },

  ended: {
    title: (date) => `Project ended · ${date}`,
    titleAuto: (date) => `Project ended by itself · ${date}`,
    autoLine: "The leader didn't act for 7 days, so the project ended by itself.",
    body: (date, n) => [
      'It will be deleted for good on ',
      { b: date },
      n > 0 ? ` (${days(n)} left). ` : ' (today). ',
      'Until then everyone can see the results and download the contribution report. Badges stay.',
    ],
    report: 'Download contribution report',
    reopen: 'Reopen',
  },

  end: {
    title: 'End project',
    heading: (tag) => `End ${tag}?`,
    notify: 'The whole team is told right away.',
    frozen: (pending) =>
      pending > 0
        ? [
            "After that it's read-only: no more evidence, grade changes or moving tasks. The ",
            { b: tasks(pending) },
            ' waiting for your grade can still be graded.',
          ]
        : ["After that it's read-only: no more evidence, grade changes or moving tasks."],
    purge: (date) => [
      'On ',
      { b: date },
      ' (in 14 days) the project, its tasks and files are deleted for good; until then everyone can see the results and download the contribution report. Badges stay.',
    ],
    undo: 'Pressed it by mistake? You can Reopen it from the project page within 14 days.',
    confirm: 'End it',
    done: (tag) => `${tag} ended`,
  },

  reopen: {
    title: 'Reopen',
    heading: (tag) => `Reopen ${tag}?`,
    passed: (date) => `The deadline (${date}) has passed. Pick a new deadline first.`,
    ahead: (date) => `The deadline, ${date}, hasn't come yet. You can keep it, or pick a new one now.`,
    label: 'New deadline',
    labelOptional: 'Deadline',
    after: 'Has to be after today',
    unchanged: 'unchanged',
    change: 'Change',
    pick: 'Pick a date',
    hint: "Once it's reopened everyone can hand in evidence and grade again, the deletion countdown stops and the whole team is told. If nobody acts for 7 days after the deadline, it ends by itself again.",
    confirm: 'Reopen',
    done: (tag) => `${tag} reopened`,
    doneMoved: (tag, moved) => `${tag} reopened. ${moved}`,
  },

  delay: {
    title: 'Delay with one tap',
    link: 'Delay it',
    heading: (task) => `Move "${task}" later?`,
    blocked: (prereq, prereqOwner, n, owner, task) => {
      const who = prereqOwner ? ` (${prereqOwner})` : '';
      const waiter = owner ? `${owner}'s "${task}"` : `"${task}"`;
      return n > 0
        ? `"${prereq}"${who} has been overdue for ${days(n)}, and ${waiter} has been waiting for it all along.`
        : `${waiter} is waiting for "${prereq}"${who}.`;
    },
    label: (task) => `New due date for "${task}"`,
    was: (date, n) => `Was ${date} · ${days(n)} later`,
    chips: 'How many days later',
    plus: (n) => `+${days(n)}`,
    plusBlocked: (n) => `+${days(n)} (days blocked)`,
    change: 'Change',
    hint: (deadline, owner) => `Never after the project deadline, ${deadline}.${owner ? ` ${owner} will be notified.` : ''}`,
    atDeadline: "It's already due on the project deadline. To move it later, change the project deadline first.",
    confirm: (date) => `Move to ${date}`,
    cancel: 'Not now',
    done: (date) => `Moved to ${date}`,
  },

  timeMachine: {
    title: 'Time machine',
    hint: 'Moves the server clock and runs the reminders once right after. Restarting the server brings it back to now.',
    now: (time) => `Server time: ${time}`,
    offset: (text) => `${text} ahead`,
    behind: (text) => `${text} behind`,
    none: 'No offset (real time)',
    days: (d) => days(d),
    hours: (h) => (h === 1 ? '1 hour' : `${h} hours`),
    minutes: (m) => (m === 1 ? '1 minute' : `${m} minutes`),
    hour: '+1 hour',
    day: '+1 day',
    week: '+7 days',
    sunday: 'Next Sunday 20:05',
    reset: 'Reset',
    unavailable: "This server doesn't have the developer tools on (DEV_LOGIN=true and APP_ENV=development).",
    loading: 'Loading…',
    ticked: (n) => (n > 0 ? `Jumped; ${n === 1 ? '1 reminder' : `${n} reminders`} sent` : 'Jumped; no reminders to send'),
  },
};
