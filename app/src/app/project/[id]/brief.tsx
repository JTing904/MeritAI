import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View, type ScrollView } from 'react-native';
import { projectTag } from '@shared/format';
import type { BriefView, ProjectView } from '@shared/types';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { AppBar, Screen } from '@/components/Screen';
import { Txt } from '@/components/Txt';
import { memberById } from '@/features/project/parts';
import { useProject } from '@/features/project/useProject';
import { useI18n } from '@/i18n';
import { errorCode, type ClientErrorCode } from '@/lib/api';
import { useSession } from '@/lib/session';
import { makeStyles, useTheme } from '@/theme';
import { mix } from '@/theme/color';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    fileCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    grow: { flex: 1, minWidth: 0, gap: 2 },
    // The mockup's `.brief-doc`: the text as paragraphs, each task's item as its own block.
    doc: { gap: 10 },
    item: { gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16 },
    // `.item.on`: lemon 30% into card with a lemon ring (70% into card).
    itemOn: {
      backgroundColor: c.hl.lemon.tile,
      borderWidth: 2,
      borderColor: mix(c.hl.lemon.base, c.card, 0.7),
      paddingVertical: 8,
      paddingHorizontal: 12,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  }),
);

type Item = BriefView['items'][number];
/** Consecutive lines of the text: an item's range (one block, possibly several tasks) or plain text between. */
type Segment = { from: number; to: number; items: Item[] };

/**
 * Cuts the text into blocks: every item's [from, to) is one block. Items with the same range (a split task's
 * parts, the pieces of an inline list) share it; a range that starts inside the previous block is merged into it.
 */
function segments(lineCount: number, items: Item[]): Segment[] {
  const sorted = items
    .filter((it) => it.from >= 0 && it.from < lineCount && it.to > it.from)
    .sort((a, b) => a.from - b.from || b.to - a.to);
  const blocks: Segment[] = [];
  for (const it of sorted) {
    const last = blocks[blocks.length - 1];
    if (last && it.from < last.to) {
      last.items.push(it);
      last.to = Math.max(last.to, Math.min(it.to, lineCount));
    } else {
      blocks.push({ from: it.from, to: Math.min(it.to, lineCount), items: [it] });
    }
  }
  const out: Segment[] = [];
  let at = 0;
  for (const block of blocks) {
    if (block.from > at) out.push({ from: at, to: block.from, items: [] });
    out.push(block);
    at = block.to;
  }
  if (at < lineCount) out.push({ from: at, to: lineCount, items: [] });
  return out;
}

/** Non-blank lines grouped into paragraphs: a run of blank lines is one gap. */
function paragraphs(lines: string[]): string[] {
  const out: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim()) current.push(line);
    else if (current.length > 0) {
      out.push(current.join('\n'));
      current = [];
    }
  }
  if (current.length > 0) out.push(current.join('\n'));
  return out;
}

/**
 * 作业要求 (M4 spec §10, board 15): the brief's text as the parser read it, verbatim. Each task's item is a
 * block with a chip naming whose task it is; `?task=` highlights that task's block and scrolls to it.
 */
