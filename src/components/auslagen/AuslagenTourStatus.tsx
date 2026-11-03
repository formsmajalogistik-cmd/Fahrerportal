// Auslagen-Status im Tour-Detail (nur Admin): Badge + Umschalter
// „Keine Auslagen". Der Umschalter ist nur ohne Zusätze möglich — kommt
// später ein Zusatz dazu, entfernt die Datenbank die Markierung selbst
// und protokolliert das (Migration 112).

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import {
  FORMAT_STANDARD, auslagenStatus, keineAuslagenSetzen, ladeAbrechnungsStand, ladeAgFormate,
  type AuslagenStatus, type AuslagenZusatz,
} from '../../lib/auslagenStatus';
import { formatDateTime } from '../../lib/touren';
import { AuslagenBadge } from './AuslagenBadge';

export function AuslagenTourStatus({
  tour, zusaetze, onChanged,
}: {
  tour: { id: string; tour_id: string | null; auftraggeber_id: string | null; startdatum: string | null; enddatum: string | null; kennzeichen: string[] | null };
  zusaetze: AuslagenZusatz[];
  onChanged?: () => void;
}) {
  const [status, setStatus] = useState<AuslagenStatus | null>(null);
  const [markierung, setMarkierung] = useState<{ gesetzt_am: string; gesetzt_von_name: string | null } | null>(null);
  const [fehlt, setFehlt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const zusatzSchluessel = zusaetze.map((z) => z.id).join(',');

  const laden = useCallback(async () => {
    try {
      const [stand, formate, mark] = await Promise.all([
        ladeAbrechnungsStand([tour.id]),
        tour.auftraggeber_id ? ladeAgFormate([tour.auftraggeber_id]) : Promise.resolve(new Map()),
        supabase.from('tour_keine_auslagen').select('gesetzt_am, gesetzt_von_name').eq('tour_id', tour.id).maybeSingle(),
      ]);
      setFehlt(!!stand.markierungFehlt);
      setMarkierung((mark.data as { gesetzt_am: string; gesetzt_von_name: string | null } | null) ?? null);
      setStatus(auslagenStatus({
        id: tour.id, tour_nr: tour.tour_id, auftraggeber_id: tour.auftraggeber_id,
        startdatum: tour.startdatum, enddatum: tour.enddatum, kennzeichen: tour.kennzeichen ?? [], zusaetze,
      }, stand, (tour.auftraggeber_id && formate.get(tour.auftraggeber_id)) || FORMAT_STANDARD));
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Auslagen-Status konnte nicht geladen werden.');
    }
  // zusaetze über den Schlüssel (IDs) — neu laden, wenn Zusätze dazukommen/wegfallen.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour.id, tour.auftraggeber_id, zusatzSchluessel]);

  useEffect(() => { void laden(); }, [laden]);

  async function umschalten(an: boolean) {
    setBusy(true); setFehler(null);
    try {
      const r = await keineAuslagenSetzen([tour.id], an);
      if (r.uebersprungen.length) setFehler(r.uebersprungen[0].grund);
      await laden();
      onChanged?.();
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  if (fehlt) return null; // Migration 112 noch nicht eingespielt
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm" data-testid="auslagen-tour-status">
      {status && <AuslagenBadge status={status} />}
      {zusaetze.length === 0 && (
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
            checked={!!markierung}
            disabled={busy}
            onChange={(e) => void umschalten(e.target.checked)}
          />
          <span className="font-medium text-maja-ink">Keine Auslagen</span>
        </label>
      )}
      {markierung && (
        <span className="text-xs text-maja-muted">
          gesetzt {formatDateTime(markierung.gesetzt_am)}{markierung.gesetzt_von_name ? ` von ${markierung.gesetzt_von_name}` : ''}
        </span>
      )}
      {fehler && <span role="alert" className="text-xs text-red-700">{fehler}</span>}
    </div>
  );
}
