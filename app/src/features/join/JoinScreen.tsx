import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { JoinPreview, ProjectView } from '@shared/types';
import { AvatarStack } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Rich } from '@/components/Rich';
import { AppBar } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { projectTag } from '@/features/home/format';
import { ProjectCardFrame, ProjectHead } from '@/features/home/ProjectCard';
import { useI18n } from '@/i18n';
import { errorCode, type ClientErrorCode } from '@/lib/api';
import { useSession } from '@/lib/session';
import { fontStyle } from '@/theme/fonts';
import { makeStyles, useTheme } from '@/theme';
import { MAX_WIDTH, radius } from '@/theme/tokens';
import { looksComplete, normalizeCode } from './code';

// Errors about the code itself show under the field (JoinError mockup); others (offline, server) as a toast.
const CODE_ERRORS = new Set<ClientErrorCode>([
  'INVITE_CODE_INVALID',
  'INVITE_CODE_EXPIRED',
  'PROJECT_ENDED',
  'REMOVED_FROM_PROJECT',
  'NOT_FOUND',
  'TEAM_FULL',
]);

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.paper },
    content: {
      flexGrow: 1,
      paddingHorizontal: 18,
      paddingTop: 18,
      gap: 18,
      width: '100%',
      maxWidth: MAX_WIDTH,
      alignSelf: 'center',
    },
    field: { gap: 6 },
    input: {
      ...fontStyle('mono', 500),
      fontSize: 22,
      letterSpacing: 22 * 0.12,
      textAlign: 'center',
      color: c.ink,
      backgroundColor: c.card,
      borderWidth: 2,
      borderColor: c.line,
      borderRadius: radius.input,
      paddingVertical: 12,
      paddingHorizontal: 14,
      outlineWidth: 0,
    },
    looking: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
    // Pinned to the bottom when there is room (the mockup's sticky footer); scrolls with the page otherwise.
    sticky: { marginTop: 'auto', paddingTop: 6 },
  }),
);

/** 用邀请码加入: type or paste a code, see which project it opens, join (Join / JoinError mockups). */
export function JoinScreen({ initialCode = '' }: { initialCode?: string }) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const { request } = useSession();
  const { show } = useToast();
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState(() => normalizeCode(initialCode));
  const [focused, setFocused] = useState(false);
  const [preview, setPreview] = useState<JoinPreview | null>(null);
  const [error, setError] = useState<ClientErrorCode | null>(null);
  const [looking, setLooking] = useState(false);
  const [joining, setJoining] = useState(false);
  // Answers for a code the user has since changed are dropped.
  const latest = useRef(0);

  const lookUp = useCallback(
    async (value: string) => {
      const id = ++latest.current;
      setLooking(true);
      setError(null);
      try {
        const found = await request<JoinPreview>(`/join/${encodeURIComponent(value)}`);
        if (id !== latest.current) return;
        // Someone already in the project can always open it, even when the team is full.
        if (!found.alreadyMember && found.full) setError('TEAM_FULL');
        else setPreview(found);
      } catch (err) {
        if (id === latest.current) setError(errorCode(err));
      } finally {
        if (id === latest.current) setLooking(false);
      }
    },
    [request],
  );

  // Look the code up as soon as it looks complete, after a short pause in typing.
  useEffect(() => {
    if (!looksComplete(code)) return;
    const timer = setTimeout(() => void lookUp(code), 300);
    return () => clearTimeout(timer);
  }, [code, lookUp]);

  const onChangeText = (text: string) => {
    latest.current++;
    setCode(normalizeCode(text));
    setPreview(null);
    setError(null);
    setLooking(false);
  };

  const join = async () => {
    if (!preview || joining) return;
    if (preview.alreadyMember) {
      router.replace({ pathname: '/project/[id]', params: { id: preview.projectId } });
      return;
    }
    setJoining(true);
    try {
      const project = await request<ProjectView>(`/join/${encodeURIComponent(code)}`, { method: 'POST' });
      const canPick = project.packages.some((p) => p.ownerMemberId === null);
      show(canPick ? t.join.joined(project.basics.name) : t.join.joinedNoPick(project.basics.name));
      router.replace({ pathname: '/project/[id]', params: { id: project.basics.id } });
    } catch (err) {
      const why = errorCode(err);
      if (CODE_ERRORS.has(why)) {
        setPreview(null);
        setError(why);
      } else show(t.errors[why]);
      setJoining(false);
    }
  };

  // The keyboard's Go key joins once a project is shown; before that it looks the code up
  // (also for codes that don't match the usual shape, so the server can say what's wrong).
  const submit = () => {
    if (preview) void join();
    else if (code && !looking) void lookUp(code);
  };

  const card = t.home.card;
  const borderColor = error ? c.bad : focused ? c.grape : c.line;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <AppBar title={t.join.appbar} />
      {/* The window is edge-to-edge, so the keyboard doesn't shrink it: lift the pinned join button ourselves. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'web' ? undefined : 'padding'}>
        <ScrollView
          contentContainerStyle={[s.content, { paddingBottom: 28 + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Rich parts={[t.join.title.before, { hl: 'gum', text: t.join.title.hl }]} />

          <View style={s.field}>
            <Txt v="label">{t.join.label}</Txt>
            <TextInput
              value={code}
              onChangeText={onChangeText}
              onSubmitEditing={submit}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={t.join.placeholder}
              placeholderTextColor={c.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              autoFocus={!initialCode}
              returnKeyType="go"
              maxLength={80}
              aria-label={t.join.label}
              style={[s.input, { borderColor }]}
            />
            {error ? (
              <Txt v="meta" color="bad" weight={600} aria-live="polite">
                {t.errors[error]}
              </Txt>
            ) : (
              <Txt v="meta">{t.join.hint}</Txt>
            )}
          </View>

          {looking && (
            <View style={s.looking} aria-live="polite">
              <ActivityIndicator size="small" color={c.grape} />
              <Txt v="meta">{t.join.looking}</Txt>
            </View>
          )}

          {preview && (
            <ProjectCardFrame>
              <ProjectHead
                tag={projectTag(preview.name, preview.shortCode)}
                tagColor={c.hl[preview.color].base}
                name={preview.name}
                meta={[preview.courseName, preview.groupLabel, card.ledBy(preview.leaderName)].filter(Boolean).join(' · ')}
              />
              <View style={s.foot}>
                <AvatarStack people={preview.members.map((m) => ({ name: m.name, hl: m.color }))} />
                <Txt v="meta">
                  {[
                    card.peopleOf(preview.memberCount, preview.teamSize),
                    preview.freePackages > 0 ? card.freePackages(preview.freePackages) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Txt>
              </View>
            </ProjectCardFrame>
          )}

          {preview?.alreadyMember && <Txt v="small" color="ink2">{t.join.alreadyMember}</Txt>}

          <View style={s.sticky}>
            <Button
              title={preview?.alreadyMember ? t.join.open : t.join.join}
              block
              disabled={!preview}
              loading={joining}
              onPress={() => void join()}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
