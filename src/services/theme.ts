import {useSyncExternalStore} from 'react';

export type Theme = 'light' | 'dark';
const storageKey = 'twin-theme';
let currentTheme: Theme = 'dark';
const listeners = new Set<() => void>();

export function initialiseTheme() {
  try {
    currentTheme = localStorage.getItem(storageKey) === 'light' ? 'light' : 'dark';
  } catch {
    currentTheme = 'dark';
  }
  document.documentElement.dataset.theme = currentTheme;
}

export function setTheme(theme: Theme) {
  currentTheme = theme;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(storageKey, theme);
  } catch {
    // The current tab can still change appearance when browser storage is blocked.
  }
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const syncStorage = (event: StorageEvent) => {
    if (event.key !== storageKey && event.key !== null) return;
    initialiseTheme();
    listeners.forEach(notify => notify());
  };
  window.addEventListener('storage', syncStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', syncStorage);
  };
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, () => currentTheme, () => 'dark' as Theme);
  return {theme, toggleTheme: () => setTheme(theme === 'dark' ? 'light' : 'dark')};
}
