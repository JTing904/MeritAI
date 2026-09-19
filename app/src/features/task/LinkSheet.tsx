import { useState } from 'react';
import { View } from 'react-native';
import type { LinkEvidenceInput } from '@shared/types';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { Field, Input } from '@/features/wizard/Field';
import { useI18n } from '@/i18n';
import { errorCode } from '@/lib/api';
import { useIdempotencyKey } from '@/lib/idempotency';
import type { TaskCtx } from './model';

/** 贴网址: one link as evidence (http:// or https://; the server checks it and names it). */
export function LinkSheet({ ctx, onClose }: { ctx: TaskCtx; onClose: () => void }) {
  const { t } = useI18n();
  const k = t.task.evidence.linkSheet;
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const busy = ctx.busy === 'link';
  const idem = useIdempotencyKey();

  const add = async () => {
    // Enter on the keyboard bypasses the button's loading state; ctx.run also refuses a second write.
    if (busy) return;
    const value = url.trim();
    if (!/^https?:\/\/\S+$/i.test(value)) return setError(t.errors.INVALID_LINK);
    const body: LinkEvidenceInput = { url: value };
    const idempotencyKey = idem.keyFor(value);
    await ctx.run('link', `${ctx.base}/evidence/link`, { method: 'POST', body, idempotencyKey }, {
      done: () => {
        idem.done();
        onClose();
      },
      fail: (err) => {
        const code = errorCode(err);
        if (code !== 'INVALID_LINK') return false;
        setError(t.errors[code]);
        return true;
      },
    });
  };

  return (
    <Sheet visible onClose={onClose} title={k.title}>
      <Field label={k.label} error={error}>
        <Input
          label={k.label}
          value={url}
          onChangeText={(v) => {
            setUrl(v);
            setError(null);
          }}
          placeholder={k.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          inputMode="url"
          maxLength={2000}
          invalid={!!error}
          onSubmitEditing={() => void add()}
          autoFocus
        />
      </Field>
      <View style={{ marginTop: 4 }}>
        <Button title={k.add} block loading={busy} disabled={url.trim() === ''} onPress={add} />
      </View>
    </Sheet>
  );
}
