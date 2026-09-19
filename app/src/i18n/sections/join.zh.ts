// Copy for the join screens (owned by the join feature).
export const joinZh = {
  appbar: '用邀请码加入',
  title: { before: '输入', hl: '邀请码' },
  label: '邀请码',
  placeholder: 'MKT-7Q4P',
  hint: '组员分享给你的邀请码；点邀请链接的话会自动填好。',
  looking: '正在找这个邀请码…',
  join: '加入这个项目',
  open: '打开这个项目',
  alreadyMember: '你已经在这个项目里了。',
  joined: (name: string) => `已加入「${name}」，记得去选任务包`,
  joinedNoPick: (name: string) => `已加入「${name}」`,
};
