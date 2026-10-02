import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { EvidenceView } from '@shared/types';
import { Button } from '@/components/Button';
import { SectionHeader } from '@/components/Card';
import { Icon, type IconName } from '@/components/Icon';
import { PrivacyLine } from '@/features/ai/parts';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { errorCode, newIdempotencyKey, type ClientErrorCode } from '@/lib/api';
import { useSession } from '@/lib/session';
import { makeStyles, useTheme } from '@/theme';
import { EvidenceRow } from './EvidenceRow';
import { compressPhoto, needsCompressing } from './compress';
import { LinkSheet } from './LinkSheet';
import type { TaskCtx } from './model';
import { openEvidence } from './open';
import { EVIDENCE_MAX_BYTES, evidenceForm, pickEvidenceFile, type PickedFile } from './upload';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    tiles: { flexDirection: 'row', gap: 10 },
    // `.ev-opt`: a dashed tile.
    tile: {
      flex: 1,
      minWidth: 0,
      gap: 6,
      alignItems: 'flex-start',
      borderWidth: 2,
      borderStyle: 'dashed',
      borderColor: c.line,
      borderRadius: 18,
      backgroundColor: c.card,
      padding: 14,
    },
    list: { gap: 10 },
  }),
);

/** Failures worth 再试一次 with the same file; anything else (too big, wrong type, 5 already) drops it. */
const RETRYABLE = new Set<ClientErrorCode>(['NETWORK', 'TIMEOUT', 'RETRY', 'INTERNAL', 'BAD_RESPONSE', 'RATE_LIMITED']);

/** The file on its way: compressed first if it is a big photo; kept after a failed upload for 再试一次. */
type Pending = {
  file: PickedFile;
  /** Idempotency-Key: the same for every try of this file, so a retry after a lost answer can't add it twice. */
  key: string;
  phase: 'compressing' | 'uploading' | 'failed';
  error?: ClientErrorCode;
};

function Tile({ icon, title, sub, onPress, disabled }: { icon: IconName; title: string; sub: string; onPress: () => void; disabled: boolean }) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      role="button"
      aria-label={title}
      aria-disabled={disabled}
      style={({ pressed }) => [s.tile, pressed && { borderColor: c.grape }, disabled && { opacity: 0.55 }]}>
      <Icon name={icon} size={22} color={c.ink} />
      <Txt v="text" weight={700}>
        {title}
      </Txt>
      <Txt v="meta" size={11.5}>
        {sub}
      </Txt>
    </Pressable>
  );
}

/**
 * 交证据 for the owner (boards 1–3, and a resubmission): the current attempt's files and links with ✕,
 * 上传文件 / 贴网址 until there are 5, then 我做完了，请组长看.
 */
