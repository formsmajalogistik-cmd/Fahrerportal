// Auswahl aus dem Adressbuch (Migration 090).
//
// Setzt Straße, PLZ und Ort GEMEINSAM — das ist der Grund, warum die
// manuellen Adressen in einer eigenen Tabelle liegen und nicht im
// flachen Vorschlags-Pool.
//
// Erscheint nur, wenn es überhaupt sichtbare Adressen gibt. Für einen
// Auftraggeber ohne zugeordnete Adressen bleibt der Block also weg —
// fremde Adressen liefert die RLS ihm gar nicht erst aus.
//
// Freie Eingabe bleibt jederzeit möglich: das hier ergänzt die Felder,
// es ersetzt sie nicht.

import { useEffect, useState } from 'react';
import { adressZeile, ladeAdressbuch, type Adressbucheintrag } from '../lib/adressbuch';

interface Props {
  /** Wird mit allen drei Teilen aufgerufen. */
  onWaehlen: (adresse: { strasse: string; plz: string; ort: string }) => void;
  /** Kompakte Darstellung für das dichte Tour-Formular. */
  kompakt?: boolean;
  id?: string;
}

export function AdressUebernehmen({ onWaehlen, kompakt, id }: Props) {
  const [eintraege, setEintraege] = useState<Adressbucheintrag[]>([]);

  useEffect(() => {
    let abgebrochen = false;
    void ladeAdressbuch().then((liste) => {
      if (!abgebrochen) setEintraege(liste);
    });
    return () => { abgebrochen = true; };
  }, []);

  if (eintraege.length === 0) return null;

  return (
    <label className={kompakt
      ? 'mt-1 flex flex-wrap items-center gap-2 text-[11px] text-maja-muted'
      : 'mt-2 flex flex-wrap items-center gap-2 text-xs text-maja-muted'}
    >
      <span>Adresse übernehmen …</span>
      <select
        id={id}
        className={kompakt ? 'tf-input w-auto max-w-full' : 'input w-auto max-w-full py-1 text-xs'}
        value=""
        onChange={(e) => {
          const treffer = eintraege.find((x) => x.id === e.target.value);
          if (treffer) {
            onWaehlen({
              strasse: treffer.strasse ?? '',
              plz: treffer.plz ?? '',
              ort: treffer.ort ?? '',
            });
          }
          e.currentTarget.selectedIndex = 0;
        }}
      >
        <option value="">— wählen —</option>
        {eintraege.map((a) => (
          <option key={a.id} value={a.id}>{adressZeile(a)}</option>
        ))}
      </select>
    </label>
  );
}
