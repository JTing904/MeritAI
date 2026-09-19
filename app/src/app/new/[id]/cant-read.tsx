import { useLocalSearchParams } from 'expo-router';
import { CantReadStep } from '@/features/wizard/CantReadStep';

/** Step 3 when the free rules can't read or split the brief (?reason=UNREADABLE|NO_STRUCTURE&file&size&mime). */
export default function CantReadScreen() {
  const { id, reason, file, size, mime } = useLocalSearchParams<{
    id: string;
    reason?: string;
    file?: string;
    size?: string;
    mime?: string;
  }>();
  const bytes = size ? Number(size) : NaN;
  return (
    <CantReadStep
      id={id}
      reason={reason === 'NO_STRUCTURE' ? 'NO_STRUCTURE' : 'UNREADABLE'}
      fileName={file || null}
      size={Number.isFinite(bytes) ? bytes : null}
      mime={mime || null}
    />
  );
}
