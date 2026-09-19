import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState, type ReactNode, type RefObject } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { Icon } from '@/components/Icon';
import { Rich, type RichPart } from '@/components/Rich';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { makeStyles, useTheme } from '@/theme';
import { MAX_WIDTH } from '@/theme/tokens';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.paper },
    content: {
      flexGrow: 1,
      paddingHorizontal: 18,
      paddingTop: 4,
      gap: 18,
      width: '100%',
      maxWidth: MAX_WIDTH,
      alignSelf: 'center',
    },
    top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 4 },
    iconBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    steps: { flex: 1, flexDirection: 'row', gap: 5 },
    seg: { flex: 1, height: 6, borderRadius: 3 },
    foot: { marginTop: 'auto', paddingTop: 6, gap: 8 },
  }),
);

/** Leaves the wizard for home (the stack below is the tab navigator, or nothing after a reload on web). */
export function leaveWizard() {
  router.dismissTo('/');
}

/** Android Back runs the screen's own back action (previous step, or the close check). */
export function useHardwareBack(action: () => void) {
  const ref = useRef(action);
  ref.current = action;
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        ref.current();
        return true;
      });
      return () => sub.remove();
    }, []),
  );
}

/**
 * Wizard frame (prototype `flowTop`): back / 6-step progress / close, the step label, the page,
 * and a footer that sits at the bottom of short pages and after the content on long ones.
 */
export function WizardScreen({
  step,
  onBack,
  onClose,
  footer,
  children,
  scrollRef,
  onHardwareBack,
}: {
  step: number;
  /** Shown as 上一步 when given (steps 1 and 3 have none). */
  onBack?: () => void;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  scrollRef?: RefObject<ScrollView | null>;
  /** Android Back when it should differ from 上一步 / ✕. */
  onHardwareBack?: () => void;
}) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  useHardwareBack(onHardwareBack ?? onBack ?? onClose);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'web' ? undefined : 'padding'}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[s.content, { paddingBottom: 28 + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View>
            <View style={s.top}>
              {onBack ? (
                <Pressable onPress={onBack} role="button" aria-label={t.wizard.prevStep} hitSlop={2} style={s.iconBtn}>
                  <Icon name="back" color={c.ink} />
                </Pressable>
              ) : (
                <View style={s.iconBtn} />
              )}
              <View
                style={s.steps}
                accessible
                role="progressbar"
                aria-valuemin={1}
                aria-valuemax={6}
                aria-valuenow={step}
                aria-label={t.wizard.stepLabel(step)}>
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <View key={n} style={[s.seg, { backgroundColor: n <= step ? c.grape : c.card2 }]} />
                ))}
              </View>
              <Pressable onPress={onClose} role="button" aria-label={t.common.close} hitSlop={2} style={s.iconBtn}>
                <Icon name="close" color={c.ink} />
              </Pressable>
            </View>
            <Txt v="meta" size={12} weight={700} center style={{ marginTop: 6 }} aria-hidden>
              {t.wizard.stepLabel(step)}
            </Txt>
          </View>
          {children}
          {footer ? <View style={s.foot}>{footer}</View> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** Page title with one highlighted part, e.g. 先说说<mint>这个项目</mint>. */
export function WizardTitle({ parts }: { parts: RichPart[] }) {
  return <Rich parts={parts.filter((p) => p !== '')} />;
}

/** The muted line under a title (the mockups pull it 8px closer). */
export function SubLine({ children }: { children: ReactNode }) {
  return (
    <Txt v="text" color="muted" style={{ marginTop: -4 }}>
      {children}
    </Txt>
  );
}

type CloseCopy = { body: string; confirmLabel?: string };

/**
 * Closing the wizard after entering anything asks first (REQUIREMENTS §13) and keeps the draft.
 * `beforeLeave` may save pending edits; returning false keeps the wizard open.
 */
export function useWizardClose({
  needsConfirm,
  copy,
  beforeLeave,
}: {
  needsConfirm: boolean;
  copy: CloseCopy;
  beforeLeave?: () => Promise<boolean | void>;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const requestClose = useCallback(() => {
    if (needsConfirm) setOpen(true);
    else leaveWizard();
  }, [needsConfirm]);

  const sheet = (
    <ConfirmSheet
      visible={open}
      title={t.wizard.close.title}
      body={copy.body}
      confirmLabel={copy.confirmLabel ?? t.wizard.close.confirm}
      onClose={() => setOpen(false)}
      onConfirm={async () => {
        if ((await beforeLeave?.()) === false) return;
        setOpen(false);
        leaveWizard();
      }}
    />
  );

  return { requestClose, closeSheet: sheet };
}
