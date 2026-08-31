// Manuelle Adressen als strukturierte Vorschläge für die Combobox.
//
// Warum eigener Hook: Straßen-, Formular- und Tour-Adressfelder brauchen
// dieselbe Liste, und das Adressbuch wird ohnehin pro Session nur einmal
// geladen (Cache in lib/adressbuch.ts).
//
// Sichtbarkeit erzwingt die RLS: ein Auftraggeber bekommt ausschließlich
// die ihm zugeordneten Adressen, aus dem gesammelten Pool gar nichts.
// Hier wird bewusst NICHT zusätzlich gefiltert.

import { useEffect, useState } from 'react';
import { adressZeile, ladeAdressbuch } from '../lib/adressbuch';
import type { StrukturVorschlag } from './SuggestCombobox';

export function useAdressVorschlaege(): StrukturVorschlag[] {
  const [liste, setListe] = useState<StrukturVorschlag[]>([]);

  useEffect(() => {
    let abgebrochen = false;
    void ladeAdressbuch().then((eintraege) => {
      if (abgebrochen) return;
      setListe(eintraege
        // Ohne Straße gibt es im Straßenfeld nichts anzubieten.
        .filter((e) => (e.strasse ?? '').trim())
        .map((e) => ({
          id: e.id,
          label: adressZeile(e),
          strasse: e.strasse ?? '',
          plz: e.plz ?? '',
          ort: e.ort ?? '',
        })));
    });
    return () => { abgebrochen = true; };
  }, []);

  return liste;
}
