import { Linking, Platform } from 'react-native';
import type { EvidenceLink, EvidenceView } from '@shared/types';
import type { useSession } from '@/lib/session';

type Request = ReturnType<typeof useSession>['request'];

/**
 * Only plain http(s) addresses without a user name or password open (checked again here even though the
 * server checked when the link was added): no javascript:, data:, intent: or file: links, and no
 * `https://paypal.com@evil.example` tricks.
 */
export function isSafeWebUrl(url: string): boolean {
  const m = /^https?:\/\/([^/?#]*)/i.exec(url.trim());
  if (!m) return false;
  const authority = m[1]!;
  return authority !== '' && !authority.includes('@') && !/[\s\\]/.test(url);
}

/** Opens a checked http(s) address: a new tab without access back to this one on the web, the browser on Android. */
async function openWeb(url: string): Promise<void> {
  if (Platform.OS === 'web') window.open(url, '_blank', 'noopener,noreferrer');
  else await Linking.openURL(url);
}

/**
 * The only way the app opens evidence (task page, GradeSheet). Call it straight from the press handler:
 * on the web the new tab must be opened synchronously inside the tap (Safari and Chrome block pop-ups
 * opened later), so it opens a blank tab first and points it at the signed URL when that arrives.
 * A link opens as is (after isSafeWebUrl; otherwise onUnsafe). A file asks GET /api/evidence/:id/link for a
 * 10-minute signed URL (the browser opens it without our bearer token). On Android, Chrome downloads types it
 * can't show (docx, xlsx) instead of previewing them: expected.
 */
export async function openEvidence(
  request: Request,
  evidence: Pick<EvidenceView, 'id' | 'kind' | 'url'>,
  onError: (err: unknown) => void,
  onUnsafe?: () => void,
): Promise<void> {
  if (evidence.kind === 'LINK') {
    if (!evidence.url) return;
    if (!isSafeWebUrl(evidence.url)) return onUnsafe?.();
    try {
      await openWeb(evidence.url.trim());
    } catch (err) {
      onError(err);
    }
    return;
  }

  // Before any await: still inside the user's tap. Cut the new tab's link back to this page (what noopener
  // does; window.open with noopener returns null, and this tab is needed to point it at the file).
  const tab = Platform.OS === 'web' ? window.open('', '_blank') : null;
  if (tab) tab.opener = null;
  try {
    const { url } = await request<EvidenceLink>(`/evidence/${encodeURIComponent(evidence.id)}/link`);
    if (!isSafeWebUrl(url)) {
      tab?.close();
      return onUnsafe?.();
    }
    if (Platform.OS !== 'web') await Linking.openURL(url);
    else if (tab) tab.location.href = url;
    // The browser blocked the blank tab anyway: open it in this one.
    else window.location.assign(url);
  } catch (err) {
    tab?.close();
    onError(err);
  }
}
