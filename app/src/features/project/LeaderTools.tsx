import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ProjectView } from '@shared/types';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { errorCode } from '@/lib/api';
import { isLive } from '@/lib/lifecycle';
import { makeStyles, useTheme } from '@/theme';
import { RechooseSheet } from '@/features/ai/RechooseSheet';
import { ResplitStartSheet } from '@/features/ai/ResplitStartSheet';
import { TextLink } from '@/features/task/parts';
import { AddTaskSheet } from './AddTaskSheet';
import { ResplitSheet } from './ResplitSheet';

const useStyles = makeStyles(() =>
  StyleSheet.create({
    card: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
    head: { flexBasis: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  }),
);

export type LeaderToolsProps = {
  project: ProjectView;
  /** Called with the fresh view after 加任务 or 重新分包. */
  onChange: (view: ProjectView) => void;
  /** 'pick' (on the pick screen) leaves out the hint sentence about 「⋯」. */
  variant: 'project' | 'pick';
  /** useProject's onError, so a failed write reloads like the rest of the screen. */
  onError?: (err: unknown) => void;
};

/**
 * 组长工具 card: 加任务 / 重新分包 / M6 改选 / ✨ 让 AI 重新拆 (+ their sheets). Only the leader of a running project sees it
 * (renders nothing otherwise), on the project page and on the pick screen.
 */
export function LeaderTools({ project, onChange, variant, onError }: LeaderToolsProps) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const lt = t.project.tools;
  const { show } = useToast();
  const [open, setOpen] = useState<'add' | 'resplit' | 'rechoose' | 'aiResplit' | null>(null);

  if (project.viewerRole !== 'LEADER' || !isLive(project.basics.status)) return null;

  const fail = onError ?? ((err: unknown) => show(t.errors[errorCode(err)]));
  const close = () => setOpen(null);
  // 让 AI 重新拆 needs the leader's key, saved and not refused (a key out of quota is still tried, as the server does).
  const ai = project.ai;
  const keyOk = ai.configured && ai.status !== 'INVALID';
  const r = t.ai.resplit;

  return (
    <Card style={s.card}>
      <View style={s.head}>
        <Txt v="text" weight={700}>
          {lt.title}
        </Txt>
        <Chip tone="grape">{lt.onlyYou}</Chip>
      </View>
      <Button
        title={lt.addTask}
        kind="soft"
        small
        icon={<Icon name="plus" size={16} color={c.ink} />}
        onPress={() => setOpen('add')}
      />
      <Button
        title={lt.resplit}
        kind="soft"
        small
        icon={<Icon name="shuffle" size={16} color={c.ink} />}
        onPress={() => setOpen('resplit')}
      />
      {/* M6: 改选 a 选择题 the AI found (only projects that have any). */}
      {project.choices.length > 0 ? (
        <Button
          title={t.ai.rechoose.tool}
          kind="soft"
          small
          icon={<Icon name="sparkle" size={16} color={c.ink} />}
          onPress={() => setOpen('rechoose')}
        />
      ) : null}
      {/* M6 follow-up: the AI splits the unstarted tasks again (greyed out without a usable key). */}
      <Button
        title={r.tool}
        small
        disabled={!keyOk}
        onPress={() => setOpen('aiResplit')}
      />
      {!keyOk ? (
        <View style={{ flexBasis: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 4 }}>
          <Txt v="meta">{ai.configured && ai.provider ? r.invalid(t.ai.provider[ai.provider]) : r.noKey}</Txt>
          <TextLink title={ai.configured ? r.invalidLink : r.noKeyLink} onPress={() => router.navigate('/me')} />
        </View>
      ) : null}
      {variant === 'project' ? (
        <Txt v="meta" style={{ flexBasis: '100%' }}>
          {lt.hint}
        </Txt>
      ) : null}

      {open === 'add' ? <AddTaskSheet project={project} onClose={close} onChange={onChange} onError={fail} /> : null}
      {open === 'resplit' ? <ResplitSheet project={project} onClose={close} onChange={onChange} onError={fail} /> : null}
      {open === 'rechoose' ? <RechooseSheet project={project} onClose={close} onChange={onChange} onError={fail} /> : null}
      {open === 'aiResplit' ? <ResplitStartSheet project={project} onClose={close} /> : null}
    </Card>
  );
}
