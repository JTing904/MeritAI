import { getLocales } from 'expo-localization';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { PREF, readPref, writePref } from '@/lib/prefs';
import { en } from './en';
import { zh, type Messages } from './zh';

export type Locale = 'zh' | 'en';

const MESSAGES: Record<Locale, Messages> = { zh, en };

/** First launch follows the phone's language; 我 → 语言 overrides it per device. */
function deviceLocale(): Locale {
  try {
    return getLocales()[0]?.languageCode === 'zh' ? 'zh' : 'en';
  } catch {
    return 'zh';
  }
}

type I18nValue = { t: Messages; locale: Locale; setLocale: (l: Locale) => void };

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale | null>(null);

  useEffect(() => {
    readPref(PREF.locale).then((saved) => setLocaleState(saved === 'zh' || saved === 'en' ? saved : deviceLocale()));
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    void writePref(PREF.locale, next);
  }, []);

  // Web: screen readers and the browser's translate prompt follow the document language.
  useEffect(() => {
    if (Platform.OS === 'web' && locale && typeof document !== 'undefined') {
      document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
    }
  }, [locale]);

  const value = useMemo(() => (locale ? { t: MESSAGES[locale], locale, setLocale } : null), [locale, setLocale]);
  if (!value) return null;
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}
