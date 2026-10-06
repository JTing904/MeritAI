import { Redirect } from 'expo-router';
import type { AiResplitProposal, ChoiceOptionView, NotificationView } from '@shared/types';
import { useState } from 'react';
import { View } from 'react-native';
import { Avatar, AvatarStack } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Card, List, Row, SectionHeader } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { Seg, Toggle } from '@/components/Controls';
import { Highlight } from '@/components/Highlight';
import { NetBar, NoNetworkScreen } from '@/components/NetStatus';
import { Rich } from '@/components/Rich';
import { AppBar, Screen } from '@/components/Screen';
import { Sheet, SheetOption } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { WhatsAppGlyph } from '@/components/WhatsAppGlyph';
import { ChoiceCard } from '@/features/ai/ChoiceCard';
import { modelName } from '@/features/ai/models';
import { AiTag, ErrCard, ErrList, PrivacyLine, UseBar } from '@/features/ai/parts';
import { AiDocScan, AiScanCard } from '@/features/ai/Scan';
import { ResplitQuestionBody, ResplitReadingBody, ResplitReviewBody, type Person } from '@/features/ai/ResplitParts';
import { reviewPlan, startDraft } from '@/features/ai/resplitPlan';
import { describeNotification } from '@/features/notifs/describe';
import { NotifCard } from '@/features/notifs/NotifCard';
import { FrozenLine } from '@/features/life/LifecycleCard';
import { useI18n } from '@/i18n';
import { useTheme } from '@/theme';
import { HIGHLIGHTERS } from '@/theme/tokens';

// Developer page: every shared component in both themes, to compare against the prototype on a real device.
// Sample names below are placeholders for the check only. Development builds only (the route is also guarded).
const SAMPLE_OPTION: ChoiceOptionView = {
  key: 'A',
  label: 'Carousell',
  summary: '马来西亚最多人用，公开资料和评测都多。',
  hours: 8,
  material: 'HIGH',
  difficulty: 'LOW',
  pros: [],
  cons: [],
  recommended: true,
  picked: false,
  taskCount: 2,
  points: 90,
  taskIds: [],
  lockedBy: null,
};

const SAMPLE_METHOD: ChoiceOptionView = {
  ...SAMPLE_OPTION,
  key: 'B',
  label: 'Agile（Scrum）',
  summary: '每两周做出一个能用的版本，再接着改。',
  hours: 140,
  pros: ['老师中途检查有东西看', '做错了早发现、早改'],
  cons: ['每周要开一次短会', '每轮都要重新排任务'],
};

