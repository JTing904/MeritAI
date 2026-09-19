import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { makeStyles, useTheme } from '@/theme';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    card: { alignItems: 'center', gap: 10, paddingVertical: 24, paddingHorizontal: 18 },
    buttons: { alignSelf: 'stretch', gap: 10, marginTop: 6 },
    demo: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: c.card },
    demoPressed: { backgroundColor: c.card2 },
    grow: { flex: 1, minWidth: 0, gap: 2 },
  }),
);

/** Home with no projects yet (HomeEmpty mockup). */
export function EmptyHome() {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const toast = useToast();
  const e = t.home.empty;
  return (
    <>
      <Card style={s.card}>
        <Txt v="body" size={42} style={{ lineHeight: 52 }} aria-hidden>
          📦
        </Txt>
        <Txt v="body" size={17} weight={700} center>
          {e.title}
        </Txt>
        <Txt v="small" color="muted" center>
          {e.body}
        </Txt>
        <View style={s.buttons}>
          <Button title={t.home.newProject} block onPress={() => router.push('/new')} />
          <Button title={t.home.joinByCode} kind="soft" block onPress={() => router.push('/join')} />
        </View>
      </Card>
      {/* The sample project arrives later (REQUIREMENTS §13 scope); until then the row only says so. */}
      <Pressable onPress={() => toast.show(e.demoSoon)} role="button" style={({ pressed }) => [s.demo, pressed && s.demoPressed]}>
        <Txt v="body" size={22} style={{ lineHeight: 30 }} aria-hidden>
          👀
        </Txt>
        <View style={s.grow}>
          <Txt v="body" weight={700}>
            {e.demo}
          </Txt>
          <Txt v="meta">{e.demoSub}</Txt>
        </View>
        <Icon name="chevron" size={18} color={c.muted} />
      </Pressable>
    </>
  );
}
