import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import type { EvidenceView } from '@shared/types';
import { Icon, type IconName } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { makeStyles, useTheme } from '@/theme';
import { evidenceMeta, fileFamily } from './upload';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    // The mockup's `.file-chip`.
    row: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, backgroundColor: c.card2 },
    main: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
    pressed: { opacity: 0.8 },
    ico: { width: 38, height: 38, borderRadius: 11, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    grow: { flex: 1, minWidth: 0, gap: 1 },
    trailing: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 6 },
  }),
);

export type EvidenceRowProps = {
  evidence: EvidenceView;
  /** Tap the row: open it (call openEvidence from features/task/open.ts inside this handler). */
  onOpen?: () => void;
  /** Shows the ✕ (the owner's DRAFT attempt only). */
  onRemove?: () => void;
  /** The ✕'s accessible name, e.g. 移除 {name}. */
  removeLabel?: string;
  /** Uploading or removing: show a spinner and ignore presses. */
  busy?: boolean;
  /** Replaces the size · type line (上传中… while a file is on its way). */
  meta?: string;
};

/** The mockup's tile icons: a document, an image, a table (Excel / CSV), a link. */
function iconFor(evidence: Pick<EvidenceView, 'kind' | 'name' | 'mimeType'>): IconName {
  if (evidence.kind === 'LINK') return 'link';
  const family = fileFamily(evidence.name, evidence.mimeType);
  if (family === 'image') return 'image';
  if (family === 'excel' || family === 'csv') return 'table';
  return 'file';
}

/**
 * One piece of evidence (`.file-chip`): icon tile, name, meta (evidenceMeta), and on the right the ✕ when
 * removable, else the open icon. The name and tile open it; the ✕ is its own button beside them.
 */
export function EvidenceRow({ evidence, onOpen, onRemove, removeLabel, busy, meta }: EvidenceRowProps) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const k = t.task.evidence;

  const body = (
    <>
      <View style={s.ico} aria-hidden>
        <Icon name={iconFor(evidence)} size={20} color={c.ink2} />
      </View>
      <View style={s.grow}>
        <Txt v="small" weight={700} numberOfLines={2}>
          {evidence.name}
        </Txt>
        <Txt v="meta" size={12} numberOfLines={1}>
          {meta ?? evidenceMeta(evidence, t)}
        </Txt>
      </View>
    </>
  );

  let trailing = null;
  if (busy) {
    trailing = (
      <View style={s.trailing}>
        <ActivityIndicator size="small" color={c.grape} />
      </View>
    );
  } else if (onRemove) {
    trailing = (
      <Pressable
        onPress={onRemove}
        role="button"
        aria-label={removeLabel ?? k.remove(evidence.name)}
        hitSlop={4}
        style={({ pressed }) => [s.trailing, pressed && { backgroundColor: c.card }]}>
        <Icon name="close" size={18} color={c.ink} />
      </Pressable>
    );
  } else if (onOpen) {
    trailing = (
      <View style={s.trailing} aria-hidden>
        <Icon name="external" size={18} color={c.muted} />
      </View>
    );
  }

  return (
    <View style={s.row}>
      {onOpen && !busy ? (
        <Pressable
          onPress={onOpen}
          role="link"
          aria-label={k.open(evidence.name)}
          style={({ pressed }) => [s.main, pressed && s.pressed]}>
          {body}
        </Pressable>
      ) : (
        <View style={s.main} aria-busy={!!busy}>
          {body}
        </View>
      )}
      {trailing}
    </View>
  );
}
