import { Linking, Platform } from 'react-native';

/**
 * 发到 WhatsApp: opens WhatsApp with the text filled in (the person picks the chat). Android tries the app
 * first (whatsapp://send) and falls back to wa.me in the browser; the web always uses wa.me (new tab).
 */
export async function sendToWhatsApp(text: string): Promise<void> {
  const q = encodeURIComponent(text);
  const web = `https://wa.me/?text=${q}`;
  if (Platform.OS !== 'web') {
    try {
      await Linking.openURL(`whatsapp://send?text=${q}`);
      return;
    } catch {
      // WhatsApp isn't installed: the browser page offers to open or install it.
    }
  }
  await Linking.openURL(web);
}
