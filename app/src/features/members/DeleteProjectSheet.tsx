import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { deleteConfirmMatches } from '@shared/format';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { Field, Input } from '@/features/wizard/Field';
import { useI18n } from '@/i18n';
import { useSession } from '@/lib/session';
import { makeStyles } from '@/theme';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    warn: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.badSoft },
  }),
);

/**
 * 为所有人删除项目 (DeleteProject mockup), from the members page and project settings: the danger button
 * only works once the project tag is typed (case and spaces ignored, as the server checks). Done → home.
 */
export function DeleteProjectSheet({
  visible,
  projectId,
  tag,
  onClose,
  onError,
}: {
  visible: boolean;
  projectId: string;
  tag: string;
  onClose: () => void;
  onError: (err: unknown) => void;
}) {
  const s = useStyles();
  const { t } = useI18n();
  const d = t.members.deleteProject;
  const { request } = useSession();
  const { show } = useToast();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const matches = deleteConfirmMatches(typed, tag);

  useEffect(() => {
    if (visible) setTyped('');
  }, [visible]);

  const confirm = async () => {
    if (!matches || busy) return;
    setBusy(true);
    try {
      await request<null>(`/projects/${encodeURIComponent(projectId)}/delete`, { method: 'POST', body: { confirm: typed } });
      onClose();
      router.dismissTo('/');
      show(d.done(tag));
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={d.title(tag)}>
      <View style={s.warn}>
        <Txt v="small" size={13.5} color="bad">
          {d.warn}
        </Txt>
      </View>
      <Field label={d.label(tag)}>
        <Input
          label={d.label(tag)}
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          returnKeyType="done"
          onSubmitEditing={() => void confirm()}
        />
      </Field>
      <View style={{ gap: 10, marginTop: 6 }}>
        <Button title={d.confirm} kind="danger" block loading={busy} disabled={!matches} onPress={confirm} />
        <Button title={t.common.cancel} kind="soft" block onPress={onClose} />
      </View>
    </Sheet>
  );
}