// 让 AI 重新拆: a 4-person project, 2 tasks kept, 3 replaced, 4 new ones and one new 选择题.
const RESPLIT_PEOPLE: Record<string, Person> = {
  m1: { name: '陈思远', color: 'tang' },
  m2: { name: '林晓雯', color: 'lemon' },
  m3: { name: '张博文', color: 'mint' },
  m4: { name: '王子杰', color: 'sky' },
};
const DUE = new Date(Date.now() + 20 * 86_400_000).toISOString();
const newTask = (key: string, title: string, points: number, feature: string | null = null, packageIndex: number | null = null) => ({
  key,
  title,
  kind: 'DOC' as const,
  points,
  dueAt: DUE,
  feature,
  aiWritten: true,
  packageIndex,
  ownerMemberId: packageIndex ? `m${packageIndex}` : null,
});
const SAMPLE_RESPLIT: AiResplitProposal = {
  kept: [
    { taskId: 'k1', title: '登录与注册功能', kind: 'CODE', points: 200, pointsAfter: 200, packageIndex: 2, ownerMemberId: 'm2' },
    { taskId: 'k2', title: '用户访谈（5 位同学）', kind: 'RESEARCH', points: 150, pointsAfter: 150, packageIndex: 3, ownerMemberId: 'm3' },
  ],
  removed: [
    { taskId: 'r1', title: '写报告（第 1/3 部分）', kind: 'DOC', points: 250, packageIndex: 1, ownerMemberId: 'm1' },
    { taskId: 'r2', title: '做 App 界面', kind: 'DESIGN', points: 250, packageIndex: 4, ownerMemberId: 'm4' },
    { taskId: 'r3', title: '测试', kind: 'CODE', points: 150, packageIndex: 1, ownerMemberId: 'm1' },
  ],
  added: [
    newTask('b0', '报告：系统设计（架构图与数据库）', 200),
    newTask('b1', '演示与答辩：讲解自己的部分（第 1 份）', 80, '组员 1'),
    newTask('b2', '演示与答辩：讲解自己的部分（第 2 份）', 80, '组员 2'),
    newTask('b3', '测试：交易流程（下单到评价）', 140),
  ],
  newQuestions: [
    {
      id: 'n0',
      type: 'METHOD',
      prompt: '选一种部署方式',
      quote: 'Deploy the app using ONE of: Firebase Hosting, Render, or a campus server.',
      pickCount: 1,
      order: 0,
      options: [
        { ...SAMPLE_OPTION, key: 'A', label: 'Firebase Hosting', summary: '免费额度够用，教程最多。', hours: 4, recommended: true, tasks: [newTask('n0.A.0', '部署到 Firebase Hosting', 150)] },
        { ...SAMPLE_OPTION, key: 'B', label: 'Render', summary: '能放后端，免费版会休眠。', hours: 6, recommended: false, material: 'MID', difficulty: 'MID', tasks: [newTask('n0.B.0', '部署到 Render', 150)] },
      ],
    },
  ],
  keptQuestions: [{ questionId: 'q1', prompt: '5 个案例任选 2 个', pickedKeys: ['B', 'D'], pickedLabels: ['闲鱼', 'Mudah.my'] }],
  packages: [1, 2, 3, 4].map((index) => ({ index, packageId: `p${index}`, ownerMemberId: `m${index}`, pointsBefore: 250, pointsAfter: 250 })),
  version: 1,
};
const resplitNotif = (payload: NotificationView['payload'], audience: NotificationView['audience']): NotificationView => ({
  id: payload.type,
  type: payload.type,
  projectId: 'demo',
  projectTag: 'CS302',
  projectColor: 'sky',
  audience,
  mine: true,
  createdAt: new Date().toISOString(),
  read: false,
  payload,
  swap: null,
  projectOpen: true,
});

export default function GalleryRoute() {
  return __DEV__ ? <Gallery /> : <Redirect href="/" />;
}