export default function BriefScreen() {
  const { id, task: taskId } = useLocalSearchParams<{ id: string; task?: string }>();
  const { t } = useI18n();
  const { c } = useTheme();
  const b = t.project.brief;
  const { request } = useSession();
  const { project, error: projectError, reload: reloadProject } = useProject(id);
  const [brief, setBrief] = useState<BriefView | null>(null);
  const [briefError, setBriefError] = useState<ClientErrorCode | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const scrolled = useRef(false);
  // Once, on load: bring the highlighted block into view (a little of the text above it stays visible).
  const scrollTo = useCallback((y: number) => {
    if (scrolled.current) return;
    scrolled.current = true;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
  }, []);

  const loadBrief = useCallback(() => {
    setBriefError(null);
    request<BriefView>(`/projects/${encodeURIComponent(id)}/brief`)
      .then(setBrief)
      .catch((err) => setBriefError(errorCode(err)));
  }, [id, request]);
  useEffect(() => loadBrief(), [loadBrief]);

  let sub: string | undefined;
  if (project) {
    const tag = projectTag(project.basics.name, project.basics.shortCode);
    sub = tag === project.basics.name.trim() ? tag : b.sub(tag, project.basics.name);
  }

  const error = projectError ?? briefError;
  const retry = () => {
    if (projectError) void reloadProject();
    if (briefError) loadBrief();
  };

  return (
    <Screen header={<AppBar title={b.title} sub={sub} />} scrollRef={scrollRef}>
      {error && !(project && brief) ? (
        <Card style={{ gap: 12 }}>
          <Txt v="text" color="bad">
            {t.errors[error]}
          </Txt>
          {error !== 'NO_BRIEF' ? <Button title={t.common.retry} kind="soft" onPress={retry} /> : null}
        </Card>
      ) : !project || !brief ? (
        <ActivityIndicator color={c.grape} style={{ paddingVertical: 24 }} />
      ) : (
        <BriefBody project={project} brief={brief} taskId={taskId ?? null} onHighlight={scrollTo} />
      )}
    </Screen>
  );
}

function BriefBody({
  project,
  brief,
  taskId,
  onHighlight,
}: {
  project: ProjectView;
  brief: BriefView;
  taskId: string | null;
  /** The highlighted block's top, in the page's scroll content. */
  onHighlight: (y: number) => void;
}) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const b = t.project.brief;
  const lines = brief.text.split('\n');
  const highlighted = taskId !== null && brief.items.some((it) => it.taskId === taskId);
  const fileName = brief.fileName ?? b.typed;
  // Both offsets are needed: the block's is relative to the document card, the card's to the page.
  const docY = useRef<number | null>(null);
  const blockY = useRef<number | null>(null);
  const report = () => {
    if (docY.current !== null && blockY.current !== null) onHighlight(docY.current + blockY.current);
  };

  const chip = (it: Item) => {
    if (it.ownerMemberId !== null && it.ownerMemberId === project.viewerMemberId) return b.mine(it.title);
    const owner = memberById(project, it.ownerMemberId);
    return owner ? b.theirs(owner.name, it.title) : b.nobody(it.title);
  };

  return (
    <>
      <Card style={s.fileCard}>
        <Icon name="file" size={22} color={c.muted} />
        <View style={s.grow}>
          <Txt v="text" weight={700}>
            {fileName}
          </Txt>
          <Txt v="meta">{brief.fileName ? b.hint(brief.fileName, highlighted) : b.hintTyped(highlighted)}</Txt>
        </View>
      </Card>
      <View
        onLayout={(e) => {
          docY.current = e.nativeEvent.layout.y;
          report();
        }}>
        <Card style={s.doc}>
          {segments(lines.length, brief.items).map((seg) => {
            const block = lines.slice(seg.from, seg.to);
            if (seg.items.length === 0) {
              return paragraphs(block).map((p, i) => (
                <Txt key={`${seg.from}:${i}`} v="text" style={{ lineHeight: 24 }}>
                  {p}
                </Txt>
              ));
            }
            const on = seg.items.some((it) => it.taskId === taskId);
            // The item's own line is its heading; the lines under it stay as written (their own markers).
            const headAt = Math.max(0, block.findIndex((line) => line.trim()));
            const head = block[headAt] ?? '';
            const rest = block.slice(headAt + 1);
            return (
              <View
                key={seg.from}
                style={[s.item, on && s.itemOn]}
                onLayout={
                  on
                    ? (e) => {
                        blockY.current = e.nativeEvent.layout.y;
                        report();
                      }
                    : undefined
                }>
                <View style={s.chips}>
                  {seg.items.map((it) => (
                    <Chip key={it.taskId} tone="grape">
                      {chip(it)}
                    </Chip>
                  ))}
                </View>
                <Txt v="h3">{head.trim()}</Txt>
                {paragraphs(rest).map((p, i) => (
                  <Txt key={i} v="text" color="ink2" style={{ lineHeight: 24 }}>
                    {p}
                  </Txt>
                ))}
              </View>
            );
          })}
        </Card>
      </View>
    </>
  );
}
