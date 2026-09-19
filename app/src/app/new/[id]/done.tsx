import { useLocalSearchParams } from 'expo-router';
import { DoneStep } from '@/features/wizard/DoneStep';

/** Step 6: the packages are made; invite the team. */
export default function DoneScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <DoneStep id={id} />;
}
