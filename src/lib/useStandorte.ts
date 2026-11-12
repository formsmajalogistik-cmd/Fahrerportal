// React-Hook: Auftraggeber + Niederlassungen (siehe lib/niederlassungen.ts).
import { useCallback, useEffect, useState } from 'react';
import { ladeStandorte, standorteNeuLaden, type Standorte } from './niederlassungen';
import { supabase } from './supabase';

export function useStandorte(): { standorte: Standorte | null; neuLaden: () => void } {
  const [standorte, setStandorte] = useState<Standorte | null>(null);
  const [runde, setRunde] = useState(0);
  useEffect(() => {
    let aktiv = true;
    ladeStandorte().then((s) => { if (aktiv) setStandorte(s); })
      .catch((e: unknown) => { console.warn('[Standorte] Laden fehlgeschlagen', e); });
    return () => { aktiv = false; };
  }, [runde]);
  const neuLaden = useCallback(() => { standorteNeuLaden(); setRunde((r) => r + 1); }, []);
  return { standorte, neuLaden };
}

/**
 * Steht die Tour auf einer erstellten Rechnung (offen/bezahlt)? Dann ist
 * ihre Niederlassung serverseitig gesperrt (Migration 118) — für den Hinweis.
 */
export function useNiederlassungGesperrt(tourId: string | null): boolean {
  const [gesperrt, setGesperrt] = useState(false);
  useEffect(() => {
    if (!tourId) return;
    let aktiv = true;
    void supabase.from('rechnungspositionen').select('rechnung:rechnung_id (status)').eq('tour_id', tourId)
      .then(({ data }) => {
        if (!aktiv) return;
        const l = (data ?? []) as unknown as Array<{ rechnung: { status: string } | null }>;
        setGesperrt(l.some((p) => p.rechnung && (p.rechnung.status === 'offen' || p.rechnung.status === 'bezahlt')));
      });
    return () => { aktiv = false; };
  }, [tourId]);
  return gesperrt;
}
