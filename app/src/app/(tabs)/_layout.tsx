import { Tabs } from 'expo-router/js-tabs';
import { useEffect } from 'react';
import { TabBar } from '@/components/TabBar';
import { useUnread } from '@/features/notifs/useUnread';
import { useTheme } from '@/theme';

export default function TabsLayout() {
  const { c } = useTheme();
  const { count, refresh } = useUnread();

  // The badge is fetched again whenever the tab bar appears.
  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} unread={count} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.paper } }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="tasks" />
      <Tabs.Screen name="notifs" />
      <Tabs.Screen name="me" />
    </Tabs>
  );
}
