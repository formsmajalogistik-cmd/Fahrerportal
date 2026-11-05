// Prüfdialog „Auslagen prüfen" — beim Erstellen einer Rechnung (bzw. vor
// dem Versand eines Entwurfs) und als Info aus dem Entwurf. Blockiert nie.
//
// Aufbau: Kopf mit Zusammenfassung („3 von 12 Touren …"), darunter eine
// Karte je Tour (Tour-ID · Datum · Route, Tourenart bei ABA/ABC) mit einer
// Zeile je Kennzeichen; Aktionen an der betroffenen Zeile. Zwei Arten von
// Problemen, sprachlich und farblich getrennt:
//   ⚠ „Auslagen ungeklärt" (orange)         → [Keine Auslagen] [Auslage hinzufügen ↗]
//   ⚠ „N Zusätze nicht auf der Rechnung" (rot) → [Zur Rechnung hinzufügen]
// Erledigte Zeilen bleiben ausgegraut mit ✓ stehen, die Zusammenfassung
// zählt mit. Kopf- und Fußzeile bleiben sichtbar, der Inhalt scrollt.

import { useState } from 'react';
import {
  keineAuslagenFuerUngeklaerte, slotKurz, type AuslagenTour, type AuslagenZusatz, type PruefErgebnis, type Slot,
} from '../../lib/auslagenStatus';
import { formatDate, formatEuro } from '../../lib/touren';
import { XIcon } from '../icons';

type Modus = 'erstellen' | 'versenden' | 'info';

const LABEL: Record<Modus, { offen: string; fertig: string }> = {
  erstellen: { offen: 'Trotzdem erstellen', fertig: 'Rechnung erstellen' },
  versenden: { offen: 'Trotzdem versenden', fertig: 'E-Mail versenden' },
  info: { offen: 'Schließen', fertig: 'Schließen' },
};

function route(t: AuslagenTour): string {
  const teile = [t.start_stadt, t.ziel_stadt, t.rueckfuehrung_stadt].filter((x): x is string => !!x && !!x.trim());
  return teile.join(' → ');
}

function kurzDatum(iso: string | null | undefined): string {
  const d = formatDate(iso);
  return d.length === 10 ? d.slice(0, 6) : d;   // „28.10."
}

function zusatzText(z: AuslagenZusatz): string {
  const summe = Number(z.betrag ?? 0) * Math.max(0.01, Number(z.anzahl ?? 1));
  return `${z.kategorie} ${formatEuro(Math.round(summe * 100) / 100)}`;
}

