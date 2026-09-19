import { ActivityIndicator } from 'react-native';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import type { ClientErrorCode } from '@/lib/api';
import { useTheme } from '@/theme';

/** Before the first load: a spinner, or the error with 再试一次. */
export function LoadState({ error, onRetry }: { error: ClientErrorCode | null; onRetry: () => void }) {
  const { t } = useI18n();
  const { c } = useTheme();
  if (!error) return <ActivityIndicator color={c.grape} style={{ paddingVertical: 24 }} />;
  return (
    <Card style={{ gap: 12 }}>
      <Txt v="text" color="bad">
        {t.errors[error]}
      </Txt>
      <Button title={t.common.retry} kind="soft" onPress={onRetry} />
    </Card>
  );
}
