import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { givenName } from '@shared/format';
import type { ActivityView, FeedPage, PersonRef, ProjectView } from '@shared/types';
import { Avatar } from '@/components/Avatar';
import { Button, LinkButton } from '@/components/Button';
import { Card, List } from '@/components/Card';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import type { Messages } from '@/i18n/zh';
import type { Inline, Who } from '@/i18n/sections/project.zh';
import { errorCode, type ClientErrorCode } from '@/lib/api';
import { queryCache } from '@/lib/cache';
import { projectKey } from '@/lib/cacheKeys';
import { useSession } from '@/lib/session';
import { relativeTime } from '@/lib/time';
import { makeStyles, useTheme } from '@/theme';
import { InlineText, useLocalDates } from './parts';

const PAGE = 30;

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    item: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 12, paddingHorizontal: 14 },
    body: { flex: 1, minWidth: 0 },
    noAvatar: { width: 26, height: 26, borderRadius: 13, backgroundColor: c.waiting },
  }),
);

export type FeedState = {
  items: ActivityView[] | null;
  error: ClientErrorCode | null;
  /** More pages exist. */
  hasMore: boolean;
  loadingMore: boolean;
  /** The last "more" page failed: offer 再试一次 instead of loading on scroll (which would retry in a loop). */
  moreFailed: boolean;
  reload: () => void;
  /** Next page (Screen.onEndReached); does nothing after a failed page until retryMore. */
  loadMore: () => void;
  /** 再试一次 after a failed page. */
  retryMore: () => void;
};

/**
 * GET /projects/:id/feed, newest first. Loads while `active` (the 动态 tab is showing) and again whenever
 * `version` changes (every feed event also bumps the project's packagesVersion). The first page goes
 * through the data cache: the last copy shows at once, and showing the tab again within 30 s with the
 * same version doesn't ask again.
 */
