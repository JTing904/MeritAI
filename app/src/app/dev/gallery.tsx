import { Redirect } from 'expo-router';
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
import { FrozenLine } from '@/features/life/LifecycleCard';
import { useI18n } from '@/i18n';
import { useTheme } from '@/theme';
import { HIGHLIGHTERS } from '@/theme/tokens';

// Developer page: every shared component in both themes, to compare against the prototype on a real device.
// Sample names below are placeholders for the check only. Development builds only (the route is also guarded).
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
