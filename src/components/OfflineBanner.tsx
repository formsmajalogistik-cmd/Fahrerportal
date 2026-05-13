import { useSync } from '../sync/SyncContext';

/**
 * Dezenter globaler Banner — sichtbar wenn:
 *  - offline (gelb)
 *  - online aber Queue nicht leer (blau, "synchronisiere ...")
 */
export function OfflineBanner() {
  const { online, pendingUploads, pendingSubmissions, syncing } = useSync();
  const pending = pendingUploads + pendingSubmissions;

  if (!online) {
    return (
      <div className="sticky top-0 z-20 bg-amber-100 px-3 py-1.5 text-center text-xs font-medium text-amber-900">
        Offline — Änderungen werden gespeichert und bei Verbindung synchronisiert
        {pending > 0 && ` (${pending} ausstehend)`}
      </div>
    );
  }

  if (pending > 0) {
    return (
      <div className="sticky top-0 z-20 bg-blue-100 px-3 py-1.5 text-center text-xs font-medium text-blue-900">
        {syncing ? 'Synchronisiere …' : 'Warte auf Sync …'}
        {pendingUploads > 0 && ` ${pendingUploads} ${pendingUploads === 1 ? 'Bild' : 'Bilder'}`}
        {pendingUploads > 0 && pendingSubmissions > 0 && ', '}
        {pendingSubmissions > 0 && ` ${pendingSubmissions} ${pendingSubmissions === 1 ? 'Formular' : 'Formulare'}`}
      </div>
    );
  }

  return null;
}
