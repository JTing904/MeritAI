import { homeEn } from './sections/home.en';
import { joinEn } from './sections/join.en';
import { labelsEn } from './sections/labels.en';
import { membersEn } from './sections/members.en';
import { notifsEn } from './sections/notifs.en';
import { pickEn } from './sections/pick.en';
import { pickerEn } from './sections/picker.en';
import { projectEn } from './sections/project.en';
import { wizardEn } from './sections/wizard.en';
import type { Messages } from './zh';

// English copy. Drafted by the developer; the user reviews it before launch.
export const en: Messages = {
  tabs: { home: 'Home', tasks: 'Tasks', notifs: 'Notifications', me: 'Me', nav: 'Main navigation', unread: (n) => `${n} unread` },
  common: {
    back: 'Back',
    close: 'Close',
    retry: 'Try again',
    options: 'Options',
    cancel: 'Cancel',
  },
  startup: {
    unreachableTitle: "Can't reach the server",
    unreachableBody: "You're still signed in. Check your connection, or try again once the server is back.",
  },
  login: {
    devTitle: 'Pick a test person',
    devHint: 'Developer one-tap login, only shown while testing. The real app uses GitHub / Google sign-in.',
    devEmpty: 'No test people in the database yet. Run npm run db:seed on the computer first.',
    devUnavailable: "This server doesn't have one-tap login turned on.",
    signingIn: 'Signing in…',
  },
  labels: labelsEn,
  home: homeEn,
  wizard: wizardEn,
  join: joinEn,
  project: projectEn,
  pick: pickEn,
  picker: pickerEn,
  members: membersEn,
  notifs: notifsEn,
  tasks: { title: 'My tasks' },
  me: {
    title: 'Me',
    appearance: 'Appearance',
    themeSystem: 'System',
    themeLight: 'Light',
    themeDark: 'Dark',
    language: 'Language',
    server: 'Server',
    serverOk: 'Connected',
    serverDown: 'Unreachable',
    serverChecking: 'Checking…',
    serverDbDown: 'Database unreachable',
    version: (v) => `Version ${v}`,
    gallery: 'Component styles (dev)',
    push: 'Push notifications',
    pushSub: 'Tasks due soon, overdue tasks, swap requests',
    weekly: 'Weekly progress summary',
    weeklySub: 'Sundays at 8 pm',
    signOut: 'Sign out',
    signOutTitle: 'Sign out?',
    signOutBody: "You'll need to sign in again on this device to see your projects.",
    devTools: 'Developer tools',
  },
  dev: {
    building: 'This page is still being built',
    buildingHint: (milestone) => `It arrives in ${milestone}. For now, check the look and the switches.`,
    galleryTitle: 'Component styles',
  },
  errors: {
    NETWORK: "Can't reach the server. Check your connection.",
    BAD_RESPONSE: "The server's reply didn't make sense. Try again later.",
    BAD_REQUEST: 'Something was wrong with that request. Try again.',
    VALIDATION: "Some fields aren't right. Check them and try again.",
    UNAUTHENTICATED: 'Your session expired. Sign in again.',
    FORBIDDEN: "You don't have permission to do that.",
    NOT_FOUND: "That doesn't exist anymore.",
    CONFLICT: 'Someone just changed this. Refresh and try again.',
    RATE_LIMITED: 'Too many tries. Wait a moment and try again.',
    INTERNAL: 'The server hit an error. Try again later.',
    INVITE_CODE_INVALID: "We can't find that invite code. Check it for typos.",
    INVITE_CODE_EXPIRED: 'That invite code has expired: the leader made a new one.',
    REMOVED_FROM_PROJECT: 'The leader removed you from this project, so the invite code no longer works for you.',
    PROJECT_ENDED: 'This project has ended and no longer takes new members.',
    NOT_A_DRAFT: "This project is already set up; it can't be changed through the new-project steps.",
    PLAN_EMPTY: 'Add at least one task before splitting into packages.',
    DEADLINE_IN_PAST: 'The deadline has to be in the future.',
    DUE_AFTER_DEADLINE: "A task can't be due after the project deadline.",
    TASK_LOCKED: "This task has started or finished, so it can't be deleted and its points can't change.",
    PACKAGE_TAKEN: 'Someone just took this package',
    PACKAGE_STARTED: "You've started, so you can't switch packages",
    TARGET_STARTED: "They've started, so you can't swap",
    NEEDS_OWN_PACKAGE: 'Pick a package first, then you can ask to swap',
    SWAP_LIMIT: 'You can only have one swap request at a time. Cancel the other one first',
    SWAP_NOT_PENDING: 'This swap request was already handled or has expired',
    ALREADY_HAS_PACKAGE: 'They already have a package',
    LEADER_ONLY_MANAGES: "A leader who only manages doesn't pick a package",
    LEADER_MUST_TRANSFER: "You're the leader. Hand the leader role to someone else before you leave",
    TASK_FINISHED: "This task is finished, so it can't be moved",
    STALE_PREVIEW: 'Something changed. Check the preview again',
    TEAM_FULL: 'This project already has 8 people',
  },
};