function Gallery() {
  const { t } = useI18n();
  const { c } = useTheme();
  const toast = useToast();
  const [sheet, setSheet] = useState(false);
  const [seg, setSeg] = useState<'a' | 'b' | 'c'>('a');
  const [on, setOn] = useState(true);

  return (
    <Screen header={<AppBar title={t.dev.galleryTitle} />}>
      <Rich parts={['嗨，', { hl: 'lemon', text: '思远' }, '！']} />
      <Rich parts={['每包都是 ', { hl: 'gum', text: '20 分' }, '，\n挑你最想做的']} size={23} />
      <Highlight hl="mint" v="hero">
        Highlight across a long line that wraps onto the next line
      </Highlight>

      <SectionHeader title="荧光笔颜色（8 种）" />
      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {HIGHLIGHTERS.map((h) => (
            <View key={h} style={{ alignItems: 'center', gap: 4, width: 64 }}>
              <Avatar name={h} hl={h} />
              <Txt v="meta" size={11}>
                {h}
              </Txt>
            </View>
          ))}
          <View style={{ alignItems: 'center', gap: 4, width: 64 }}>
            <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: c.waiting }} />
            <Txt v="meta" size={11}>
              待选
            </Txt>
          </View>
        </View>
      </Card>

      <SectionHeader title="按钮" />
      <Card style={{ gap: 14 }}>
        <Button title="选我！" onPress={() => toast.show('🎉 任务包 2 是你的了！')} block />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <Button title="小按钮" small onPress={() => toast.show('小按钮')} />
          <Button title="次要" kind="soft" onPress={() => setSheet(true)} />
          <Button title="荧光" kind="hl" hl="gum" />
          <Button title="退出登录" kind="danger" />
          <Button title="不能按" disabled />
        </View>
      </Card>

      <SectionHeader title="标签和头像" action={<Txt v="label" color="grapeText">全部</Txt>} />
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <Chip>⏳ 3 天后</Chip>
          <Chip tone="good">优秀</Chip>
          <Chip tone="good">合格</Chip>
          <Chip tone="warn">拿一半</Chip>
          <Chip tone="bad">不通过</Chip>
          <Chip tone="grape">组长</Chip>
          <Chip hl="sky">CS302</Chip>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Avatar name="陈思远" hl="lemon" size="lg" />
          <AvatarStack
            people={[
              { name: '晓雯', hl: 'gum' },
              { name: '子杰', hl: 'mint' },
              { name: '博文', hl: 'sky' },
              { name: 'Ahmad', hl: 'tang' },
            ]}
          />
        </View>
      </Card>

      <SectionHeader title="M5 · 提醒和项目结束" />
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <Button title={t.notifs.actions.openTask} kind="soft" small />
          <Button title={t.notifs.actions.whatsapp} kind="soft" small icon={<WhatsAppGlyph size={16} />} />
          <Button title={t.notifs.actions.delay} small />
        </View>
        <FrozenLine />
      </Card>

      <SectionHeader title="M6 · AI" />
      <AiDocScan />
      <AiScanCard title={t.ai.reviewing.title} hint={t.ai.reviewing.hintMine} />
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <AiTag />
          <Chip tone="grape">
            {t.ai.reviewing.emoji} {t.ai.reviewing.chip}
          </Chip>
          <Chip tone="grape">{t.ai.choice.recommended}</Chip>
        </View>
        <PrivacyLine>{t.ai.project.privacy.GEMINI}</PrivacyLine>
        <UseBar label={t.ai.me.usageGood} count={t.ai.me.usageCount(4, 80)} ratio={4 / 80} />
        <UseBar label={t.ai.me.usageLight} count={t.ai.me.usageCount(8, 500)} ratio={8 / 500} color={c.hl.mint.base} />
        <Txt v="meta">
          {['gemini-3.8-flash', 'gemini-flash-lite-latest', 'claude-haiku-4-5', 'gpt-5-mini', 'mock-model'].map((m) => modelName(m, null)).join(' · ')}
        </Txt>
      </Card>
      <ErrCard tone="warn" title={t.ai.me.quotaTitle}>
        <ErrList label={t.ai.me.nowLabel} lines={t.ai.me.quotaNow(t.ai.me.backGemini)} />
      </ErrCard>
      <ChoiceCard option={SAMPLE_OPTION} method={false} on onPress={() => toast.show('A')} />
      <ChoiceCard option={{ ...SAMPLE_OPTION, key: 'B', recommended: false }} method={false} on locked mark={{ text: t.ai.rechoose.locked('张博文'), tone: 'default' }} />
      <ChoiceCard option={{ ...SAMPLE_OPTION, key: 'D', recommended: false }} method={false} on={false} dropped mark={{ text: t.ai.rechoose.drop, tone: 'bad' }} onPress={() => {}} />
      <ChoiceCard option={SAMPLE_METHOD} method on onPress={() => {}} />

      <SectionHeader title="M6 · 让 AI 重新拆" />
      <Card style={{ gap: 10 }}>
        <Button title={t.ai.resplit.tool} small disabled />
        <Txt v="meta">{t.ai.resplit.noKey}</Txt>
      </Card>
      <ResplitGallery />

      <SectionHeader title="列表" />
      <List>
        <Row title="市场规模调研" meta="💻 代码 · 贡献值 10 分" trailing={<Txt v="label" color="muted">明天</Txt>} onPress={() => toast.show('按到了')} />
        <Row title="竞品分析报告" meta="📄 文档 · 贡献值 12.5 分" trailing={<Chip tone="good">✅</Chip>} />
      </List>

      <SectionHeader title="切换" />
      <Card style={{ gap: 12 }}>
        <Seg label="示例" value={seg} onChange={setSeg} options={[{ value: 'a', label: '任务包' }, { value: 'b', label: '排行' }, { value: 'c', label: '动态' }]} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Txt v="text">推送通知</Txt>
          <Toggle value={on} onChange={setOn} label="推送通知" />
        </View>
      </Card>

      <SectionHeader title="文字" />
      <Card style={{ gap: 6 }}>
        <Txt v="big" tabular>
          25
        </Txt>
        <Txt v="grade" color="good">
          优秀
        </Txt>
        <Txt v="code">MKT-7Q4P</Txt>
        <Txt v="body">正文 Body text 15px Noto Sans SC</Txt>
        <Txt v="meta">说明文字 meta text</Txt>
        <Txt v="mono">a1b2c3d · +42 −7</Txt>
      </Card>

      <SectionHeader title="没有网络" />
      <Card style={{ gap: 12, padding: 0, overflow: 'hidden' }}>
        <NetBar phase="off" />
        <NetBar phase="back" />
        <View style={{ height: 520 }}>
          <NoNetworkScreen onRetry={() => toast.show(t.errors.OFFLINE)} />
        </View>
      </Card>

      <Sheet visible={sheet} onClose={() => setSheet(false)} title="要做什么？">
        <SheetOption emoji="✨" title="新建项目" sub="你当组长，上传作业要求让 AI 拆任务" onPress={() => setSheet(false)} />
        <SheetOption emoji="🔑" title="用邀请码加入" sub="组员分享给你的邀请码或链接" onPress={() => setSheet(false)} />
      </Sheet>
    </Screen>
  );
}

