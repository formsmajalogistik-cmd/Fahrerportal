// Auslagen-Status im Tour-Detail (nur Admin): Badge(s), welches Kennzeichen
// ungeklärt ist, und die Schnellaktion „Keine Auslagen" — sie legt für alle
// noch ungeklärten Kennzeichen einen Zusatz „Keine Auslagen" an
// (Migration 113). Kommt später eine Auslage für ein Kennzeichen dazu,
// entfernt die Datenbank dessen „Keine Auslagen" selbst und protokolliert.

import { useCallback, useEffect, useState } from 'react';
import {
  FORMAT_STANDARD, auslagenStatus, keineAuslagenFuerUngeklaerte, ladeAbrechnungsStand, ladeAgFormate, slotLabel,
  type AuslagenStatus, type AuslagenZusatz,
} from '../../lib/auslagenStatus';
import { ladeZusatzArten } from '../../lib/zusatzArten';
import { AuslagenBadge } from './AuslagenBadge';

export function AuslagenTourStatus({
  tour, zusaetze, onChanged,
}: {
  tour: {
    id: string; tour_id: string | null; auftraggeber_id: string | null; startdatum: string | null; enddatum: string | null;
    tourenart?: string | null; kennzeichen: string[] | null;
  };
  zusaetze: AuslagenZusatz[];
  onChanged?: () => void;
}) {
  const [status, setStatus] = useState<AuslagenStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const zusatzSchluessel = zusaetze.map((z) => `${z.id}:${z.kennzeichen ?? ''}`).join(',');
  const kzSchluessel = (tour.kennzeichen ?? []).join('|');

  const laden = useCallback(async () => {
    try {
      const [stand, formate, arten] = await Promise.all([
        ladeAbrechnungsStand([tour.id]),
        tour.auftraggeber_id ? ladeAgFormate([tour.auftraggeber_id]) : Promise.resolve(new Map()),
        ladeZusatzArten(),
      ]);
      setStatus(auslagenStatus({
        id: tour.id, tour_nr: tour.tour_id, auftraggeber_id: tour.auftraggeber_id, startdatum: tour.startdatum,
        enddatum: tour.enddatum, tourenart: tour.tourenart, kennzeichen: tour.kennzeichen ?? [], zusaetze,
      }, stand, (tour.auftraggeber_id && formate.get(tour.auftraggeber_id)) || FORMAT_STANDARD, arten));
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Auslagen-Status konnte nicht geladen werden.');
    }
  // zusaetze/kennzeichen über die Schlüssel — neu laden, wenn sich etwas ändert.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour.id, tour.auftraggeber_id, tour.tourenart, kzSchluessel, zusatzSchluessel]);

  useEffect(() => { void laden(); }, [laden]);

  async function keineAuslagen() {
    setBusy(true); setFehler(null);
    try {
      await keineAuslagenFuerUngeklaerte([tour.id]);
      onChanged?.();
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm" data-testid="auslagen-tour-status">
      <AuslagenBadge status={status} />
      {status.art === 'offen' && status.ungeklaert.length > 0 && <AuslagenBadge status={status} nurUngeklaert />}
      {status.ungeklaert.length > 0 && (
        <>
          <span className="text-xs text-maja-muted">
            Ungeklärt: {status.ungeklaert.map(slotLabel).join(', ')}
          </span>
          <button type="button" className="btn-secondary px-2.5 py-1 text-xs" disabled={busy} onClick={() => void keineAuslagen()}
                  title={'Legt für jedes ungeklärte Kennzeichen einen Zusatz „Keine Auslagen" an.'}>
            {busy ? '…' : 'Keine Auslagen'}
          </button>
        </>
      )}
      {fehler && <span role="alert" className="text-xs text-red-700">{fehler}</span>}
    </div>
  );
}
