import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { useTheme } from '@/theme';
import { OptRow, OptTile } from './OptRow';

/**
 * The leader taps 「退出项目」 (LeaderLeave mockup): 「我自己退出」 (pick the next leader) or 「为所有人删除项目」.
 * `canHandOver` false (nobody else is active): only the delete row.
 */
export function LeaderLeaveSheet({
  visible,
  tag,
  canHandOver,
  onClose,
  onLeave,
  onDelete,
}: {
  visible: boolean;
  tag: string;
  canHandOver: boolean;
  onClose: () => void;
  onLeave: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const { c } = useTheme();
  const l = t.members.leaderLeave;
  return (
    <Sheet visible={visible} onClose={onClose} title={l.title(tag)}>
      <Txt v="small" color="ink2">
        {l.body}
      </Txt>
      {canHandOver ? (
        <OptRow
          leading={
            <OptTile>
              <Icon name="door" size={20} color={c.ink2} />
            </OptTile>
          }
          title={l.self}
          sub={l.selfSub}
          onPress={onLeave}
        />
      ) : null}
      <OptRow
        leading={
          <OptTile>
            <Icon name="trash" size={20} color={c.bad} />
          </OptTile>
        }
        title={l.deleteAll}
        sub={l.deleteAllSub}
        danger
        onPress={onDelete}
      />
      <Txt v="meta">{l.hint}</Txt>
    </Sheet>
  );
}
