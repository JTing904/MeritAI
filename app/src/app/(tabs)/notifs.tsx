import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, RefreshControl, View } from 'react-native';
import type { NotificationView, ProjectView } from '@shared/types';
import { Button, LinkButton } from '@/components/Button';
import { Card } from '@/components/Card';
import { Seg } from '@/components/Controls';
import { PageTitle, Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { describeNotification, type NotifAction } from '@/features/notifs/describe';
import { NotifCard } from '@/features/notifs/NotifCard';
import { sendToWhatsApp } from '@/features/notifs/whatsapp';
import { useNotifications, type NotifFilter } from '@/features/notifs/useNotifications';
import { useI18n } from '@/i18n';
import { errorCode } from '@/lib/api';
import { appNow } from '@/lib/lifecycle';
import { useSession } from '@/lib/session';
import { relativeTime } from '@/lib/time';
import { useTheme } from '@/theme';

/** 通知 tab (NotifsM3 mockup + prototype §4.3). */
export default function NotifsScreen() {
  const { t } = useI18n();
  const { c } = useTheme();
  const { request } = useSession();
  const { show } = useToast();
  const list = useNotifications();
  const [busy, setBusy] = useState<{ id: string; action: NotifAction } | null>(null);
  // The server's clock (the time machine moves it in development builds).
  const now = appNow();

  const answerSwap = async (n: NotificationView, action: 'accept' | 'decline') => {
    const swapId = n.swap?.id;
    if (!swapId || busy) return;
    setBusy({ id: n.id, action });
    try {
      const view = await request<ProjectView>(`/swaps/${encodeURIComponent(swapId)}/${action}`, { method: 'POST' });
      if (action === 'accept') {
        const mine = view.packages.find((p) => p.ownerMemberId === view.viewerMemberId);
        const fallback = n.payload.type === 'SWAP_REQUEST' ? n.payload.requesterPackageIndex : 0;
        show(t.notifs.toast.accepted(mine?.index ?? fallback));
      } else show(t.notifs.toast.declined);
    } catch (err) {
      show(t.errors[errorCode(err)]);
    }
    // The card shows the swap's new state (or why it no longer applies) after the reload.
    await list.reload();
    setBusy(null);
  };

  const filters: { value: NotifFilter; label: string }[] = [
    { value: 'all', label: t.notifs.filter.all },
    { value: 'mine', label: t.notifs.filter.mine },
  ];

  return (
    <Screen
      bottomInset={false}
      // After a failed page only 再试一次 loads more: scrolling must not retry in a loop.
      onEndReached={list.moreFailed ? undefined : () => void list.loadMore()}
      refreshControl={
        <RefreshControl
          refreshing={list.refreshing}
          onRefresh={list.refresh}
          tintColor={c.grape}
          colors={[c.grape]}
          progressBackgroundColor={c.card}
        />
      }>
      <PageTitle>{t.notifs.title}</PageTitle>
      <Seg options={filters} value={list.filter} onChange={list.setFilter} label={t.notifs.filterLabel} />

      {list.items === null && !list.error && <ActivityIndicator color={c.grape} style={{ paddingVertical: 24 }} />}

      {list.items === null && list.error && (
        <Card style={{ gap: 12 }}>
          <Txt v="text" color="bad">
            {t.errors[list.error]}
          </Txt>
          <Button title={t.common.retry} kind="soft" onPress={list.retry} />
        </Card>
      )}

      {list.items?.length === 0 && (
        <Card>
          <Txt v="text" color="muted" center>
            {t.notifs.empty}
          </Txt>
        </Card>
      )}

      {list.items?.map((n) => {
        const look = describeNotification(n, t.notifs, t.labels, t.ai);
        if (!look) return null;
        const meta = [
          // M6: a key problem is about every project the user leads, not one.
          n.projectTag ?? (n.type === 'AI_KEY_PROBLEM' ? t.ai.notifs.allLed : null),
          n.type === 'WEEKLY_SUMMARY' ? t.notifs.weeklyMeta : null,
          n.audience && t.notifs.audience[n.audience],
          relativeTime(n.createdAt, t.labels.relative, now),
        ]
          .filter(Boolean)
          .join(' · ');
        const href = look.href;
        return (
          <NotifCard
            key={n.id}
            look={look}
            meta={meta}
            unread={list.isUnread(n)}
            busy={busy?.id === n.id ? busy.action : null}
            onOpen={href ? () => router.push(href) : null}
            onAction={(action) => {
              if (action === 'accept' || action === 'decline') void answerSwap(n, action);
              else if (action === 'whatsapp') {
                if (look.share) void sendToWhatsApp(look.share).catch(() => show(t.errors.NETWORK));
              } else {
                const target = look.to?.[action] ?? href;
                if (target) router.push(target);
              }
            }}
          />
        );
      })}

      {list.loadingMore && <ActivityIndicator color={c.grape} style={{ paddingVertical: 8 }} />}
      {list.moreFailed && (
        <View style={{ alignItems: 'center' }}>
          <LinkButton title={t.common.retry} onPress={list.retryMore} />
        </View>
      )}

      {list.items && (
        <Txt v="meta" center>
          {t.notifs.footer}
        </Txt>
      )}
    </Screen>
  );
}
