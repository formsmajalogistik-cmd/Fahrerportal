// Dark-/Light-Mode-Helper. Die Präferenz lebt in localStorage —
// bewusst NICHT in Supabase, weil dieselbe Person je nach Gerät
// (Handy vs. Desktop) unterschiedliche Vorlieben hat.
//
// Drei Modi:
//   "light"  — immer hell
//   "dark"   — immer dunkel
//   "system" — folgt prefers-color-scheme des OS (Default)

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'maja-theme';

export function loadThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch { /* localStorage blocked → System-Default */ }
  return 'system';
}

export function saveThemePreference(p: ThemePreference): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, p); } catch { /* noop */ }
}

/**
 * Liest die System-Einstellung. Wird beim Theme="system" zur
 * Anwendung herangezogen.
 */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Schaltet die `.dark`-Klasse am <html>-Element je nach Preference
 * + System-Status. Wird beim App-Start UND beim Toggle aufgerufen.
 */
export function applyTheme(pref: ThemePreference = loadThemePreference()): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  const dark = pref === 'dark' || (pref === 'system' && systemPrefersDark());
  html.classList.toggle('dark', dark);
}

/**
 * Hängt einen Listener an die System-prefers-color-scheme-Änderung,
 * der NUR feuert, wenn der User aktuell "system" gewählt hat. Bei
 * "light"/"dark" bleibt die manuell gesetzte Stufe.
 *
 * Gibt eine Cleanup-Funktion zurück.
 */
export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => { /* noop */ };
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    if (loadThemePreference() === 'system') onChange();
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
