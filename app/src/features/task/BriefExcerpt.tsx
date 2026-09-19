import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { makeStyles, useTheme } from '@/theme';
import type { TaskCtx } from './model';
import { Bullets, CardHead, TextLink } from './parts';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    // `.brief .q`: a quote with a lemon bar on the left.
    quote: { paddingVertical: 2, paddingLeft: 12, borderLeftWidth: 3, borderLeftColor: c.hl.lemon.base, gap: 4 },
    // `.brief-c`: the collapsed card.
    compact: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16 },
    grow: { flex: 1, minWidth: 0, gap: 2 },
  }),
);

/**
 * 作业要求（原文）: the brief item this task came from, as a quote (first line bold, the rest as bullets).
 * Full on my own task before it's started (board 1); otherwise a one-line card that opens in place.
 */
export function BriefExcerpt({ ctx }: { ctx: TaskCtx }) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const k = t.task.brief;
  const { task, detail, project } = ctx;
  // Board 7 (a meeting) keeps the compact card even before it starts.
  const [open, setOpen] = useState(ctx.mine && task.status === 'TODO' && task.kind !== 'MEETING');

  if (!task.briefExcerpt) return null;
  const lines = task.briefExcerpt.split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return null;
  const [first, ...rest] = lines as [string, ...string[]];

  const openBrief = () =>
    router.push({ pathname: '/project/[id]/brief', params: { id: project.basics.id, task: task.id } });

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} role="button" aria-expanded={false} style={({ pressed }) => pressed && { opacity: 0.85 }}>
        <Card style={s.compact}>
          <View style={s.grow}>
            <Txt v="text" weight={700}>
              {k.title}
            </Txt>
            <Txt v="meta" numberOfLines={1}>
              {k.compact(first, rest.length)}
            </Txt>
          </View>
          <Icon name="chevron" size={18} color={c.muted} />
        </Card>
      </Pressable>
    );
  }

  // 这一项拆成了 N 个任务：…, in plan order with this task among them.
  let split: string | null = null;
  if (task.briefSplit && detail.briefSiblings.length > 0) {
    const order = new Map(project.tasks.map((x) => [x.id, x.order]));
    const parts = [
      ...detail.briefSiblings,
      { taskId: task.id, title: task.title, ownerMemberId: detail.owner?.memberId ?? null, ownerName: detail.owner?.name ?? null },
    ].sort((a, b) => (order.get(a.taskId) ?? 0) - (order.get(b.taskId) ?? 0));
    const text = parts
      .map((p) => {
        const who = p.ownerMemberId === ctx.viewerId ? k.you : p.ownerName;
        return who ? k.part(p.title, who) : p.title;
      })
      .join(k.sep);
    split = k.split(parts.length, text);
  }

  return (
    <Card style={{ gap: 10 }}>
      <CardHead title={k.title} action={project.briefAvailable ? <TextLink title={k.full} onPress={openBrief} /> : undefined} />
      <View style={s.quote}>
        <Txt v="small" weight={700}>
          {first}
        </Txt>
        {rest.length > 0 ? <Bullets lines={rest} /> : null}
      </View>
      {split ? <Txt v="meta">{split}</Txt> : null}
    </Card>
  );
}