function ResplitGallery() {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => startDraft(SAMPLE_RESPLIT));
  const plan = reviewPlan(SAMPLE_RESPLIT, draft);
  const q = SAMPLE_RESPLIT.newQuestions[0]!;
  const notifs = [
    resplitNotif({ type: 'TASKS_RESPLIT', leader: { memberId: 'm1', name: '陈思远' }, kept: 2, removed: 3, added: 5, mine: { packageIndex: 2, removed: 0, added: 1, points: 253 } }, 'GROUP'),
    resplitNotif({ type: 'AI_RESPLIT_READY' }, 'ONLY_LEADER'),
    resplitNotif({ type: 'AI_RESPLIT_FAILED', reason: 'QUOTA', provider: 'GEMINI' }, 'ONLY_LEADER'),
  ];
  return (
    <>
      <ResplitReadingBody brief={{ source: 'SAVED', fileName: 'CS302_Assignment.pdf', lines: 312 }} keptCount={2} waitSec={null} pollFailed={false} />
      <ResplitQuestionBody
        question={q}
        index={0}
        count={1}
        picks={draft.answers[q.id] ?? []}
        keptQuestions={SAMPLE_RESPLIT.keptQuestions}
        onToggle={(key) => setDraft((d) => ({ ...d, answers: { ...d.answers, [q.id]: [key] } }))}
      />
      <ResplitReviewBody
        proposal={SAMPLE_RESPLIT}
        plan={plan}
        draft={draft}
        tz="Asia/Kuala_Lumpur"
        deadline={new Date(Date.now() + 40 * 86_400_000).toISOString()}
        person={(id) => (id ? (RESPLIT_PEOPLE[id] ?? null) : null)}
        chipOf={() => null}
        onEdit={() => {}}
        onDelete={(task) => setDraft((d) => ({ ...d, deleted: [...d.deleted, task.key] }))}
        onAdd={() => {}}
      />
      {notifs.map((n) => {
        const look = describeNotification(n, t.notifs, t.labels, t.ai);
        return look ? <NotifCard key={n.id} look={look} meta={n.projectTag ?? ''} unread busy={null} onOpen={null} onAction={() => {}} /> : null;
      })}
    </>
  );
}
