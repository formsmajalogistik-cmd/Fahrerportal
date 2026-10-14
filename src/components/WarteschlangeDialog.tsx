// Sichtbare Upload-Warteschlange für den Fahrer — geöffnet über die
// Leiste „Synchronisiere …" bzw. „Bild konnte nicht hochgeladen werden".
//
// Pro Bild: Status, Fehlertext, „Erneut versuchen", „Entfernen" (nimmt das
// Bild auch aus dem Formular). Pro Formular nur „Erneut versuchen" —
// Formulardaten lassen sich hier bewusst NICHT löschen.
// „Synchronisierung prüfen" führt den Abgleich aus (lib/uploadAbgleich).

import { useCallback, useEffect, useState } from 'react';
import { useSync, type WarteschlangenEintrag } from '../sync/SyncContext';
import { XIcon } from './icons';

function Vorschau({ blob }: { blob?: Blob }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    queueMicrotask(() => setUrl(u));
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url
    ? <img src={url} alt="" className="h-12 w-16 shrink-0 rounded object-cover" />
    : <div className="h-12 w-16 shrink-0 rounded bg-maja-light" />;
}

/** Technische Meldung → verständlicher Satz (Original bleibt im title). */
function fehlerText(e: WarteschlangenEintrag): string | null {
  if (!e.fehler) return null;
  if (/\((400)\)/.test(e.fehler) && /Pfad/i.test(e.fehler)) return 'Der Speicherort wurde abgelehnt (ungültiger Pfad). „Erneut versuchen" nutzt jetzt einen bereinigten Pfad.';
  if (/\((401|403)\)/.test(e.fehler)) return 'Keine Berechtigung bzw. Anmeldung abgelaufen.';
  if (/\(5\d\d\)/.test(e.fehler)) return 'Server vorübergehend nicht erreichbar.';
  if (/Verbindung|network|Failed to fetch|abgebrochen|timeout/i.test(e.fehler)) return 'Keine stabile Verbindung.';
  return e.fehler.slice(0, 160);
}

export function WarteschlangeDialog({ onClose }: { onClose: () => void }) {
  const { eintraege, erneutVersuchen, bildEntfernen, pruefen, syncing } = useSync();
  const [liste, setListe] = useState<WarteschlangenEintrag[] | null>(null);
  const [frage, setFrage] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const laden = useCallback(async () => {
    try { setListe(await eintraege()); } catch { setListe([]); }
  }, [eintraege]);
  useEffect(() => { queueMicrotask(() => { void laden(); }); }, [laden, syncing]);

  async function aktion(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); await laden(); }
  }

  const bilder = (liste ?? []).filter((e) => e.art === 'bild');
  const formulare = (liste ?? []).filter((e) => e.art === 'formular');

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-maja-ink/40 sm:items-center sm:px-4 dark:bg-black/60">
      <div role="dialog" aria-modal="true" aria-labelledby="ws-titel"
           className="card max-h-[85vh] w-full max-w-lg overflow-auto rounded-b-none p-4 sm:rounded-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id="ws-titel" className="text-base font-semibold text-maja-navy">Synchronisierung</h2>
            <p className="text-xs text-maja-muted">Bilder und Formulare, die noch auf dem Gerät warten.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Schließen" className="rounded-md p-1 text-maja-muted hover:bg-maja-light">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {liste == null ? (
          <p className="text-sm text-maja-muted">Lade …</p>
        ) : liste.length === 0 ? (
          <p className="text-sm text-maja-ink">Alles synchronisiert — nichts wartet mehr.</p>
        ) : (
          <ul className="divide-y divide-maja-navy/10">
            {formulare.map((e) => (
              <li key={`f-${e.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0 text-sm">
                  <div className="font-medium text-maja-ink">Formular {e.kennzeichen ? `· ${e.kennzeichen}` : `· ${e.formularId.slice(0, 8)}`}</div>
                  <div className="text-xs text-maja-muted">
                    {e.status === 'blockiert'
                      ? 'Wartet: Bilder konnten nicht hochgeladen werden. Formular öffnen und „Abschließen" erneut tippen.'
                      : (e.wartetAufBilder ?? 0) > 0
                        ? `Wird eingereicht, sobald ${e.wartetAufBilder} ${e.wartetAufBilder === 1 ? 'Bild' : 'Bilder'} hochgeladen ${e.wartetAufBilder === 1 ? 'ist' : 'sind'}.`
                        : 'Wird eingereicht …'}
                  </div>
                  {e.fehler && <div className="text-xs text-red-700" title={e.fehler}>{e.fehler.slice(0, 160)}</div>}
                </div>
                <button type="button" className="btn-secondary px-3 py-1 text-xs" disabled={busy}
                        onClick={() => void aktion(() => erneutVersuchen(e))}>
                  Erneut versuchen
                </button>
              </li>
            ))}
            {bilder.map((e) => (
              <li key={e.id} className="flex items-start gap-3 py-2">
                <Vorschau blob={e.blob} />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-maja-ink">Bild · {e.fieldId}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      e.status === 'fehlgeschlagen'
                        ? 'bg-red-100 text-red-700 dark:!bg-red-900/50 dark:!text-red-200'
                        : 'bg-blue-100 text-blue-800 dark:!bg-blue-900/50 dark:!text-blue-100'
                    }`}>
                      {e.status === 'fehlgeschlagen' ? 'fehlgeschlagen' : 'wartet'}
                    </span>
                  </div>
                  <div className="text-xs text-maja-muted">
                    {e.kennzeichen ? `Kennzeichen ${e.kennzeichen} · ` : ''}{e.versuche} {e.versuche === 1 ? 'Versuch' : 'Versuche'}
                  </div>
                  {fehlerText(e) && <div className="text-xs text-red-700 dark:!text-red-300" title={e.fehler ?? ''}>{fehlerText(e)}</div>}
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary px-3 py-1 text-xs" disabled={busy}
                            onClick={() => void aktion(() => erneutVersuchen(e))}>
                      Erneut versuchen
                    </button>
                    {frage === e.id ? (
                      <>
                        <button type="button" className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700" disabled={busy}
                                onClick={() => void aktion(async () => { await bildEntfernen(e.id); setFrage(null); })}>
                          Bild wirklich entfernen
                        </button>
                        <button type="button" className="text-xs text-maja-muted hover:underline" onClick={() => setFrage(null)}>Abbrechen</button>
                      </>
                    ) : (
                      <button type="button" className="rounded-lg border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:!border-red-400/40 dark:!text-red-300"
                              disabled={busy} onClick={() => setFrage(e.id)}>
                        Entfernen
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {meldung && <p role="status" className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">{meldung}</p>}

        <div className="mt-4 flex flex-wrap justify-between gap-2">
          <button type="button" className="btn-secondary" disabled={busy}
                  onClick={() => void aktion(async () => {
                    const r = await pruefen({ anlass: 'manuell' });
                    const teile = [
                      r.entfernt ? `${r.entfernt} veraltete ${r.entfernt === 1 ? 'Eintrag' : 'Einträge'} entfernt` : '',
                      r.zurueckgesetzt ? `${r.zurueckgesetzt} erneut gestartet` : '',
                      r.einreichungenAktualisiert ? 'wartendes Formular aktualisiert' : '',
                    ].filter(Boolean);
                    setMeldung(teile.length ? `${teile.join(', ')}.` : 'Geprüft — keine veralteten Einträge gefunden.');
                  })}>
            Synchronisierung prüfen
          </button>
          <button type="button" className="btn-primary" onClick={onClose}>Schließen</button>
        </div>
      </div>
    </div>
  );
}
