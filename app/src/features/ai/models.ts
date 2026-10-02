import type { AiProviderName } from '@shared/constants';
import type { AiFailReason } from '@shared/types';
import type { FallbackKey } from '@/i18n/sections/ai.zh';

// The model that graded, as people read it: 「AI 审核 · Gemini 3.8 Flash」. Ids the app doesn't know are
// shown as they are.

const PROVIDER_NAMES: Record<AiProviderName, string> = { GEMINI: 'Gemini', CLAUDE: 'Claude', OPENAI: 'OpenAI' };

const KNOWN: Record<string, string> = {
  'gemini-flash-latest': 'Gemini Flash',
  'gemini-flash-lite-latest': 'Gemini Flash Lite',
  'gemini-pro-latest': 'Gemini Pro',
};

const word = (w: string) => (w ? w[0]!.toUpperCase() + w.slice(1) : w);

/** gemini-3.8-flash → Gemini 3.8 Flash; claude-haiku-4-5 → Claude Haiku 4.5; gpt-5-mini → GPT-5 mini. */
export function modelName(id: string | null, provider: AiProviderName | null): string {
  if (!id) return provider ? PROVIDER_NAMES[provider] : 'AI';
  const raw = id.trim();
  const lower = raw.toLowerCase().replace(/^models\//, '');
  if (KNOWN[lower]) return KNOWN[lower];
  // gemini-3.8-flash, gemini-3.5-flash-lite, gemini-2.5-pro (a -preview-… / -001 tail is dropped)
  const g = /^gemini-(\d+(?:\.\d+)?)-(flash|pro)(-lite)?(?:-(?:latest|preview.*|exp.*|\d{3}))?$/.exec(lower);
  if (g) return `Gemini ${g[1]} ${word(g[2]!)}${g[3] ? ' Lite' : ''}`;
  // claude-haiku-4-5, claude-sonnet-5, claude-opus-4-1-20250805
  const c = /^claude-(haiku|sonnet|opus)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(lower);
  if (c) return `Claude ${word(c[1]!)} ${c[2]}${c[3] ? `.${c[3]}` : ''}`;
  // gpt-5.6, gpt-5-mini
  const o = /^gpt-(\d+(?:\.\d+)?)(?:-(mini|nano))?$/.exec(lower);
  if (o) return `GPT-${o[1]}${o[2] ? ` ${o[2]}` : ''}`;
  return raw;
}

/** How the task page and the notifications group a reason the AI didn't grade. */
export function fallbackKey(reason: AiFailReason | null): FallbackKey {
  switch (reason) {
    case 'QUOTA':
      return 'QUOTA';
    case 'INVALID':
    case 'NO_KEY':
      return 'KEY';
    case 'LINKS_ONLY':
      return 'LINKS_ONLY';
    case 'UNREADABLE':
      return 'UNREADABLE';
    case 'TASK_LIMIT':
    case 'PROJECT_LIMIT':
      return 'LIMIT';
    default:
      return 'ERROR';
  }
}

/** The key's first characters (the rest is dots, then last4): 「AIza••••••••3kQx」. */
/** Only the last 4 characters: key formats change (Gemini keys no longer all start with AIza). */
export function maskedKey(_provider: AiProviderName, last4: string): string {
  return `••••••••${last4}`;
}

/** 09:00 (device zone) of when the counts reset, for providers other than Gemini. */
export function resetClock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
