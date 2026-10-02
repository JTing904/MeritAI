import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AI_HOWTO_MAX_STEPS, AI_HOWTO_STEP_CHARS } from '@shared/constants';
import type { HowtoInput } from '@shared/types';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { Txt } from '@/components/Txt';
import { isFinished } from '@/features/project/parts';
import type { TaskCtx } from '@/features/task/model';
import { CardHead, TextLink } from '@/features/task/parts';
import { Input } from '@/features/wizard/Field';
import { useI18n } from '@/i18n';
import { makeStyles, useTheme } from '@/theme';
import { mix } from '@/theme/color';
import { AiTag } from './parts';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    step: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
    no: { width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: mix(c.hl.lemon.base, c.card, 0.45) },
    row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    remove: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  }),
);

/** Who may edit 怎么做: the leader and the task's owner, in a running project. */
export const canEditHowto = (ctx: TaskCtx) => ctx.running && (ctx.mine || ctx.leader);

/**
 * 怎么做 (TaskAiHowto mockup): numbered steps with 「✨ AI 写的」 while nobody has changed them; the leader and
 * the owner edit (编辑). Empty: only an unfinished task invites someone who may edit to write some.
 */
export function HowtoCard({ ctx, onEdit }: { ctx: TaskCtx; onEdit: () => void }) {
  const s = useStyles();
  const { t } = useI18n();
  const h = t.ai.howto;
  const { detail } = ctx;
  const steps = detail.howto;
  const canEdit = canEditHowto(ctx);
  if (steps.length === 0 && (!canEdit || isFinished(ctx.task))) return null;

  return (
    <Card style={{ gap: 10 }}>
      <CardHead
        title={h.title}
        tag={detail.howtoByAi && steps.length > 0 ? <AiTag /> : undefined}
        action={canEdit ? <TextLink title={h.edit} onPress={onEdit} disabled={ctx.busy !== null} /> : undefined}
      />
      {steps.length === 0 ? (
        <Txt v="meta">{h.empty}</Txt>
      ) : (
        <>
          <View style={{ gap: 10 }} role="list">
            {steps.map((step, i) => (
              <View key={i} style={s.step} role="listitem">
                <View style={s.no} aria-hidden>
                  <Txt v="num" size={13} color="onHl">
                    {i + 1}
                  </Txt>
                </View>
                <Txt v="small" style={{ flex: 1 }}>
                  {step}
                </Txt>
              </View>
            ))}
          </View>
          <Txt v="meta">{detail.howtoByAi ? h.hintAi : h.hint}</Txt>
        </>
      )}
    </Card>
  );
}

type Row = { key: string; text: string };

/** 怎么做, edited as a whole (PUT …/howto: at most 8 steps of 200 characters); empty rows are dropped. */
export function HowtoEditSheet({ ctx, onClose }: { ctx: TaskCtx; onClose: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const h = t.ai.howto;
  const next = useRef(0);
  const newRow = (text = ''): Row => ({ key: `r${next.current++}`, text });
  const [rows, setRows] = useState<Row[]>(() => (ctx.detail.howto.length ? ctx.detail.howto.map((x) => newRow(x)) : [newRow()]));
  const busy = ctx.busy === 'howto';

  const save = async () => {
    const body: HowtoInput = { steps: rows.map((r) => r.text.trim()).filter((x) => x !== '') };
    await ctx.run('howto', `${ctx.base}/howto`, { method: 'PUT', body }, {
      done: () => {
        ctx.toast(h.saved);
        onClose();
      },
    });
  };

  return (
    <Sheet visible onClose={onClose} title={h.sheetTitle}>
      {rows.map((row, i) => (
        <View key={row.key} style={s.row}>
          <View style={{ flex: 1 }}>
            <Input
              label={h.step(i + 1)}
              placeholder={h.step(i + 1)}
              value={row.text}
              onChangeText={(v) => setRows((r) => r.map((x) => (x.key === row.key ? { ...x, text: v } : x)))}
              maxLength={AI_HOWTO_STEP_CHARS}
              multiline
              style={{ minHeight: 0 }}
            />
          </View>
          <Pressable
            onPress={() => setRows((r) => r.filter((x) => x.key !== row.key))}
            role="button"
            aria-label={h.remove}
            disabled={busy}
            style={({ pressed }) => [s.remove, pressed && { backgroundColor: c.card2 }]}>
            <Icon name="close" size={18} color={c.muted} />
          </Pressable>
        </View>
      ))}
      {rows.length < AI_HOWTO_MAX_STEPS ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <TextLink title={h.add} onPress={() => setRows((r) => [...r, newRow()])} disabled={busy} />
        </View>
      ) : (
        <Txt v="meta">{h.max(AI_HOWTO_MAX_STEPS)}</Txt>
      )}
      <View style={{ marginTop: 4 }}>
        <Button title={h.save} block loading={busy} onPress={save} />
      </View>
    </Sheet>
  );
}
