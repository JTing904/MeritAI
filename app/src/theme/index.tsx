import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { PREF, readPref, writePref } from '@/lib/prefs';
import { darkColors, lightColors, type Colors } from './tokens';

export type ThemeMode = 'system' | 'light' | 'dark';

type ThemeValue = {
  c: Colors;
  dark: boolean;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeValue | null>(null);

const isMode = (v: string | null): v is ThemeMode => v === 'system' || v === 'light' || v === 'dark';

/** Theme follows the system unless the user picks light or dark in 我 → 外观 (stored per device). */
export function ThemeProvider({ children, onReady }: { children: ReactNode; onReady?: () => void }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    readPref(PREF.theme).then((saved) => {
      if (isMode(saved)) setModeState(saved);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (loaded) onReady?.();
  }, [loaded, onReady]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void writePref(PREF.theme, next === 'system' ? null : next);
  }, []);

  const dark = mode === 'dark' || (mode === 'system' && system === 'dark');
  const value = useMemo(() => ({ c: dark ? darkColors : lightColors, dark, mode, setMode }), [dark, mode, setMode]);

  if (!loaded) return null;
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}

/** Build theme-aware styles once per palette: `const useStyles = makeStyles((c) => StyleSheet.create({...}))`. */
export function makeStyles<T>(factory: (c: Colors) => T): () => T {
  const cache = new WeakMap<Colors, T>();
  return function useStyles() {
    const { c } = useTheme();
    let styles = cache.get(c);
    if (!styles) {
      styles = factory(c);
      cache.set(c, styles);
    }
    return styles;
  };
}

export { type Colors } from './tokens';
