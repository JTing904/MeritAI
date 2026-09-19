import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { ChecklistInput } from '@shared/types';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { Txt } from '@/components/Txt';
import { Input } from '@/features/wizard/Field';
import { useI18n } from '@/i18n';
import { makeStyles, useTheme } from '@/theme';
import type { TaskCtx } from './model';
import { TextLink } from './parts';

const MAX_ITEMS = 20;

const useStyles = makeStyles(() =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    remove: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  }),
);

type Row = { key: string; id: string | null; text: string };

/**
 * 做到这些才算完成, edited as a whole (PUT replaces the list): rows keep their ids so ticks survive,
 * new rows start unticked, empty rows are dropped. Up to 20.
 */
export function ChecklistEditSheet({ ctx, onClose }: { ctx: TaskCtx; onClose: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const k = t.task.checklist;
  const nextKey = useRef(0);
  const newRow = (): Row => ({ key: `new-${nextKey.current++}`, id: null, text: '' });
  const [rows, setRows] = useState<Row[]>(() => {
    const items = [...ctx.detail.checklist].sort((a, b) => a.order - b.order);
    return items.length > 0 ? items.map((i) => ({ key: i.id, id: i.id, text: i.text })) : [newRow()];
  });
  const busy = ctx.busy === 'checklist';

  const setText = (key: string, text: string) => setRows((r) => r.map((x) => (x.key === key ? { ...x, text } : x)));
  const remove = (key: string) => setRows((r) => r.filter((x) => x.key !== key));

  const save = async () => {
    const body: ChecklistInput = {
      items: rows.map((r) => ({ id: r.id, text: r.text.trim() })).filter((r) => r.text !== ''),
    };
    await ctx.run('checklist', `${ctx.base}/checklist`, { method: 'PUT', body }, {
      done: () => {
        ctx.toast(k.saved);
        onClose();
      },
    });
  };

  return (
    <Sheet visible onClose={onClose} title={k.sheetTitle}>
      {rows.map((row, i) => (
        <View key={row.key} style={s.row}>
          <View style={{ flex: 1 }}>
            <Input label={k.item(i + 1)} value={row.text} onChangeText={(v) => setText(row.key, v)} maxLength={200} />
          </View>
          <Pressable
            onPress={() => remove(row.key)}
            role="button"
            aria-label={k.remove}
            disabled={busy}
            style={({ pressed }) => [s.remove, pressed && { backgroundColor: c.card2 }]}>
            <Icon name="close" size={18} color={c.muted} />
          </Pressable>
        </View>
      ))}
      {rows.length < MAX_ITEMS ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <TextLink title={k.add} onPress={() => setRows((r) => [...r, newRow()])} disabled={busy} />
        </View>
      ) : (
        <Txt v="meta">{k.max}</Txt>
      )}
      <View style={{ marginTop: 4 }}>
        <Button title={k.save} block loading={busy} onPress={save} />
      </View>
    </Sheet>
  );
}
