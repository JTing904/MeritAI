// Chinese copy (primary; taken verbatim from the approved prototype where it exists).
// en.ts must have exactly the same shape; a missing English string is a type error.
// Feature copy lives in ./sections/<feature>.zh.ts so features can grow independently.
import { homeZh } from './sections/home.zh';
import { joinZh } from './sections/join.zh';
import { labelsZh } from './sections/labels.zh';
import { membersZh } from './sections/members.zh';
import { notifsZh } from './sections/notifs.zh';
import { pickZh } from './sections/pick.zh';
import { pickerZh } from './sections/picker.zh';
import { projectZh } from './sections/project.zh';
import { wizardZh } from './sections/wizard.zh';

export const zh = {
  tabs: { home: '首页', tasks: '任务', notifs: '通知', me: '我', nav: '主导航', unread: (n: number) => `${n} 条未读` },
  common: {
    back: '返回',
    close: '关闭',
    retry: '再试一次',
    options: '选项',
    cancel: '取消',
  },
  startup: {
    unreachableTitle: '连不上服务器',
    unreachableBody: '你的登录还在。检查一下网络，或等服务器恢复后再试一次。',
  },
  login: {
    devTitle: '选一个测试身份',
    devHint: '开发用的一键登录，只在测试时出现。正式版会换成 GitHub / Google 登录。',
    devEmpty: '数据库里还没有测试身份，请先在电脑上运行 npm run db:seed。',
    devUnavailable: '这个服务器没有开启一键登录。',
    signingIn: '正在登录…',
  },
  labels: labelsZh,
  home: homeZh,
  wizard: wizardZh,
  join: joinZh,
  project: projectZh,
  pick: pickZh,
  picker: pickerZh,
  members: membersZh,
  notifs: notifsZh,
  tasks: { title: '我的任务' },
  me: {
    title: '我',
    appearance: '外观',
    themeSystem: '跟随系统',
    themeLight: '浅色',
    themeDark: '深色',
    language: '语言',
    server: '服务器',
    serverOk: '正常',
    serverDown: '连不上',
    serverChecking: '检查中…',
    serverDbDown: '数据库连不上',
    version: (v: string) => `版本 ${v}`,
    gallery: '组件样式（开发用）',
    push: '推送通知',
    pushSub: '任务快到期、过期、换包请求',
    weekly: '每周进度小结',
    weeklySub: '每周日晚上 8 点',
    signOut: '退出登录',
    signOutTitle: '确定要退出登录吗？',
    signOutBody: '退出后，这台设备要重新登录才能看到你的项目。',
    devTools: '开发工具',
  },
  dev: {
    building: '这一页还在做',
    buildingHint: (milestone: string) => `会在 ${milestone} 做好。现在先检查外观和切换。`,
    galleryTitle: '组件样式',
  },
  errors: {
    NETWORK: '连不上服务器，请检查网络。',
    BAD_RESPONSE: '服务器回复看不懂，请稍后再试。',
    BAD_REQUEST: '请求有问题，请再试一次。',
    VALIDATION: '有些内容填得不对，请检查一下。',
    UNAUTHENTICATED: '登录已过期，请重新登录。',
    FORBIDDEN: '你没有权限做这件事。',
    NOT_FOUND: '找不到这个内容，可能已经被删掉了。',
    CONFLICT: '刚刚有人改过，请刷新后再试。',
    RATE_LIMITED: '操作太频繁了，请稍后再试。',
    INTERNAL: '服务器出错了，请稍后再试。',
    INVITE_CODE_INVALID: '找不到这个邀请码，请检查一下有没有打错。',
    INVITE_CODE_EXPIRED: '这个邀请码已经失效了，组长换了新的邀请码。',
    REMOVED_FROM_PROJECT: '你已经被组长移出这个项目，不能再用邀请码加入。',
    PROJECT_ENDED: '这个项目已经结束了，不能再加入。',
    NOT_A_DRAFT: '这个项目已经建好了，不能再用新建流程修改。',
    PLAN_EMPTY: '还没有任务，至少要有一个任务才能分包。',
    DEADLINE_IN_PAST: '截止日期要在现在之后。',
    DUE_AFTER_DEADLINE: '任务的截止日期不能晚于项目截止日期。',
    TASK_LOCKED: '这个任务已经开始或完成了，不能删除或改分数。',
    PACKAGE_TAKEN: '这个任务包刚被别人选走了',
    PACKAGE_STARTED: '你已开工，不能换包',
    TARGET_STARTED: '对方已开工，不能互换',
    NEEDS_OWN_PACKAGE: '先选一个任务包，才能申请互换',
    SWAP_LIMIT: '一次只能申请一个互换，先取消原来的申请',
    SWAP_NOT_PENDING: '这个互换请求已经处理过或失效了',
    ALREADY_HAS_PACKAGE: 'TA 已经有任务包了',
    LEADER_ONLY_MANAGES: '只管理的组长不用选任务包',
    LEADER_MUST_TRANSFER: '你是组长，要先把组长转给别人才能退出',
    TASK_FINISHED: '这个任务已经完成，不能移动',
    STALE_PREVIEW: '情况有变，请重新看一下预览',
    TEAM_FULL: '这个项目已经 8 个人了，不能再加入',
  },
};

export type Messages = typeof zh;
