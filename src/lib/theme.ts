export type Theme = 'dark' | 'light';
const KEY = 'pdf-insight.theme';

export function readTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#0b1020' : '#eaf0fa');
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // The theme still works when browser storage is unavailable.
  }
}
