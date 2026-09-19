import { useLocalSearchParams } from 'expo-router';
import { JoinScreen } from '@/features/join/JoinScreen';

/** Invite links (meritai://join/CS302-7Q4P) open here with the code filled in. */
export default function JoinCodeRoute() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  return <JoinScreen key={code ?? ''} initialCode={code ?? ''} />;
}