export function AuslagenPruefDialog({
  ergebnis, modus, neuPruefen, onFortfahren, onAbbrechen, onZusaetzeHinzufuegen,
}: {
  ergebnis: PruefErgebnis;
  modus: Modus;
  neuPruefen: () => Promise<PruefErgebnis>;
  onFortfahren: () => void;
  onAbbrechen: () => void;
  /** Fehlende Zusätze in die Rechnung übernehmen; liefert eine Meldung. */
  onZusaetzeHinzufuegen?: (tour: AuslagenTour, zusaetze: AuslagenZusatz[]) => Promise<string>;
}) {
  const [aktuell, setAktuell] = useState(ergebnis);
  // Was anfangs auffällig war, bleibt sichtbar (dann als erledigt).
  const [anzeige] = useState(() => new Set(ergebnis.touren.filter((t) => t.problem).map((t) => t.tour.id)));
  const [anfangsProbleme] = useState(() => {
    const s = new Set<string>();
    for (const t of ergebnis.touren) {
      for (const z of t.zeilen) if (z.status === 'ungeklaert') s.add(`${t.tour.id}:${z.slot.rolle}`);
      if (t.fehlend.length) s.add(`${t.tour.id}:fehlen`);
    }
    return s;
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  async function aktion(key: string, f: () => Promise<string | void>) {
    setBusy(key); setFehler(null); setMeldung(null);
    try {
      const m = await f();
      if (m) setMeldung(m);
      setAktuell(await neuPruefen());
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Aktion fehlgeschlagen');
    } finally {
      setBusy(null);
    }
  }

  const sichtbar = aktuell.touren.filter((t) => anzeige.has(t.tour.id) || t.problem);
  const allesGeprueft = aktuell.offen === 0;
  const label = LABEL[modus][allesGeprueft ? 'fertig' : 'offen'];

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-maja-ink/40 sm:items-center sm:px-4 sm:py-6 dark:bg-black/60">
      <div role="dialog" aria-modal="true" aria-labelledby="auslagen-pruef-titel"
           className="card flex max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-none sm:max-h-[90vh] sm:rounded-xl">
        {/* Kopf */}
        <div className="flex items-start justify-between gap-3 border-b border-maja-navy/10 px-5 py-4 dark:!border-slate-700">
          <div>
            <h2 id="auslagen-pruef-titel" className="text-lg font-semibold text-maja-navy">Auslagen prüfen</h2>
            <p className="mt-0.5 text-sm text-maja-ink" data-testid="pruef-zusammenfassung">
              {allesGeprueft
                ? <><span aria-hidden="true" className="text-emerald-700">✓ </span>Alles geprüft — keine offenen Punkte.</>
                : `${aktuell.offen} von ${aktuell.geprueft} ${aktuell.geprueft === 1 ? 'Tour' : 'Touren'} auf dieser Rechnung ${aktuell.offen === 1 ? 'braucht' : 'brauchen'} Prüfung`}
            </p>
          </div>
          <button type="button" onClick={onAbbrechen} aria-label="Schließen" disabled={!!busy}
                  className="rounded-md p-2 text-maja-muted hover:bg-maja-light">
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Inhalt (scrollt) */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-5" data-testid="pruef-inhalt">
          {meldung && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{meldung}</div>}
          {fehler && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</div>}
          {sichtbar.map((p) => {
            const t = p.tour;
            const zweiKz = t.tourenart === 'ABA' || t.tourenart === 'ABC';
            const erledigtFehlen = !p.fehlend.length && anfangsProbleme.has(`${t.id}:fehlen`);
            return (
              <section key={t.id} data-tour={t.id} data-problem={p.problem}
                       className={`rounded-lg border px-4 py-3 ${p.problem
                         ? 'border-maja-navy/15 dark:!border-slate-600'
                         : 'border-emerald-200 opacity-70'}`}>
                <h3 className="text-sm font-semibold text-maja-ink">
                  {t.tour_nr ?? 'Tour'}
                  <span className="font-normal text-maja-muted">
                    {' · '}{kurzDatum(t.enddatum ?? t.startdatum)}{route(t) ? ` · ${route(t)}` : ''}{zweiKz ? ` (${t.tourenart})` : ''}
                  </span>
                </h3>
                <ul className="mt-2 space-y-2">
                  {p.zeilen.map((z) => {
                    const warErProblem = anfangsProbleme.has(`${t.id}:${z.slot.rolle}`);
                    // Bei AB nur zeigen, was (mal) auffällig war; bei ABA/ABC alle.
                    if (!zweiKz && z.status !== 'ungeklaert' && !warErProblem) return null;
                    return (
                      <KennzeichenZeile key={z.slot.rolle} tour={t} slot={z.slot} status={z.status} erledigt={warErProblem && z.status !== 'ungeklaert'}
                                        zweiKz={zweiKz} busy={busy}
                                        onKeine={() => void aktion(`k${t.id}${z.slot.rolle}`, async () => {
                                          const n = await keineAuslagenFuerUngeklaerte([t.id], z.slot);
                                          return n ? undefined : `${t.tour_nr ?? 'Tour'}: inzwischen schon geklärt.`;
                                        })} />
                    );
                  })}
                  {p.fehlend.length > 0 && (
                    <li data-zeile="fehlen" className="rounded-md bg-red-50 px-3 py-2">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span aria-hidden="true" className="text-red-700">⚠</span>
                        <span className="font-semibold text-red-700">
                          {[...new Set(p.fehlend.map((z) => z.kennzeichen?.trim() || t.kennzeichen[0] || '').filter(Boolean))].join(', ') || 'ohne Kennzeichen'}
                        </span>
                        <span className="text-sm text-red-700">
                          {p.fehlend.length} {p.fehlend.length === 1 ? 'Zusatz' : 'Zusätze'} nicht auf der Rechnung
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-red-700">({p.fehlend.map(zusatzText).join(', ')})</div>
                      {onZusaetzeHinzufuegen && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button type="button" className="btn-secondary px-3 py-2 text-sm" disabled={!!busy}
                                  onClick={() => void aktion(`f${t.id}`, () => onZusaetzeHinzufuegen(t, p.fehlend))}>
                            {busy === `f${t.id}` ? '…' : 'Zur Rechnung hinzufügen'}
                          </button>
                        </div>
                      )}
                    </li>
                  )}
                  {erledigtFehlen && (
                    <li data-zeile="fehlen" data-erledigt className="flex items-baseline gap-2 px-3 text-sm text-maja-muted">
                      <span aria-hidden="true" className="text-emerald-700">✓</span> Zusätze stehen jetzt auf der Rechnung
                    </li>
                  )}
                </ul>
                <div className="mt-2 flex justify-end">
                  <a className="btn-secondary px-3 py-2 text-sm" href={`/touren?tour=${encodeURIComponent(t.id)}`}
                     target="_blank" rel="noopener noreferrer">
                    Tour öffnen ↗
                  </a>
                </div>
              </section>
            );
          })}
        </div>

        {/* Fuß */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-maja-navy/10 px-5 py-3 dark:!border-slate-700">
          <button type="button" className="btn-secondary px-3 py-2 text-sm" disabled={!!busy}
                  onClick={() => void aktion('pruefen', async () => undefined)}>
            {busy === 'pruefen' ? 'Prüft …' : 'Erneut prüfen'}
          </button>
          <div className="flex flex-wrap gap-2">
            {modus !== 'info' && (
              <button type="button" className="btn-secondary px-3 py-2 text-sm" onClick={onAbbrechen} disabled={!!busy}>Abbrechen</button>
            )}
            <button type="button" className="btn-primary px-4 py-2 text-sm" disabled={!!busy}
                    onClick={modus === 'info' ? onAbbrechen : onFortfahren}>
              {label}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function KennzeichenZeile({
  tour, slot, status, erledigt, zweiKz, busy, onKeine,
}: {
  tour: AuslagenTour; slot: Slot; status: 'ok' | 'keine' | 'ungeklaert'; erledigt: boolean; zweiKz: boolean;
  busy: string | null; onKeine: () => void;
}) {
  const kz = slot.kennzeichen ?? '(Kennzeichen nicht erfasst)';
  const rolle = zweiKz ? (slot.rolle === 'hin' ? ' (Hin)' : ' (Rück)') : '';
  if (status !== 'ungeklaert') {
    return (
      <li data-zeile={slot.rolle} data-status={status} data-erledigt={erledigt || undefined}
          className="flex flex-wrap items-baseline gap-x-2 px-3 text-sm text-maja-muted">
        <span aria-hidden="true" className="text-emerald-700">✓</span>
        <span className="font-medium text-maja-ink">{kz}</span>
        <span>{status === 'ok' ? 'Auslagen vorhanden' : '„Keine Auslagen"'}{rolle}{erledigt ? ' — erledigt' : ''}</span>
      </li>
    );
  }
  return (
    <li data-zeile={slot.rolle} data-status="ungeklaert" className="rounded-md bg-orange-100 px-3 py-2 dark:!bg-amber-500/15">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span aria-hidden="true" className="text-orange-700 dark:!text-amber-300">⚠</span>
        <span className="font-semibold text-orange-800 dark:!text-amber-200">{kz}</span>
        <span className="text-sm text-orange-800 dark:!text-amber-200">Auslagen ungeklärt{rolle}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="btn-secondary px-3 py-2 text-sm" disabled={!!busy} onClick={onKeine}
                aria-label={`Keine Auslagen für ${slotKurz(slot) || kz}`}>
          {busy === `k${tour.id}${slot.rolle}` ? '…' : 'Keine Auslagen'}
        </button>
        <a className="btn-secondary px-3 py-2 text-sm" href={`/touren?tour=${encodeURIComponent(tour.id)}`}
           target="_blank" rel="noopener noreferrer">
          Auslage hinzufügen ↗
        </a>
      </div>
    </li>
  );
}
