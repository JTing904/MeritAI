import { DevNote } from '@/components/DevNote';
import { PageTitle, Screen } from '@/components/Screen';
import { useI18n } from '@/i18n';

export default function TasksScreen() {
  const { t } = useI18n();
  return (
    <Screen bottomInset={false}>
      <PageTitle>{t.tasks.title}</PageTitle>
      <DevNote milestone="M4" />
    </Screen>
  );
}
