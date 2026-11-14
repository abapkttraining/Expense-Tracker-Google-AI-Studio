import { useCallback, useEffect, useSyncExternalStore } from 'react';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'khata-theme';

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') {
      return stored;
    }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    // Ignore storage errors in restricted contexts
  }
  return 'light';
}

function applyThemeToDom(theme: ThemeMode) {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Ignore storage errors
    }
  }
}

let currentTheme: ThemeMode = getInitialTheme();
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function setThemeStore(next: ThemeMode) {
  if (currentTheme === next) return;
  currentTheme = next;
  applyThemeToDom(next);
  emitChange();
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY && (event.newValue === 'light' || event.newValue === 'dark')) {
      if (currentTheme !== event.newValue) {
        currentTheme = event.newValue;
        applyThemeToDom(currentTheme);
        emitChange();
      }
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorage);
  }

  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', handleStorage);
    }
  };
}

function getSnapshot(): ThemeMode {
  return currentTheme;
}

function getServerSnapshot(): ThemeMode {
  return 'light';
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    applyThemeToDom(theme);
  }, [theme]);

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeStore(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeStore(currentTheme === 'dark' ? 'light' : 'dark');
  }, []);

  return {
    theme,
    isDark: theme === 'dark',
    setTheme,
    toggleTheme,
  };
}
