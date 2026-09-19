import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { formatTotal } from '@shared/planning';
import type { ProjectView, ResplitInput, ResplitPreview, ResplitPreviewInput, ResplitRow } from '@shared/types';
import { Button } from '@/components/Button';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { Field } from '@/features/wizard/Field';
import { Stepper } from '@/features/wizard/Stepper';
import { useI18n } from '@/i18n';
import type { LockedGroup } from '@/i18n/sections/project.zh';
import { errorCode, type ClientErrorCode } from '@/lib/api';
import { useSession } from '@/lib/session';
import { makeStyles, useTheme } from '@/theme';
import { memberById } from './parts';

/** Titles named in the 「已开始的任务不会动」 line before it says 等 N 个. */
const MAX_LOCKED_TITLES = 6;
const DEBOUNCE_MS = 250;

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    box: { backgroundColor: c.card2, borderRadius: 20, padding: 16, gap: 6 },
    row: { flexDirection: 'row', alignItems: 'center', columnGap: 10 },
    name: { flex: 1, minWidth: 0 },
    num: { minWidth: 40, textAlign: 'right' },
    arrow: { width: 14, textAlign: 'center' },
    center: { alignItems: 'center', paddingVertical: 12, gap: 10 },
  }),
);

const clamp = (n: number, range: { min: number; max: number }) => Math.min(Math.max(n, range.min), range.max);

/** Kept packages by their new number, then the ones that go (by their old number). */
function sortRows(rows: ResplitRow[]): ResplitRow[] {
  const key = (r: ResplitRow) => (r.index !== null ? r.index : 1000 + (r.oldIndex ?? 0));
  return [...rows].sort((a, b) => key(a) - key(b));
}

/**
 * 重新分包 (Resplit mockup): pick a count, see before → after per package (preview debounced), confirm.
 * The preview's version goes back with the apply so a change in between is refused (STALE_PREVIEW).
 */
