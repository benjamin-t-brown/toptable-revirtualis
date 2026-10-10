export type ThemeName = 'light' | 'dark';

const KEY = 'tt-theme';

export function currentTheme(): ThemeName {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function initTheme(): void {
  const saved = localStorage.getItem(KEY);
  document.documentElement.dataset.theme = saved === 'dark' ? 'dark' : 'light';
}

export function toggleTheme(): ThemeName {
  const next: ThemeName = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem(KEY, next);
  return next;
}

export function themeButtonLabel(): string {
  return currentTheme() === 'dark' ? 'Light mode' : 'Dark mode';
}
