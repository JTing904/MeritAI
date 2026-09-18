import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { DevNote } from '@/components/DevNote';
import { Logo } from '@/components/Logo';
import { Screen } from '@/components/Screen';
import { useI18n } from '@/i18n';
import { useMe } from '@/lib/session';

export default function HomeScreen() {
  const { t } = useI18n();
  const me = useMe();
  return (
    <Screen bottomInset={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6 }}>
        <Logo />
        <Pressable onPress={() => router.navigate('/me')} role="button" aria-label={t.home.myProfile} hitSlop={6}>
          <Avatar name={me.name} hl={me.color} decorative />
        </Pressable>
      </View>
      <DevNote milestone="M2" />
    </Screen>
  );
}