export function EvidenceSection({ ctx, onSubmitted }: { ctx: TaskCtx; onSubmitted: (selfGraded: boolean) => void }) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const k = t.task.evidence;
  const { request } = useSession();
  const { detail, busy } = ctx;
  const [pending, setPending] = useState<Pending | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);

  const draft = detail.current?.status === 'DRAFT' ? detail.current : null;
  const items: EvidenceView[] = draft?.evidence ?? [];
  const max = detail.storage.maxItems;
  const count = items.length + (pending ? 1 : 0);
  const resubmission = detail.attempts.some((a) => a.status === 'GRADED');
  const no = draft?.no ?? detail.attempts.reduce((m, a) => Math.max(m, a.no), 0) + 1;
  const locked = busy !== null || pending !== null;
  // M6: a member's hand-in goes to the AI when the leader's key works and today's reviews aren't used up.
  const ai = detail.project.ai;
  const aiProvider = !ctx.leader && ctx.task.kind !== 'MEETING' && ai.configured ? ai.provider : null;
  const aiUsable = aiProvider !== null && ai.status !== 'INVALID' && detail.aiReviewsLeftToday !== null;
  const aiGrades = aiUsable && (detail.aiReviewsLeftToday ?? 0) > 0;

  const send = async (file: PickedFile, key: string) => {
    setPending({ file, key, phase: 'uploading' });
    const ok = await ctx.run('upload', `${ctx.base}/evidence/file`, { method: 'POST', body: evidenceForm(file), idempotencyKey: key }, {
      fail: (err) => {
        const code = errorCode(err);
        // No network: nothing was sent; say so, and keep the file for 再试一次 once it's back.
        if (code === 'OFFLINE') ctx.toast(t.errors.OFFLINE);
        else if (!RETRYABLE.has(code)) return false; // toasted by onError; the file is dropped below
        setPending({ file, key, phase: 'failed', error: code });
        return true;
      },
    });
    if (ok) setPending(null);
    else setPending((p) => (p?.phase === 'failed' ? p : null));
  };

  const upload = async () => {
    if (locked) return;
    let picked: PickedFile | null;
    try {
      picked = await pickEvidenceFile();
    } catch {
      return ctx.toast(t.errors.INTERNAL);
    }
    if (!picked) return;
    const key = newIdempotencyKey();
    if (needsCompressing(picked)) {
      setPending({ file: picked, key, phase: 'compressing' });
      picked = await compressPhoto(picked);
    }
    if (picked.size !== null && picked.size > Math.min(EVIDENCE_MAX_BYTES, detail.storage.maxFileBytes)) {
      setPending(null);
      return ctx.toast(t.errors.FILE_TOO_LARGE);
    }
    if (picked.size !== null && detail.storage.usedBytes + picked.size > detail.storage.capBytes) {
      setPending(null);
      return ctx.toast(t.errors.PROJECT_STORAGE_FULL);
    }
    await send(picked, key);
  };

  const retry = () => {
    if (pending?.phase === 'failed' && busy === null) void send(pending.file, pending.key);
  };

  const remove = (e: EvidenceView) => {
    if (locked) return;
    void ctx.run(`remove-${e.id}`, `${ctx.base}/evidence/${encodeURIComponent(e.id)}`, { method: 'DELETE' });
  };

  const submit = () =>
    void ctx.run('submit', `${ctx.base}/submit`, { method: 'POST' }, {
      done: (d) => {
        const self = d.current === null && d.task.status === 'DONE';
        const toAi = d.current?.aiState === 'QUEUED' || d.current?.aiState === 'RUNNING';
        ctx.toast(self ? k.selfGraded : toAi ? t.ai.evidence.submitted : k.submitted);
        onSubmitted(self);
      },
    });

  return (
    <>
      <SectionHeader
        title={k.title}
        action={<Txt v="meta">{resubmission ? k.countNo(no, count, max) : k.count(count, max)}</Txt>}
      />
      <View style={s.list}>
        {aiProvider ? <PrivacyLine>{t.ai.evidence.privacy[aiProvider]}</PrivacyLine> : null}
        {items.map((e) => (
          <EvidenceRow
            key={e.id}
            evidence={e}
            onOpen={() => void openEvidence(request, e, ctx.onError, () => ctx.toast(k.unsafeLink))}
            onRemove={() => remove(e)}
            removeLabel={k.remove(e.name)}
            busy={busy === `remove-${e.id}`}
          />
        ))}
        {pending ? (
          <View style={{ gap: 8 }} aria-live="polite">
            <EvidenceRow
              evidence={{
                id: 'uploading',
                kind: 'FILE',
                name: pending.file.name,
                url: null,
                sizeBytes: pending.file.size,
                mimeType: pending.file.mimeType,
                addedByMemberId: null,
                createdAt: new Date().toISOString(),
              }}
              meta={
                pending.phase === 'failed'
                  ? k.uploadFailed(t.errors[pending.error ?? 'INTERNAL'])
                  : pending.phase === 'compressing'
                    ? k.compressing
                    : k.uploading
              }
              busy={pending.phase !== 'failed'}
              onRemove={pending.phase === 'failed' ? () => setPending(null) : undefined}
              removeLabel={k.uploadDrop}
            />
            {pending.phase === 'failed' ? (
              <View style={s.tiles}>
                <Button title={k.uploadRetry} small onPress={retry} disabled={busy !== null} />
                <Button title={k.uploadDrop} small kind="soft" onPress={() => setPending(null)} />
              </View>
            ) : null}
          </View>
        ) : null}
        {count < max ? (
          <View style={s.tiles}>
            <Tile icon="upload" title={k.upload} sub={k.uploadSub} onPress={() => void upload()} disabled={locked} />
            <Tile icon="link" title={k.link} sub={k.linkSub} onPress={() => setLinkOpen(true)} disabled={locked} />
          </View>
        ) : null}
        {items.length > 0 ? <Txt v="meta">{k.hint}</Txt> : null}
      </View>
      <View style={{ gap: 6 }}>
        <Button
          title={ctx.leader ? k.submitSelf : aiGrades ? t.ai.evidence.submit : k.submit}
          icon={aiGrades ? <Icon name="sparkle" size={18} color={c.onGrape} /> : undefined}
          block
          loading={busy === 'submit'}
          disabled={items.length === 0 || (locked && busy !== 'submit')}
          onPress={submit}
        />
        <Txt v="meta" center>
          {items.length === 0
            ? k.submitHintEmpty
            : ctx.leader
              ? k.submitHintSelf
              : aiGrades
                ? t.ai.evidence.submitHint(detail.aiReviewsLeftToday ?? 0)
                : aiUsable
                  ? t.ai.evidence.limitHint
                  : k.submitHint}
        </Txt>
      </View>
      {linkOpen ? <LinkSheet ctx={ctx} onClose={() => setLinkOpen(false)} /> : null}
    </>
  );
}