export function useFeed(projectId: string, active: boolean, version: number): FeedState {
  const { request, cached } = useSession();
  const firstKey = `${projectKey(projectId)}/feed?limit=${PAGE}`;
  const [items, setItems] = useState<ActivityView[] | null>(() => queryCache.peek<FeedPage>(firstKey)?.items ?? null);
  const [cursor, setCursor] = useState<string | null>(() => queryCache.peek<FeedPage>(firstKey)?.nextCursor ?? null);
  // The version the first page was last loaded for: a new one always asks the server.
  const loadedFor = useRef<number | null>(null);
  const [error, setError] = useState<ClientErrorCode | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  // A newer first-page load makes older responses (first page or "more") stale.
  const generation = useRef(0);
  const moreBusy = useRef(false);
  // Set as soon as a page fails (before the re-render drops Screen.onEndReached), so a late content-size
  // check can't send the same page again.
  const moreFailedRef = useRef(false);

  const load = useCallback((force: boolean, forVersion: number | null) => {
    const gen = ++generation.current;
    moreBusy.current = false;
    moreFailedRef.current = false;
    setLoadingMore(false);
    setMoreFailed(false);
    setError(null);
    cached<FeedPage>(firstKey, { force })
      .then(({ data: page }) => {
        if (gen !== generation.current) return;
        if (forVersion !== null) loadedFor.current = forVersion;
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch((err) => {
        if (gen !== generation.current) return;
        // With the kept copy on screen, keep it (as the other cached screens do).
        if (!queryCache.has(firstKey)) setError(errorCode(err));
      });
  }, [firstKey, cached]);

  /** 再试一次 and other explicit reloads: always ask the server. */
  const reload = useCallback(() => load(true, null), [load]);

  useEffect(() => {
    if (active) load(loadedFor.current !== null && loadedFor.current !== version, version);
  }, [active, version, load]);

  const loadMore = useCallback(() => {
    if (!cursor || moreBusy.current || moreFailedRef.current) return;
    const gen = generation.current;
    moreBusy.current = true;
    setLoadingMore(true);
    setMoreFailed(false);
    request<FeedPage>(`/projects/${encodeURIComponent(projectId)}/feed?limit=${PAGE}&cursor=${encodeURIComponent(cursor)}`)
      .then((page) => {
        if (gen !== generation.current) return;
        setItems((prev) => {
          const seen = new Set((prev ?? []).map((i) => i.id));
          return [...(prev ?? []), ...page.items.filter((i) => !seen.has(i.id))];
        });
        setCursor(page.nextCursor);
      })
      .catch(() => {
        // 再试一次 (FeedList) loads it again; the project page stops loading on scroll meanwhile.
        if (gen !== generation.current) return;
        moreFailedRef.current = true;
        setMoreFailed(true);
      })
      .finally(() => {
        if (gen !== generation.current) return;
        moreBusy.current = false;
        setLoadingMore(false);
      });
  }, [cursor, projectId, request]);

  const retryMore = useCallback(() => {
    moreFailedRef.current = false;
    loadMore();
  }, [loadMore]);

  return { items, error, hasMore: cursor !== null, loadingMore, moreFailed, reload, loadMore, retryMore };
}

/** One feed sentence (§9): short names, 你 for the viewer. */
function sentence(
  item: ActivityView,
  viewerId: string,
  f: Messages['project']['feed'],
  grades: Messages['labels']['grade'],
  date: (iso: string) => string,
  ai: Messages['ai']['feed'],
): Inline[] {
  const person = (p: PersonRef): Who => ({ name: givenName(p.name), you: p.memberId === viewerId });
  const a: Who = item.actor ? person(item.actor) : { name: f.someone, you: false };
  const someone: Who = { name: f.someone, you: false };
  const p = item.payload;
  switch (p.type) {
    case 'PLAN_CONFIRMED':
      return f.PLAN_CONFIRMED(a, p.packageCount);
    case 'JOINED':
      return f.JOINED(a);
    case 'LEFT':
      return f.LEFT(a);
    case 'REMOVED':
      return f.REMOVED(a, person(p.member));
    case 'PICKED':
      return f.PICKED(a, p.packageIndex);
    case 'SWITCHED':
      return f.SWITCHED(a, p.fromPackageIndex, p.toPackageIndex);
    case 'SWAPPED':
      return f.SWAPPED(a, person(p.requester));
    case 'ASSIGNED':
      return f.ASSIGNED(a, p.packageIndex, person(p.member));
    case 'TASK_ADDED':
      return f.TASK_ADDED(a, p.title, p.packageIndex);
    case 'TASK_MOVED':
      return p.fromPackageIndex === null
        ? f.TASK_MOVED_UNPACKAGED(a, p.title, p.toPackageIndex)
        : f.TASK_MOVED(a, p.title, p.fromPackageIndex, p.toPackageIndex);
    case 'TASK_STARTED':
      return f.TASK_STARTED(a, p.title);
    case 'RESPLIT':
      return f.RESPLIT(a, p.packageCount);
    case 'LEADER_TRANSFERRED':
      return f.LEADER_TRANSFERRED(a, person(p.member));
    case 'SUBMITTED':
      return f.SUBMITTED(a, p.title, p.attemptNo);
    case 'WITHDRAWN':
      return f.WITHDRAWN(a, p.title);
    case 'GRADED': {
      if (p.selfGraded) return f.GRADED_SELF(a, p.title);
      const owner = p.owner ? person(p.owner) : someone;
      // M6: graded by the AI (no actor).
      if (p.byAi) return ai.GRADED_AI(owner, p.title, grades[p.grade]);
      return p.outsideApp ? f.GRADED_OUTSIDE(a, owner, p.title, grades[p.grade]) : f.GRADED(a, owner, p.title, grades[p.grade]);
    }
    case 'OVERRIDDEN':
      return p.undone
        ? f.OVERRIDE_UNDONE(a, p.title, grades[p.toGrade])
        : f.OVERRIDDEN(a, p.owner ? person(p.owner) : someone, p.title, grades[p.fromGrade], grades[p.toGrade]);
    case 'MEETING_DONE':
      return f.MEETING_DONE(a, p.title, p.attendeeCount);
    case 'START_UNDONE':
      return f.START_UNDONE(a, p.title);
    case 'PREREQ_SET':
      return p.cleared || p.prereqTitle === null
        ? f.PREREQ_CLEARED(a, p.title)
        : f.PREREQ_SET(a, p.title, p.prereqTitle, p.prereqOwner ? person(p.prereqOwner) : null);
    case 'PROJECT_DELETED':
      return f.PROJECT_DELETED(a);
    case 'PROJECT_RESTORED':
      return f.PROJECT_RESTORED(a);
    case 'PROJECT_ENDED':
      return p.auto || !item.actor ? f.PROJECT_ENDED_AUTO() : f.PROJECT_ENDED(a);
    case 'PROJECT_REOPENED':
      return f.PROJECT_REOPENED(a, date(p.deadline));
    case 'TASK_DELAYED':
      return f.TASK_DELAYED(a, p.title, date(p.dueAt));
    case 'CHOICE_CHANGED':
      return ai.CHOICE_CHANGED(a, p.prompt, p.from.join(ai.labelSep), p.to.join(ai.labelSep));
    case 'TASKS_RESPLIT':
      return ai.TASKS_RESPLIT(a, p.kept, p.removed, p.added);
  }
}

/** The 动态 tab (`.feed-item` list). */
export function FeedList({ project, feed }: { project: ProjectView; feed: FeedState }) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const f = t.project.feed;
  const dates = useLocalDates();

  if (feed.error && !feed.items) {
    return (
      <Card style={{ gap: 12 }}>
        <Txt v="text" color="bad">
          {t.errors[feed.error]}
        </Txt>
        <Button title={t.common.retry} kind="soft" onPress={feed.reload} />
      </Card>
    );
  }
  if (!feed.items) return <ActivityIndicator color={c.grape} style={{ paddingVertical: 24 }} />;
  if (feed.items.length === 0) {
    return (
      <Card>
        <Txt v="meta" center>
          {f.empty}
        </Txt>
      </Card>
    );
  }

  return (
    <>
      <List>
        {feed.items.map((item) => (
          <View key={item.id} style={s.item}>
            {item.actor ? <Avatar name={item.actor.name} hl={item.actor.color} size="sm" decorative /> : <View style={s.noAvatar} />}
            <View style={s.body}>
              <InlineText parts={sentence(item, project.viewerMemberId, f, t.labels.grade, dates.date, t.ai.feed)} v="small" />
              <Txt v="meta" size={11.5} style={{ marginTop: 2 }}>
                {relativeTime(item.createdAt, t.labels.relative)}
              </Txt>
            </View>
          </View>
        ))}
      </List>
      {feed.loadingMore ? <ActivityIndicator color={c.grape} /> : null}
      {feed.moreFailed ? (
        <View style={{ alignItems: 'center' }}>
          <LinkButton title={t.common.retry} onPress={feed.retryMore} />
        </View>
      ) : null}
    </>
  );
}
