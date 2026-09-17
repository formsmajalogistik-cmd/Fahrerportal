// Vollständige Adressen für die Straßen-Combobox.
//
// Zwei Quellen, bewusst getrennt gehalten:
//   * Adressbuch (090) — vom Admin von Hand gepflegt, mit Bezeichnung.
//     Erscheint als eigener Vorschlag, auch ohne passenden Pool-Eintrag.
//   * Adress-Kombinationen (097) — automatisch gesammelte Zuordnung
//     Straße → PLZ → Ort. Sie hängen an einem Pool-Eintrag und machen
//     aus „Werner-Haas-Straße 1" den Vorschlag
//     „Werner-Haas-Straße 1 — 74172 Neckarsulm".
//
// Warum ein gemeinsamer Hook: Formular- und Tour-Adressfelder brauchen
// dieselben Listen, und beide Quellen werden ohnehin pro Session nur
// einmal geladen.
//
// Sichtbarkeit erzwingt die RLS: ein Auftraggeber bekommt aus dem
// automatischen Pool und den Kombinationen gar nichts, aus dem
// Adressbuch nur die ihm zugeordneten Adressen. Hier wird bewusst NICHT
// zusätzlich gefiltert.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { adressZeile, ladeAdressbuch } from '../lib/adressbuch';
import {
  kombiZeile, ladeKombinationen, type AdressKombination,
} from '../lib/adressKombinationen';
import { vergleichsSchluessel } from '../lib/textNormalisierung';
import type { StrukturVorschlag } from './SuggestCombobox';

export interface AdressVorschlaege {
  /** Manuell gepflegte Adressen — stehen oben im Dropdown. */
  adressbuch: StrukturVorschlag[];
  /**
   * Vollständige Adressen zu einem Pool-Wert. Leer, wenn nichts bekannt
   * ist — dann bleibt es beim einfachen Straßen-Vorschlag.
   */
  erweitereText: (wert: string) => StrukturVorschlag[];
}

export function useAdressVorschlaege(): AdressVorschlaege {
  const [adressbuch, setAdressbuch] = useState<StrukturVorschlag[]>([]);
  const [kombis, setKombis] = useState<AdressKombination[]>([]);

  useEffect(() => {
    let abgebrochen = false;
    void ladeAdressbuch().then((eintraege) => {
      if (abgebrochen) return;
      setAdressbuch(eintraege
        // Ohne Straße gibt es im Straßenfeld nichts anzubieten.
        .filter((e) => (e.strasse ?? '').trim())
        .map((e) => ({
          id: `ab:${e.id}`,
          label: adressZeile(e),
          strasse: e.strasse ?? '',
          plz: e.plz ?? '',
          ort: e.ort ?? '',
        })));
    });
    void ladeKombinationen().then((liste) => {
      if (!abgebrochen) setKombis(liste);
    });
    return () => { abgebrochen = true; };
  }, []);

  /**
   * Nachschlagen über den Vergleichsschlüssel, nicht über den Text:
   * so findet „Bahnhofstr. 5" auch die Kombination, die unter
   * „Bahnhofstraße 5" gespeichert ist.
   */
  const nachStrasse = useMemo(() => {
    const m = new Map<string, StrukturVorschlag[]>();
    for (const k of kombis) {
      const key = vergleichsSchluessel(k.strasse);
      if (!key) continue;
      const liste = m.get(key) ?? [];
      liste.push({
        id: `kombi:${k.id}`,
        label: kombiZeile(k),
        strasse: k.strasse,
        plz: k.plz ?? '',
        ort: k.ort ?? '',
      });
      m.set(key, liste);
    }
    return m;
  }, [kombis]);

  const erweitereText = useCallback(
    (wert: string) => nachStrasse.get(vergleichsSchluessel(wert)) ?? [],
    [nachStrasse],
  );

  return { adressbuch, erweitereText };
}
