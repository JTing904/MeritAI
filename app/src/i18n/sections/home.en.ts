import type { homeZh } from './home.zh';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const month = (m: number) => MONTHS[m - 1] ?? String(m);

export const homeEn: typeof homeZh = {
  title: 'Home',
  myProfile: 'My profile',
  hello: { before: 'Hi, ', after: '!' },
  subIdle: 'Nothing due this week. Take a breather ☕',
  subWelcome: "Welcome to MeritAI. Start a project, or join a teammate's.",
  myProjects: 'My projects',
  card: {
    people: (n) => (n === 1 ? '1 person' : `${n} people`),
    peopleOf: (joined, size) => `${joined} / ${size} people`,
    youLead: "You're the leader",
    ledBy: (name) => `Leader: ${name}`,
    freePackages: (n) => (n === 1 ? '1 package not picked yet' : `${n} packages not picked yet`),
    myPackage: (n) => `Your package: Package ${n}`,
    noPackage: "You don't have a package yet",
    earned: (points) => `${points} / 100 pts`,
    daysLeft: (n) => (n === 1 ? '1 day left' : `${n} days left`),
    dueToday: 'Due today',
    pastDeadline: 'Past the deadline',
    awaitingYou: 'Past the deadline · waiting for you to confirm',
    awaitingLeader: 'Past the deadline · waiting for the leader',
    ended: 'Ended',
  },
  draft: {
    tag: 'Draft',
    notSplit: 'Not split yet',
    onlyYou: 'Only you can see it',
    lastEdited: (when, step) => `Last edited ${when} · stopped at step ${step}`,
    resume: 'Continue',
    delete: 'Delete draft',
    deleteTitle: (name) => `Delete the draft "${name}"?`,
    deleteBody: "Everything you filled in, tasks included, is deleted. This can't be undone.",
    deleted: 'Draft deleted',
  },
  when: {
    today: (time) => `today ${time}`,
    yesterday: (time) => `yesterday ${time}`,
    thisYear: (m, day, time) => `${month(m)} ${day}, ${time}`,
    older: (year, m, day) => `${month(m)} ${day}, ${year}`,
  },
  invite: {
    line: (inviter, project) => [{ b: inviter }, ' invited you to join ', { b: project }],
    decline: 'Decline',
    accept: 'Accept',
    declined: 'Invite declined',
  },
  empty: {
    title: 'No projects yet',
    body: 'Leading? Upload the assignment brief and MeritAI splits it into tasks and equal packages.\nJoining? Enter the invite code a teammate sent you.',
    demo: 'Try the sample project first',
    demoSub: "A pretend project. Tap anything; it doesn't affect anyone",
    demoSoon: 'The sample project is almost ready',
  },
  newProject: 'New project',
  joinByCode: 'Join with a code',
  fab: {
    label: 'New or join a project',
    title: 'What would you like to do?',
    newSub: "You're the leader: upload the brief and let AI split the tasks",
    joinSub: 'The invite code or link a teammate shared',
  },
};
