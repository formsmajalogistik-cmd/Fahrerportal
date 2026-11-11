// Nachgeladene Programmteile (Code-Splitting) und Versionswechsel.
//
// Nach einem Deploy hat ein noch offener Tab die ALTE Version im Speicher.
// Will er dann einen nachgeladenen Teil holen, der nur in der alten
// Version existierte, scheitert der Import („Failed to fetch dynamically
// imported module"). Dann:
//   * keine ungesicherten Daten offen → die Seite EINMAL neu laden
//     (Schutz gegen Endlosschleife: höchstens einmal je 2 Minuten);
//   * sonst (Formular mit ungespeicherten Änderungen, PDF-Erzeugung oder
//     Upload läuft) → NICHT neu laden, nur der Hinweis „Neue Version —
//     bitte neu laden" (Komponente NeueVersionHinweis).
//
// „Ungesichert" melden die betroffenen Stellen selbst über
// meldeOffeneArbeit() — hier wird nur gefragt, nie etwas gelöscht.

const NEU_GELADEN_KEY = 'maja-neue-version-neu-geladen';
const SCHUTZ_MS = 2 * 60 * 1000;
export const NEUE_VERSION_EVENT = 'maja:neue-version';

const pruefer = new Map<string, () => boolean>();

/**
 * Meldet eine Stelle, die ungesicherte Arbeit haben kann. `offen()` wird
 * im Fehlerfall abgefragt. Rückgabe: Abmelden.
 */
export function meldeOffeneArbeit(name: string, offen: () => boolean): () => void {
  pruefer.set(name, offen);
  return () => { if (pruefer.get(name) === offen) pruefer.delete(name); };
}

/** Namen der Stellen, die gerade ungesicherte Arbeit melden. */
export function offeneArbeit(): string[] {
  const offen: string[] = [];
  for (const [name, f] of pruefer) {
    try { if (f()) offen.push(name); } catch { offen.push(name); }
  }
  return offen;
}

/** Ist das ein Ladefehler eines nachgeladenen Programmteils? */
export function istChunkLadefehler(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? '');
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading chunk [\w-]+ failed/i.test(msg);
}

function zuletztNeuGeladen(): number {
  try { return Number(sessionStorage.getItem(NEU_GELADEN_KEY) ?? 0) || 0; } catch { return 0; }
}

/**
 * Reaktion auf einen Ladefehler. Rückgabe: 'neu-laden' (Seite lädt gleich
 * neu) oder 'hinweis' (Hinweis wird angezeigt, nichts passiert automatisch).
 */
export function beiChunkLadefehler(err?: unknown): 'neu-laden' | 'hinweis' {
  const offen = offeneArbeit();
  const schonVersucht = Date.now() - zuletztNeuGeladen() < SCHUTZ_MS;
  if (offen.length === 0 && !schonVersucht && navigator.onLine) {
    try { sessionStorage.setItem(NEU_GELADEN_KEY, String(Date.now())); } catch { /* ohne Speicher kein Neuladen */
      window.dispatchEvent(new CustomEvent(NEUE_VERSION_EVENT, { detail: { offen } }));
      return 'hinweis';
    }
    console.warn('[neueVersion] Programmteil nicht ladbar — lade die neue Version.', err);
    window.location.reload();
    return 'neu-laden';
  }
  console.warn('[neueVersion] Programmteil nicht ladbar — Hinweis statt Neuladen.', { offen, schonVersucht, online: navigator.onLine, err });
  window.dispatchEvent(new CustomEvent(NEUE_VERSION_EVENT, { detail: { offen } }));
  return 'hinweis';
}

/** Jetzt neu laden (Knopf im Hinweis) — setzt den Schleifenschutz zurück. */
export function jetztNeuLaden(): void {
  try { sessionStorage.removeItem(NEU_GELADEN_KEY); } catch { /* egal */ }
  window.location.reload();
}

/**
 * Dynamischer Import mit Behandlung des Versionswechsels: der Fehler wird
 * weitergereicht (die Fehlergrenze zeigt dann „Neue Version"), vorher wird
 * je nach Lage neu geladen oder der Hinweis gezeigt.
 */
export function mitVersionsschutz<T>(laden: () => Promise<T>): Promise<T> {
  return laden().catch((err: unknown) => {
    if (istChunkLadefehler(err)) beiChunkLadefehler(err);
    throw err;
  });
}
