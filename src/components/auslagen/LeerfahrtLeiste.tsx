// Tour-Detail (nur Admin): Hinweisbalken „Leerfahrt" bzw. Umschalter.
// Setzen legt für Kennzeichen ohne echte Auslage „Keine Auslagen" an,
// Entfernen nimmt nur diese automatischen Einträge wieder weg (Rückfrage).

import { useCallback, useEffect, useState } from 'react';
import {
  LEERFAHRT_ENTFERNEN_FRAGE, ladeLeerfahrten, leerfahrtEntfernen, leerfahrtSetzen, type LeerfahrtInfo,
} from '../../lib/leerfahrt';
import { formatDateTime } from '../../lib/touren';
import { ConfirmDialog } from '../ConfirmDialog';

export function LeerfahrtLeiste({ tourId, onChanged }: { tourId: string; onChanged: () => void }) {
  const [info, setInfo] = useState<LeerfahrtInfo | null>(null);
  const [geladen, setGeladen] = useState(false);
  const [fehlt, setFehlt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [frage, setFrage] = useState(false);
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null);

  const laden = useCallback(async () => {
    const r = await ladeLeerfahrten([tourId]);
    setFehlt(r.fehlt);
    setInfo(r.map.get(tourId) ?? null);
    setGeladen(true);
  }, [tourId]);
  // Asynchron starten (react-hooks/set-state-in-effect).
  useEffect(() => { void Promise.resolve().then(laden); }, [laden]);

  async function setzen() {
    setBusy(true); setMeldung(null);
    try {
      const n = await leerfahrtSetzen(tourId);
      setMeldung({ ok: true, text: n ? `Als Leerfahrt markiert — „Keine Auslagen" für ${n} Kennzeichen eingetragen.` : 'Als Leerfahrt markiert.' });
      await laden();
      onChanged();
    } catch (e) {
      setMeldung({ ok: false, text: e instanceof Error ? e.message : 'Speichern fehlgeschlagen' });
      await laden();
    } finally {
      setBusy(false);
    }
  }

  if (!geladen || fehlt) return null;
  return (
    <>
      {info ? (
        <div role="status" data-testid="leerfahrt-leiste"
             className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-300 bg-slate-100 px-4 py-2 text-sm text-slate-700 dark:!border-slate-600 dark:!bg-slate-800 dark:!text-slate-100">
          <span>
            <strong className="tracking-wider">LEERFAHRT</strong>
            <span className="ml-2 text-xs text-slate-500 dark:!text-slate-300">
              markiert {formatDateTime(info.gesetzt_am)}{info.gesetzt_von_name ? ` von ${info.gesetzt_von_name}` : ''}
            </span>
          </span>
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" disabled={busy} onClick={() => setFrage(true)}>
            Leerfahrt entfernen
          </button>
        </div>
      ) : (
        <div className="mb-4 flex justify-end">
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" disabled={busy} onClick={() => void setzen()}
                  title={'Markiert die Tour als Leerfahrt und trägt für Kennzeichen ohne Auslage „Keine Auslagen" ein.'}>
            {busy ? '…' : 'Leerfahrt'}
          </button>
        </div>
      )}
      {meldung && (
        <p role={meldung.ok ? 'status' : 'alert'} className={`-mt-2 mb-3 text-xs ${meldung.ok ? 'text-emerald-700' : 'text-red-700'}`}>{meldung.text}</p>
      )}
      {frage && (
        <ConfirmDialog
          title="Leerfahrt entfernen?"
          message={LEERFAHRT_ENTFERNEN_FRAGE}
          confirmLabel="Leerfahrt entfernen"
          onConfirm={async () => {
            const n = await leerfahrtEntfernen(tourId);
            setFrage(false);
            setMeldung({ ok: true, text: n ? `Leerfahrt entfernt — ${n} automatisch gesetzte „Keine Auslagen" entfernt.` : 'Leerfahrt entfernt.' });
            await laden();
            onChanged();
          }}
          onClose={() => setFrage(false)}
        />
      )}
    </>
  );
}
