import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Sheet, SheetOption } from '@/components/Sheet';
import { useI18n } from '@/i18n';
import { makeStyles, useTheme } from '@/theme';
import { MAX_WIDTH } from '@/theme/tokens';

const SIZE = 58;
const LIP = 4;
const TRAVEL = 3;

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    // Spans the centred content column so the FAB lines up with the cards on tablets too.
    dock: { position: 'absolute', left: 0, right: 0, bottom: 14, alignItems: 'center' },
    column: { width: '100%', maxWidth: MAX_WIDTH, paddingHorizontal: 18, alignItems: 'flex-end' },
    btn: { width: SIZE, height: SIZE + LIP },
    lip: { position: 'absolute', left: 0, right: 0, top: LIP, borderRadius: 20, backgroundColor: c.grapePress },
    face: {
      width: SIZE,
      height: SIZE,
      borderRadius: 20,
      backgroundColor: c.grape,
      alignItems: 'center',
      justifyContent: 'center',
    },
  }),
);

/** Space the last card keeps free so the FAB never covers it. */
export const FAB_SPACE = 56;

/** The home screen's "+" (prototype `.fab`), opening 「要做什么？」: new project or join by code. */
export function Fab() {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [down, setDown] = useState(false);

  const go = (href: '/new' | '/join') => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <View style={s.dock} pointerEvents="box-none">
        <View style={s.column} pointerEvents="box-none">
          <Pressable
            onPress={() => setOpen(true)}
            onPressIn={() => setDown(true)}
            onPressOut={() => setDown(false)}
            role="button"
            aria-label={t.home.fab.label}
            style={s.btn}>
            <View style={[s.lip, { bottom: down ? LIP - TRAVEL - 1 : 0 }]} />
            <View style={[s.face, { transform: [{ translateY: down ? TRAVEL : 0 }] }]}>
              <Icon name="plus" size={26} color={c.onGrape} />
            </View>
          </Pressable>
        </View>
      </View>
      <Sheet visible={open} onClose={() => setOpen(false)} title={t.home.fab.title}>
        <SheetOption emoji="✨" title={t.home.newProject} sub={t.home.fab.newSub} onPress={() => go('/new')} />
        <SheetOption emoji="🔑" title={t.home.joinByCode} sub={t.home.fab.joinSub} onPress={() => go('/join')} />
      </Sheet>
    </>
  );
}
