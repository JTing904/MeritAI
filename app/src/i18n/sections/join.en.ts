import type { joinZh } from './join.zh';

export const joinEn: typeof joinZh = {
  appbar: 'Join with a code',
  title: { before: 'Enter the ', hl: 'invite code' },
  label: 'Invite code',
  placeholder: 'MKT-7Q4P',
  hint: 'The invite code a teammate shared. Opening their invite link fills it in for you.',
  looking: 'Looking up this code…',
  join: 'Join this project',
  open: 'Open this project',
  alreadyMember: "You're already in this project.",
  joined: (name) => `Joined "${name}". Remember to pick a package.`,
  joinedNoPick: (name) => `Joined "${name}".`,
};
