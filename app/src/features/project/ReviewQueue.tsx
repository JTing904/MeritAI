import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { PendingReview, ProjectView } from '@shared/types';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { dateTimeLabel } from '@/lib/time';
import { makeStyles, useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import { memberById, useLocalDates } from './parts';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    card: { backgroundColor: c.card, borderRadius: radius.card, boxShadow: c.shadow, overflow: 'hidden' },
    // The mockup's `.queue .qh`: a grape-soft header bar with the count and a chevron.
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: c.grapeSoft,
      paddingVertical: 12,
      paddingHorizontal: 16,
    },
    headPressed: { opacity: 0.85 },
    divider: { height: 1, backgroundColor: c.line },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14 },
    grow: { flex: 1, minWidth: 0, gap: 2 },
    title: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 2 },
    noAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: c.waiting },
  }),
);

/**
 * 待我审核 · {n} on the project page (leader, board 12): the submissions waiting for a grade, oldest first.
 * Open by default; collapsing it lasts while the page is mounted. 评级 opens the task page with `?grade=1`.
 */
export function ReviewQueue({ project }: { project: ProjectView }) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const q = t.project.queue;
  const [open, setOpen] = useState(true);

  const reviews = project.pendingReviews;
  // Also on an ENDED project: the leader may still grade what was handed in before it ended.
  if (project.viewerRole !== 'LEADER' || project.basics.status === 'DRAFT' || reviews.length === 0) return null;
  const title = q.title(reviews.length);

  return (
    <View style={s.card}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        role="button"
        aria-expanded={open}
        aria-label={title}
        style={({ pressed }) => [s.head, pressed && s.headPressed]}>
        <Txt v="body" weight={800} color="grapeText" style={{ flex: 1 }}>
          {title}
        </Txt>
        <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
          <Icon name="chevron" size={18} color={c.grapeText} />
        </View>
      </Pressable>
      {open
        ? reviews.map((review) => (
            <View key={`${review.taskId}:${review.attemptNo}`}>
              <View style={s.divider} />
              <ReviewRow project={project} review={review} />
            </View>
          ))
        : null}
    </View>
  );
}

function ReviewRow({ project, review }: { project: ProjectView; review: PendingReview }) {
  const s = useStyles();
  const { t } = useI18n();
  const q = t.project.queue;
  const dates = useLocalDates();
  const owner = memberById(project, review.ownerMemberId);
  const name = owner?.name ?? t.project.task.noOwner;
  const meta = q.meta(name, dateTimeLabel(review.submittedAt, t.labels.when), review.evidenceCount, review.late ? dates.date(review.dueAt) : null);
  const grade = () =>
    router.push({ pathname: '/project/[id]/task/[taskId]', params: { id: project.basics.id, taskId: review.taskId, grade: '1' } });

  return (
    <View style={s.row}>
      {owner ? <Avatar name={owner.name} hl={owner.color} decorative /> : <View style={s.noAvatar} />}
      <View style={s.grow}>
        <View style={s.title}>
          <Txt v="rowTitle">{review.title}</Txt>
          {review.late ? <Chip tone="bad">{q.late}</Chip> : null}
        </View>
        <Txt v="meta">{meta}</Txt>
      </View>
      <Button title={q.grade} small accessibilityLabel={q.gradeLabel(review.title, name)} onPress={grade} />
    </View>
  );
}
