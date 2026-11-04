// Prüfdialog vor dem Erstellen/Speichern/Versenden einer Rechnung: welche
// Touren haben ungeklärte oder nicht abgerechnete Auslagen? Blockiert nie —
// „Trotzdem fortfahren" macht weiter wie bisher.
//
// Je Tour: „Keine Auslagen" setzen (direkt), „Auslagen hinzufügen"
// (fehlende Zusätze in diese Rechnung übernehmen, falls der Aufrufer das
// kann) und „Tour öffnen" (neuer Tab, die Rechnung bleibt offen).

import { useState } from 'react';
import {
  auffaelligkeitText, keineAuslagenFuerUngeklaerte, pruefZusammenfassung, slotKurz, type Auffaelligkeit,
} from '../../lib/auslagenStatus';
import { formatDate } from '../../lib/touren';

export function AuslagenPruefDialog({
  titel, auffaelligkeiten, fortfahrenLabel, onErneutPruefen, onFortfahren, onAbbrechen, onAuslagenHinzufuegen,
}: {
  titel: string;
  auffaelligkeiten: Auffaelligkeit[];
  fortfahrenLabel: string;
  onErneutPruefen: () => Promise<void>;
  onFortfahren: () => void;
  onAbbrechen: () => void;
  /** Fehlende Zusätze in die Rechnung übernehmen; liefert Hinweistext. */
  onAuslagenHinzufuegen?: (a: Auffaelligkeit) => Promise<string>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  async function aktion(key: string, f: () => Promise<string | void>) {
    setBusy(key); setFehler(null); setMeldung(null);
    try {
      const m = await f();
      if (m) setMeldung(m);
      await onErneutPruefen();
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Aktion fehlgeschlagen');
    } finally {
      setBusy(null);
    }
  }

  const leer = auffaelligkeiten.length === 0;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8 dark:bg-black/60">
      <div role="dialog" aria-modal="true" aria-labelledby="auslagen-pruef-titel" className="card w-full max-w-2xl space-y-4 p-5">
        <div>
          <h2 id="auslagen-pruef-titel" className="text-lg font-semibold text-maja-navy">{titel}</h2>
          <p className="mt-1 text-sm text-maja-ink" data-testid="pruef-zusammenfassung">
            {leer ? 'Keine Auffälligkeiten mehr bei den Auslagen.' : pruefZusammenfassung(auffaelligkeiten)}
          </p>
        </div>
        {meldung && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{meldung}</div>}
        {fehler && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</div>}
        {!leer && (
          <ul className="divide-y divide-maja-navy/10 rounded-lg border border-maja-navy/10">
            {auffaelligkeiten.map((a) => (
              <li key={`${a.tour.id}:${a.grund}`} data-tour={a.tour.id} data-grund={a.grund} className="flex flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-maja-ink">
                    {a.tour.tour_nr ?? 'Tour'}
                    <span className="ml-2 font-normal text-maja-muted">
                      {formatDate(a.tour.enddatum ?? a.tour.startdatum)}{a.tour.kennzeichen.length ? ` · ${a.tour.kennzeichen.join(' / ')}` : ''}
                    </span>
                  </div>
                  <div className={`text-xs ${a.grund === 'fehlen' ? 'text-amber-800' : 'text-orange-700 dark:!text-orange-200'}`}>
                    {auffaelligkeitText(a)}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  {/* „Keine Auslagen" je ungeklärtem Kennzeichen; bei mehreren
                      zusätzlich für alle (Zusatz je Kennzeichen, Migration 113). */}
                  {a.grund === 'ungeklaert' && a.slots.length > 1 && (
                    <button type="button" className="btn-secondary px-2.5 py-1 text-xs" disabled={!!busy}
                            onClick={() => void aktion(`k${a.tour.id}`, async () => {
                              const n = await keineAuslagenFuerUngeklaerte([a.tour.id]);
                              return `${a.tour.tour_nr ?? 'Tour'}: „Keine Auslagen" für ${n} Kennzeichen eingetragen.`;
                            })}>
                      {busy === `k${a.tour.id}` ? '…' : 'Keine Auslagen (alle)'}
                    </button>
                  )}
                  {a.grund === 'ungeklaert' && a.slots.map((s) => (
                    <button key={s.rolle} type="button" className="btn-secondary px-2.5 py-1 text-xs" disabled={!!busy}
                            onClick={() => void aktion(`k${a.tour.id}${s.rolle}`, async () => {
                              const n = await keineAuslagenFuerUngeklaerte([a.tour.id], s);
                              return n ? `${a.tour.tour_nr ?? 'Tour'}: „Keine Auslagen" für ${slotKurz(s) || 'die Tour'} eingetragen.`
                                : `${a.tour.tour_nr ?? 'Tour'}: inzwischen schon geklärt.`;
                            })}>
                      {busy === `k${a.tour.id}${s.rolle}` ? '…' : `Keine Auslagen${s.rolle === 'einzig' ? '' : ` ${slotKurz(s)}`}`}
                    </button>
                  ))}
                  {a.grund === 'fehlen' && onAuslagenHinzufuegen && (
                    <button type="button" className="btn-secondary px-2.5 py-1 text-xs" disabled={!!busy}
                            onClick={() => void aktion(`a${a.tour.id}`, () => onAuslagenHinzufuegen(a))}>
                      {busy === `a${a.tour.id}` ? '…' : 'Auslagen hinzufügen'}
                    </button>
                  )}
                  <a className="btn-secondary px-2.5 py-1 text-xs" href={`/touren?tour=${encodeURIComponent(a.tour.id)}`}
                     target="_blank" rel="noopener noreferrer">
                    Tour öffnen
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onAbbrechen} disabled={!!busy}>Abbrechen</button>
          <button type="button" className="btn-secondary" disabled={!!busy}
                  onClick={() => void aktion('pruefen', async () => undefined)}>
            {busy === 'pruefen' ? 'Prüft …' : 'Erneut prüfen'}
          </button>
          <button type="button" className="btn-primary" onClick={onFortfahren} disabled={!!busy}>
            {leer ? fortfahrenLabel : `Trotzdem fortfahren — ${fortfahrenLabel}`}
          </button>
        </div>
      </div>
    </div>
  );
}
