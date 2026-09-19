import type { pickZh } from './pick.zh';

const intro =
  "Swipe to look around. Until you've started, you can switch straight to a package nobody picked. To swap with someone's package, they have to agree, and neither package can have started.";

export const pickEn: typeof pickZh = {
  title: 'Pick a package',
  sub: (tag, people) => `${tag} · ${people === 1 ? '1 person' : `${people} people`} · first come, first served`,
  settings: 'Project settings',
  titleEqual: 'Each package is worth ',
  titleAbout: 'Each package is about ',
  titleHl: (points) => `${points} pts`,
  titleUneven: 'The packages differ in points',
  titleEnd: '.\nPick the one you want most',
  intro,
  introUneven: (max, min) => `The biggest is ${max} pts and the smallest ${min} pts. ${intro}`,

  card: {
    hours: (h) => (h === 1 ? 'About 1 hour' : `About ${h} hours`),
    unit: 'pts',
    contribution: 'Points',
  },

  mine: { text: 'This is your package', emoji: '✓' },
  goMyTasks: 'See my tasks',
  takenBy: (name) => `Taken by ${name}`,
  takenStarted: ' · started',
  pickMe: 'Pick me!',
  switchTo: 'Switch to this one',
  canSwitch: "You haven't started, so you can switch straight away",
  cantSwitch: "You've started, so you can't switch packages",
  managesOnly: "A leader who only manages doesn't pick a package",
  requestSwap: { emoji: '🔁', text: 'Ask to swap' },
  theyStarted: "They've started, so you can't swap",
  youStarted: "You've started, so you can't swap",
  oneRequest: 'You can only ask for one swap at a time',

  swap: {
    incoming: (name) => `${name} wants to swap with you`,
    decline: 'Decline',
    accept: 'Accept swap',
    waiting: { emoji: '⏳', text: (name) => `Swap requested, waiting for ${name} to agree` },
    cancel: 'Cancel request',
    hint: 'It expires after 3 days without an answer, or as soon as either of you starts a task or switches packages.',
  },

  toast: {
    picked: (n) => `🎉 Package ${n} is yours!`,
    switched: (n) => `Switched. Package ${n} is yours now`,
    requested: (name) => `Swap request sent to ${name}. Nothing changes unless they agree`,
    accepted: (n) => `Swapped! Package ${n} is yours now`,
    declined: 'Swap declined',
    cancelled: 'Swap request cancelled',
  },

  dueHint: {
    ai: 'AI suggested these due dates from the milestones. The leader can change them.',
    rules: 'Due dates are spread evenly up to the project deadline. The leader can change them.',
  },
};
