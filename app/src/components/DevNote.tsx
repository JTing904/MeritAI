import { View } from 'react-native';
import { useI18n } from '@/i18n';
import { useTheme } from '@/theme';
import { Txt } from './Txt';

/** Temporary placeholder for pages that later milestones build. Dashed so it never passes for real UI. */
export function DevNote({ milestone }: { milestone: string }) {
  const { c } = useTheme();
  const { t } = useI18n();
  return (
    <View style={{ borderWidth: 2, borderStyle: 'dashed', borderColor: c.overrideBorder, borderRadius: 18, padding: 16, gap: 4 }}>
      <Txt v="rowTitle">🚧 {t.dev.building}</Txt>
      <Txt v="meta">{t.dev.buildingHint(milestone)}</Txt>
    </View>
  );
}
