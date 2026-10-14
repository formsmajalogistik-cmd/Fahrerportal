import { useState } from 'react';
import { useSync } from '../sync/SyncContext';
import { WarteschlangeDialog } from './WarteschlangeDialog';

/**
 * Dezenter globaler Banner — sichtbar wenn:
 *  - offline (gelb)
 *  - online aber Bilder/Formulare warten (blau, „Synchronisiere …")
 *  - Bilder dauerhaft fehlgeschlagen (rot) — blockieren nichts, brauchen
 *    aber eine Entscheidung
 * Ein Tipp öffnet die Warteschlange (Details, erneut versuchen, entfernen).
 */
export function OfflineBanner() {
  const { online, pendingUploads, failedUploads, pendingSubmissions, syncing } = useSync();
  const [offen, setOffen] = useState(false);
  const pending = pendingUploads + pendingSubmissions;
  const knopf = 'block w-full px-3 py-1.5 text-center text-xs font-medium underline-offset-2 hover:underline';

  let leiste: React.ReactNode = null;
  if (!online) {
    leiste = (
      <button type="button" onClick={() => setOffen(true)} className={`${knopf} bg-amber-100 text-amber-900`}>
        Offline — Änderungen werden gespeichert und bei Verbindung synchronisiert
        {pending + failedUploads > 0 && ` (${pending + failedUploads} ausstehend)`}
      </button>
    );
  } else if (pending > 0 || failedUploads > 0) {
    leiste = (
      <>
        {pending > 0 && (
          <button type="button" onClick={() => setOffen(true)} className={`${knopf} bg-blue-100 text-blue-900 dark:!bg-blue-950 dark:!text-blue-100`}>
            {syncing ? 'Synchronisiere …' : 'Warte auf Upload …'}
            {pendingUploads > 0 && ` ${pendingUploads} ${pendingUploads === 1 ? 'Bild' : 'Bilder'}`}
            {pendingUploads > 0 && pendingSubmissions > 0 && ', '}
            {pendingSubmissions > 0 && ` ${pendingSubmissions} ${pendingSubmissions === 1 ? 'Formular' : 'Formulare'}`}
          </button>
        )}
        {failedUploads > 0 && (
          <button type="button" onClick={() => setOffen(true)} className={`${knopf} bg-red-100 text-red-800 dark:!bg-red-950 dark:!text-red-100`}>
            {failedUploads === 1 ? '1 Bild konnte nicht hochgeladen werden' : `${failedUploads} Bilder konnten nicht hochgeladen werden`} — Details
          </button>
        )}
      </>
    );
  }

  return (
    <>
      {leiste && <div className="sticky top-0 z-20">{leiste}</div>}
      {offen && <WarteschlangeDialog onClose={() => setOffen(false)} />}
    </>
  );
}
