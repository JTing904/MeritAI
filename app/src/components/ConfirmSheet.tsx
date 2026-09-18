import { useState } from 'react';
import { View } from 'react-native';
import { useI18n } from '@/i18n';
import { Button } from './Button';
import { Sheet } from './Sheet';
import { Txt } from './Txt';

type Props = {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  /** Danger styling for destructive actions (sign out, remove member, end project). */
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
};

/** "确定吗？" step for important actions, shown as a bottom sheet in the prototype's style. */
export function ConfirmSheet({ visible, title, body, confirmLabel, danger, onConfirm, onClose }: Props) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={busy ? () => {} : onClose} title={title}>
      {body && (
        <Txt v="small" color="ink2">
          {body}
        </Txt>
      )}
      <View style={{ gap: 10, marginTop: 6 }}>
        <Button title={confirmLabel} kind={danger ? 'danger' : 'primary'} block loading={busy} onPress={confirm} />
        <Button title={t.common.cancel} kind="soft" block disabled={busy} onPress={onClose} />
      </View>
    </Sheet>
  );
}
