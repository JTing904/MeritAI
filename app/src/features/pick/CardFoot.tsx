import { StyleSheet, View } from 'react-native';
import type { PackageView, ProjectView } from '@shared/types';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { makeStyles } from '@/theme';
import type { Highlighter } from '@/theme/tokens';
import type { PickFoot } from './foot';
import { SwapActions } from './SwapActions';

const useStyles = makeStyles(() =>
  StyleSheet.create({
    ownerLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    mine: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  }),
);

/** What the viewer can do with one package, under its tasks (spec §10 pick screen, "Foot"). */
export function CardFoot({
  project,
  pkg,
  foot,
  myColor,
  busy,
  onPick,
  onRequestSwap,
  onOpenTask,
  onChange,
  onError,
}: {
  project: ProjectView;
  pkg: PackageView;
  foot: PickFoot;
  /** The viewer's colour: a free package would become theirs. */
  myColor: Highlighter;
  /** The pick or swap request in flight (`pick:<packageId>` / `swap:<packageId>`), if any. */
  busy: string | null;
  onPick: (pkg: PackageView) => void;
  onRequestSwap: (pkg: PackageView) => void;
  onOpenTask: (taskId: string) => void;
  onChange: (view: ProjectView) => void;
  onError: (err: unknown) => void;
}) {
  const s = useStyles();
  const { t } = useI18n();
  const p = t.pick;
  const me = project.members.find((m) => m.id === project.viewerMemberId);
  const waiting = (key: string) => ({ disabled: busy !== null && busy !== key, loading: busy === key });

  if (foot.kind === 'mine') {
    return (
      <>
        <View style={s.ownerLine}>
          {me && <Avatar name={me.name} hl={me.color} size="sm" decorative />}
          <View style={s.mine}>
            <Txt v="label" color="ink" style={{ flexShrink: 1 }}>
              {p.mine.text}
            </Txt>
            <Txt v="label" color="ink" aria-hidden>
              {p.mine.emoji}
            </Txt>
          </View>
        </View>
        {foot.firstTaskId && (
          <Button title={p.goMyTasks} kind="soft" block onPress={() => onOpenTask(foot.firstTaskId!)} />
        )}
      </>
    );
  }

  if (foot.kind === 'free') {
    if (foot.action === 'managesOnly') {
      return (
        <Txt v="meta" center>
          {p.managesOnly}
        </Txt>
      );
    }
    const pickKey = `pick:${pkg.id}`;
    return (
      <>
        <Button
          title={foot.action === 'pick' ? p.pickMe : p.switchTo}
          kind="hl"
          hl={myColor}
          block
          {...(foot.action === 'locked' ? { disabled: true } : waiting(pickKey))}
          onPress={() => onPick(pkg)}
        />
        {foot.action !== 'pick' && (
          <Txt v="meta" center>
            {foot.action === 'locked' ? p.cantSwitch : p.canSwitch}
          </Txt>
        )}
      </>
    );
  }

  const { owner, action } = foot;
  const ownerLine = (
    <View style={s.ownerLine}>
      {owner && <Avatar name={owner.name} hl={owner.color} size="sm" decorative />}
      <Txt v="label" weight={400} color="muted" style={{ flexShrink: 1 }}>
        {p.takenBy(owner?.name ?? '')}
        {foot.started ? p.takenStarted : ''}
      </Txt>
    </View>
  );

  if (action.kind === 'swap') {
    return (
      <>
        {ownerLine}
        <SwapActions swap={action.swap} project={project} onChange={onChange} onError={onError} />
      </>
    );
  }
  if (action.kind === 'none') return ownerLine;
  if (action.kind === 'blocked') {
    const label = { theirsStarted: p.theyStarted, mineStarted: p.youStarted, oneRequest: p.oneRequest }[action.reason];
    return (
      <>
        {ownerLine}
        <Button title={label} kind="soft" block disabled />
      </>
    );
  }
  const swapKey = `swap:${pkg.id}`;
  return (
    <>
      {ownerLine}
      <Button
        title={`${p.requestSwap.emoji} ${p.requestSwap.text}`}
        accessibilityLabel={p.requestSwap.text}
        kind="soft"
        block
        {...waiting(swapKey)}
        onPress={() => onRequestSwap(pkg)}
      />
    </>
  );
}
