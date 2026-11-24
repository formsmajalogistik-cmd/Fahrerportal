// Hook: interne Infos (nur Admin, Migration 120) für eine Menge Touren —
// z.B. die Touren der Rechnungspositionen. Lädt neu, sobald sich die
// Tour-IDs ändern (auch nach „Touren neu laden" / Tour hinzufügen).
import { useEffect, useState } from 'react';
import { ladeInterneInfoTexte } from './interneInfo';

export function useInterneInfoTexte(tourIds: Array<string | null | undefined>, aktiv = true): Map<string, string> {
  const schluessel = [...new Set(tourIds.filter((x): x is string => !!x))].sort().join(',');
  const [map, setMap] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!aktiv || !schluessel) return;
    let abgebrochen = false;
    void ladeInterneInfoTexte(schluessel.split(',')).then((m) => { if (!abgebrochen) setMap(m); });
    return () => { abgebrochen = true; };
  }, [schluessel, aktiv]);
  return map;
}
