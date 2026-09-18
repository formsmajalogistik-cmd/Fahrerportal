// Tabelle der Adress-Kombinationen (Migration 097).
//
// Rein darstellend: Daten, Suche, Sortierung und Auswahl liegen in der
// Pflegeseite, damit dort EINE Bedienleiste für Pool und Kombinationen
// steht. Hier bleibt nur das Zeilen-Rendering und das Bearbeiten.

import { useState } from 'react';
import { XIcon } from '../../components/icons';
import { useTestGuard } from '../../auth/TestModeContext';
import {
  aktualisiereKombination, type AdressKombination,
} from '../../lib/adressKombinationen';
import { vergleichsSchluessel } from '../../lib/textNormalisierung';
import { formatDate } from '../../lib/touren';

interface Entwurf { strasse: string; plz: string; ort: string }

interface Props {
  zeilen: AdressKombination[];
  /** Straßen-Schlüssel → Anzahl Kombinationen. Markiert Mehrdeutige. */
  mehrdeutig: Map<string, number>;
  gewaehlt: Set<string>;
  onUmschalten: (id: string) => void;
  onAlleUmschalten: () => void;
  alleGewaehlt: boolean;
  onLoeschen: (ids: string[]) => void;
  onGeaendert: () => void;
  busy: boolean;
  onFehler: (text: string) => void;
}

export function AdressKombinationenTabelle({
  zeilen, mehrdeutig, gewaehlt, onUmschalten, onAlleUmschalten, alleGewaehlt,
  onLoeschen, onGeaendert, busy, onFehler,
}: Props) {
  const guard = useTestGuard();
  const [bearbeiteId, setBearbeiteId] = useState<string | null>(null);
  const [entwurf, setEntwurf] = useState<Entwurf>({ strasse: '', plz: '', ort: '' });
  const [speichert, setSpeichert] = useState(false);

  async function speichern(k: AdressKombination) {
    if (guard()) return;
    setSpeichert(true);
    const res = await aktualisiereKombination(k.id, entwurf);
    setSpeichert(false);
    if (!res.ok) { onFehler(res.fehler ?? 'Speichern fehlgeschlagen'); return; }
    setBearbeiteId(null);
    onGeaendert();
  }

  return (
    <table className="w-full min-w-[40rem] text-sm">
      <thead className="sticky top-0 z-10 bg-white dark:bg-surface-800">
        <tr className="border-b border-maja-navy/10 text-left text-xs uppercase tracking-wide text-maja-muted">
          <th className="w-10 px-3 py-2">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
              aria-label="Alle angezeigten auswählen"
              checked={alleGewaehlt}
              onChange={onAlleUmschalten}
            />
          </th>
          <th className="px-3 py-2">Straße</th>
          <th className="w-24 px-3 py-2">PLZ</th>
          <th className="px-3 py-2">Ort</th>
          <th className="w-20 px-3 py-2 text-right">Anzahl</th>
          <th className="w-32 px-3 py-2">Zuletzt</th>
          <th className="w-28 px-3 py-2" />
        </tr>
      </thead>
      <tbody>
        {zeilen.map((k) => {
          const mehrere = (mehrdeutig.get(vergleichsSchluessel(k.strasse)) ?? 0) >= 2;
          const bearbeitet = bearbeiteId === k.id;
          return (
            <tr key={k.id} className="border-b border-maja-navy/5 last:border-b-0">
              <td className="px-3 py-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                  aria-label={`„${k.strasse}" auswählen`}
                  checked={gewaehlt.has(k.id)}
                  onChange={() => onUmschalten(k.id)}
                />
              </td>
              {bearbeitet ? (
                <>
                  <td className="px-3 py-2">
                    <input className="input" value={entwurf.strasse} aria-label="Straße"
                           onChange={(e) => setEntwurf({ ...entwurf, strasse: e.target.value })} />
                  </td>
                  <td className="px-3 py-2">
                    <input className="input" value={entwurf.plz} aria-label="PLZ" inputMode="numeric"
                           onChange={(e) => setEntwurf({ ...entwurf, plz: e.target.value })} />
                  </td>
                  <td className="px-3 py-2">
                    <input className="input" value={entwurf.ort} aria-label="Ort"
                           onChange={(e) => setEntwurf({ ...entwurf, ort: e.target.value })} />
                  </td>
                  <td colSpan={3} className="px-3 py-2">
                    <div className="flex flex-wrap justify-end gap-2">
                      <button type="button" className="btn-primary px-3 py-1.5 text-sm"
                              disabled={speichert}
                              onClick={() => void speichern(k)}>
                        Speichern
                      </button>
                      <button type="button" className="btn-secondary px-3 py-1.5 text-sm"
                              onClick={() => setBearbeiteId(null)}>
                        Abbrechen
                      </button>
                    </div>
                  </td>
                </>
              ) : (
                <>
                  <td className="px-3 py-2 text-maja-ink">
                    {k.strasse}
                    {mehrere && (
                      <span
                        className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-900 dark:!bg-amber-900 dark:!text-amber-100"
                        title="Diese Straße kommt in mehreren Orten vor"
                      >
                        mehrere Orte
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-maja-muted">{k.plz ?? '—'}</td>
                  <td className="px-3 py-2 text-maja-ink">{k.ort ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-maja-muted">{k.anzahl ?? 0}</td>
                  <td className="px-3 py-2 text-xs text-maja-muted">
                    {k.letzte_nutzung ? formatDate(k.letzte_nutzung) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        className="rounded-md px-2 py-1 text-xs font-medium text-maja-accent hover:bg-maja-light"
                        onClick={() => {
                          setBearbeiteId(k.id);
                          setEntwurf({ strasse: k.strasse, plz: k.plz ?? '', ort: k.ort ?? '' });
                        }}
                      >
                        Bearbeiten
                      </button>
                      <button
                        type="button"
                        className="rounded-md p-1 text-red-600 hover:bg-red-50"
                        title="Kombination löschen"
                        aria-label={`„${k.strasse}" löschen`}
                        disabled={busy}
                        onClick={() => onLoeschen([k.id])}
                      >
                        <XIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