export function ResplitSheet({
  project,
  onClose,
  onChange,
  onError,
}: {
  project: ProjectView;
  onClose: () => void;
  onChange: (view: ProjectView) => void;
  onError: (err: unknown) => void;
}) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const r = t.project.resplit;
  const { request } = useSession();
  const { show } = useToast();
  const id = project.basics.id;

  const [count, setCount] = useState(() => clamp(Math.max(project.packages.length, project.resplitRange.min), project.resplitRange));
  const [preview, setPreview] = useState<ResplitPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ClientErrorCode | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const latest = useRef(0);
  const first = useRef(true);

  useEffect(() => {
    const reqId = ++latest.current;
    setLoading(true);
    setError(null);
    const delay = first.current ? 0 : DEBOUNCE_MS;
    first.current = false;
    const timer = setTimeout(() => {
      const body: ResplitPreviewInput = { count };
      request<ResplitPreview>(`/projects/${id}/resplit/preview`, { method: 'POST', body })
        .then((p) => {
          if (reqId !== latest.current) return;
          setPreview(p);
          setLoading(false);
          // Someone joined or left since the sheet opened: stay inside what the server accepts now.
          const inRange = clamp(count, p.range);
          if (inRange !== count) setCount(inRange);
        })
        .catch((err) => {
          if (reqId !== latest.current) return;
          setError(errorCode(err));
          setLoading(false);
        });
    }, delay);
    return () => clearTimeout(timer);
  }, [count, attempt, id, request]);

  const range = preview?.range ?? project.resplitRange;
  const holders = project.members.filter((m) => m.active && !(m.role === 'LEADER' && project.basics.leaderManages)).length;
  const ready = !loading && !error && preview !== null && preview.count === count;

  const rowLabel = (row: ResplitRow) => {
    if (row.index === null) return r.removed(row.oldIndex ?? 0);
    if (row.packageId === null) return r.added(row.index);
    const owner = memberById(project, row.ownerMemberId);
    if (!owner) return r.free(row.index);
    const moved = row.oldIndex !== null && row.oldIndex !== row.index;
    return `${r.owned(row.index, owner.name)}${moved ? r.renumbered(row.oldIndex!) : ''}`;
  };

  const lockedLine = (p: ResplitPreview) => {
    if (p.lockedTasks.length === 0) return r.noneLocked;
    const named = p.lockedTasks.slice(0, MAX_LOCKED_TITLES);
    const groups: (LockedGroup & { key: string })[] = [];
    for (const task of named) {
      const key = task.ownerMemberId ?? '';
      let group = groups.find((g) => g.key === key);
      if (!group) {
        group = { key, owner: memberById(project, task.ownerMemberId)?.name ?? null, titles: [] };
        groups.push(group);
      }
      group.titles.push(task.title);
    }
    return r.locked(groups, p.lockedTasks.length, p.lockedTasks.length - named.length);
  };

  // Everyone else who is waiting for a package, when the result leaves packages to pick.
  const waiting = project.members.filter((m) => m.needsPackage && m.id !== project.viewerMemberId).map((m) => m.name);
  const freeAfter = preview?.rows.some((row) => row.index !== null && row.ownerMemberId === null) ?? false;

  const apply = async () => {
    if (!preview) return;
    try {
      const body: ResplitInput = { count: preview.count, version: preview.version };
      const view = await request<ProjectView>(`/projects/${id}/resplit`, { method: 'POST', body });
      onChange(view);
      show(r.done);
      onClose();
    } catch (err) {
      // Toasts; a 409 (STALE_PREVIEW included) also reloads the project behind the sheet.
      onError(err);
      if (errorCode(err) === 'STALE_PREVIEW') setAttempt((n) => n + 1);
    }
  };

  const num = (value: number | null, bold = false) => (
    <Txt v="small" size={13} weight={bold ? 700 : 600} tabular style={s.num}>
      {value === null ? r.dash : formatTotal(value)}
    </Txt>
  );

  let table;
  if (error) {
    table = (
      <View style={s.center}>
        <Txt v="small" color="bad" center>
          {t.errors[error]}
        </Txt>
        <Button title={t.common.retry} kind="soft" small onPress={() => setAttempt((n) => n + 1)} />
      </View>
    );
  } else if (!preview) {
    table = (
      <View style={s.center}>
        <ActivityIndicator color={c.grape} />
      </View>
    );
  } else {
    table = (
      <View style={{ gap: 6, opacity: loading ? 0.5 : 1 }} aria-busy={loading}>
        <View style={s.row}>
          <Txt v="meta" size={12} weight={700} style={s.name}>
            {r.colPackage}
          </Txt>
          <Txt v="meta" size={12} weight={700} style={s.num}>
            {r.colBefore}
          </Txt>
          <View style={s.arrow} />
          <Txt v="meta" size={12} weight={700} style={s.num}>
            {r.colAfter}
          </Txt>
        </View>
        {sortRows(preview.rows).map((row, i) => {
          const added = row.packageId === null;
          return (
            <View key={row.packageId ?? `new-${i}`} style={s.row}>
              <Txt v="small" weight={added ? 700 : 400} style={s.name}>
                {rowLabel(row)}
              </Txt>
              {num(row.before)}
              <Txt v="small" color="muted" style={s.arrow} aria-hidden>
                →
              </Txt>
              {num(row.after, added)}
            </View>
          );
        })}
      </View>
    );
  }

  return (
    <>
      <Sheet visible={!confirming} onClose={onClose} title={r.title}>
        <Txt v="small" color="ink2">
          {r.intro}
        </Txt>
        <Field label={r.count} small={range.min === holders ? r.minMembers(holders) : r.minCount(range.min)}>
          <Stepper value={count} min={range.min} max={range.max} onChange={setCount} lessLabel={r.less} moreLabel={r.more} />
        </Field>
        <View style={s.box}>{table}</View>
        {preview && !error ? (
          <Txt v="meta">
            {lockedLine(preview)}
            {waiting.length > 0 && freeAfter ? r.freeHint(waiting) : ''}
          </Txt>
        ) : null}
        <View style={{ marginTop: 4 }}>
          <Button title={r.apply} block disabled={!ready} onPress={() => setConfirming(true)} />
        </View>
      </Sheet>
      <ConfirmSheet
        visible={confirming}
        title={r.confirmTitle}
        body={r.confirmBody}
        confirmLabel={r.confirm}
        onConfirm={apply}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
