import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import type { ProjectView } from '@shared/types';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { makeStyles, useTheme } from '@/theme';
import { radius } from '@/theme/tokens';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    // The mockup's `.brief-c`: a slim card row that opens the full text.
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: c.card,
      borderRadius: radius.card,
      boxShadow: c.shadow,
      paddingVertical: 12,
      paddingHorizontal: 16,
    },
    pressed: { backgroundColor: c.pressed },
    grow: { flex: 1, minWidth: 0, gap: 2 },
  }),
);

/** 📄 作业要求 on the project page (everyone, when the project keeps the brief's text; board 12). */
export function BriefCard({ project }: { project: ProjectView }) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const b = t.project.briefCard;
  if (!project.briefAvailable) return null;
  const meta = project.briefFileName ? b.file(project.briefFileName) : b.typed;

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/project/[id]/brief', params: { id: project.basics.id } })}
      role="button"
      aria-label={`${b.title} · ${meta}`}
      style={({ pressed }) => [s.card, pressed && s.pressed]}>
      <Icon name="file" size={22} color={c.muted} />
      <View style={s.grow}>
        <Txt v="text" weight={700}>
          {b.title}
        </Txt>
        <Txt v="meta">{meta}</Txt>
      </View>
      <Icon name="chevron" size={18} color={c.muted} />
    </Pressable>
  );
}
