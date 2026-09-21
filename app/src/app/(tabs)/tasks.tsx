import { useState, type ReactNode } from 'react';
import { ActivityIndicator, RefreshControl } from 'react-native';
import { Button } from '@/components/Button';
import { Card, List, SectionHeader } from '@/components/Card';
import { Seg } from '@/components/Controls';
import { PageTitle, Screen } from '@/components/Screen';
import { Txt } from '@/components/Txt';
import { groupOpen, sortDone } from '@/features/tasks/group';
import { DoneTaskRow, OpenTaskRow } from '@/features/tasks/TaskRow';
import { useMyTasks } from '@/features/tasks/useMyTasks';
import { useI18n } from '@/i18n';
import { useTheme } from '@/theme';
import { appNow } from '@/lib/lifecycle';

type Tab = 'open' | 'done';

/** 我的任务 tab (TasksTab board, M4 spec §10): every task I own in my active projects. */
export default function TasksScreen() {
  const { t } = useI18n();
  const { c } = useTheme();
  const list = useMyTasks();
  const [tab, setTab] = useState<Tab>('open');
  const data = list.data;
  const now = appNow();
  const copy = t.tasks;

  const groups = data ? groupOpen(data.open, now) : [];
  const done = data ? sortDone(data.done) : [];

  return (
    <Screen
      bottomInset={false}
      refreshControl={
        <RefreshControl
          refreshing={list.refreshing}
          onRefresh={list.refresh}
          tintColor={c.grape}
          colors={[c.grape]}
          progressBackgroundColor={c.card}
        />
      }>
      <PageTitle>{copy.title}</PageTitle>
      <Seg
        options={[
          { value: 'open', label: copy.filter.open(data?.open.length ?? 0) },
          { value: 'done', label: copy.filter.done(data?.done.length ?? 0) },
        ]}
        value={tab}
        onChange={setTab}
        label={copy.filterLabel}
      />

      {data === null && !list.error && <ActivityIndicator color={c.grape} style={{ paddingVertical: 24 }} />}

      {data === null && list.error && (
        <Card style={{ gap: 12 }}>
          <Txt v="text" color="bad">
            {t.errors[list.error]}
          </Txt>
          <Button title={t.common.retry} kind="soft" onPress={list.retry} />
        </Card>
      )}

      {data && tab === 'open' && (
        <>
          {data.withoutPackage.map((p) => (
            <Txt key={p.projectId} v="meta" center>
              {copy.withoutPackage(p.projectTag)}
            </Txt>
          ))}
          {groups.length === 0 && (
            <Card>
              <Txt v="text" color="muted" center>
                {copy.emptyOpen}
              </Txt>
            </Card>
          )}
          {groups.map((g) => (
            <GroupBlock key={g.key} title={copy.group[g.key]}>
              {g.rows.map((item) => (
                <OpenTaskRow key={item.row.id} item={item} now={now} />
              ))}
            </GroupBlock>
          ))}
        </>
      )}

      {data && tab === 'done' && (
        <>
          {done.length === 0 ? (
            <Card>
              <Txt v="text" color="muted" center>
                {copy.emptyDone}
              </Txt>
            </Card>
          ) : (
            <List>
              {done.map((row) => (
                <DoneTaskRow key={row.id} row={row} />
              ))}
            </List>
          )}
        </>
      )}

      {data && (
        <Txt v="meta" center>
          {copy.footer}
        </Txt>
      )}
    </Screen>
  );
}

function GroupBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <SectionHeader title={title} />
      <List>{children}</List>
    </>
  );
}
