// Vorschau „In zwei AB-Touren aufteilen" (Admin, ABA/ABC).
//
// Zeigt nebeneinander, was aus der Tour wird, und lässt Fahrer, Datum,
// Preis, Honorar und Barauslagen je Teil anpassen. Gespeichert wird erst
// mit „Aufteilen" — dann in EINER Transaktion durch die Datenbankfunktion
// tour_aufteilen (Migration 106). Regeln: lib/tourAufteilung.ts.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { XIcon } from '../../components/icons';
import { formatDateTime, formatEuro, formatKm } from '../../lib/touren';
import { berechneTourPreis } from '../../lib/tourPreis';
import {
  aufteilungsOptionen, aufteilungsRouten, aufteilungsSummeWeichtAb, entwurfDefault,
  parseBetrag, preisVergleichText, zusatzZuordnung, type TourNr,
} from '../../lib/tourAufteilung';
import { fahrerName } from '../../lib/names';
import { FahrerSelect, type FahrerOptionRaw } from './FahrerSelect';
import type { GreimelZugang, Tour } from '../../types/db';

export interface AufteilungsErgebnis {
  tour_id: string;
  tour_nr: string | null;
  neue_tour_id: string;
  neue_tour_nr: string | null;
  notiz_hinweis: boolean;
}

interface Props {
  tourId: string;
  fahrer: FahrerOptionRaw[];
  zugaenge: GreimelZugang[];
  onClose: () => void;
  onDone: (e: AufteilungsErgebnis) => void;
}

interface ZusatzRow { id: string; kategorie: string; betrag: number; anzahl: number | null; notiz: string | null; kennzeichen: string | null }
interface EntwurfRow {
  id: string; created_at: string;
  template: { name: string } | null;
  fahrer: { vorname: string | null; nachname: string | null; user: { email: string; vorname: string | null; nachname: string | null } | null } | null;
}
interface ZuweisungRow { id: string; template_id: string; template: { name: string } | null }

interface TeilForm {
  fahrerId: string;
  startdatum: string;
  enddatum: string;
  verguetung: string;
  honorar: string;
  barauslagen: string;
}

const betragText = (n: number | null | undefined) =>
  n == null ? '' : n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });

export function TourAufteilenDialog({ tourId, fahrer, zugaenge, onClose, onDone }: Props) {
  const [tour, setTour] = useState<Tour | null>(null);
  const [sperre, setSperre] = useState<string | null>(null);
  const [zusaetze, setZusaetze] = useState<ZusatzRow[]>([]);
  const [entwuerfe, setEntwuerfe] = useState<EntwurfRow[]>([]);
  const [zuweisungen, setZuweisungen] = useState<ZuweisungRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [t1, setT1] = useState<TeilForm | null>(null);
  const [t2, setT2] = useState<TeilForm | null>(null);
  const [preisAuto, setPreisAuto] = useState<{ p1: number | null; p2: number | null } | null>(null);
  const [zusatzWahl, setZusatzWahl] = useState<Record<string, TourNr>>({});
  const [entwurfWahl, setEntwurfWahl] = useState<Record<string, TourNr>>({});
  const [zuweisungWahl, setZuweisungWahl] = useState<Record<string, '1' | '2' | 'beide'>>({});
  const [greimelBei, setGreimelBei] = useState<TourNr>(1);
  const [geprueft, setGeprueft] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [tRes, sRes, zRes, eRes, wRes] = await Promise.all([
        supabase.from('touren').select('*').eq('id', tourId).single(),
        supabase.rpc('tour_aufteilung_sperrgrund', { p_tour_id: tourId }),
        supabase.from('tour_zusaetze').select('id, kategorie, betrag, anzahl, notiz, kennzeichen').eq('tour_id', tourId).order('created_at'),
        supabase.from('ausgefuellte_formulare')
          .select('id, created_at, template:template_id (name), fahrer:fahrer_id (vorname, nachname, user:user_id (email, vorname, nachname))')
          .eq('status', 'draft').eq('daten->>_tour_id', tourId),
        supabase.from('tour_protokoll_zuweisungen').select('id, template_id, template:template_id (name)').eq('tour_id', tourId).order('sort_order'),
      ]);
      if (cancelled) return;
      if (tRes.error || !tRes.data) { setError(tRes.error?.message ?? 'Tour nicht gefunden.'); setLoading(false); return; }
      const t = tRes.data as unknown as Tour;
      setTour(t);
      if (sRes.error) setError(`Prüfung auf Rechnung fehlgeschlagen: ${sRes.error.message}`);
      setSperre((sRes.data as string | null) ?? null);
      const zs = (zRes.data as unknown as ZusatzRow[]) ?? [];
      setZusaetze(zs);
      setZusatzWahl(Object.fromEntries(zs.map((z) => [z.id, zusatzZuordnung(z, t.kennzeichen) ?? 1])));
      const es = (eRes.data as unknown as EntwurfRow[]) ?? [];
      setEntwuerfe(es);
      setEntwurfWahl(Object.fromEntries(es.map((e) => [e.id, entwurfDefault(t)])));
      const ws = (wRes.data as unknown as ZuweisungRow[]) ?? [];
      setZuweisungen(ws);
      setZuweisungWahl(Object.fromEntries(ws.map((w) => [w.template_id, 'beide' as const])));

      // Preise je Teil nach Preisliste: AB mit den jeweiligen km, also
      // ohne ABA-Aufschlag. Bei Sondervereinbarung nicht automatisch.
      let p1: number | null = null;
      let p2: number | null = null;
      if (!t.ist_sondervereinbarung) {
        const basis = {
          auftraggeberId: t.auftraggeber_id, tourenart: 'AB', kmRueck: null,
          hatRueckfuehrung: false, abaGesamtKmBerechnen: false, istEFahrzeug: t.ist_e_fahrzeug,
        };
        const [r1, r2] = await Promise.all([
          berechneTourPreis({ ...basis, kmHin: t.km_hin }),
          berechneTourPreis({ ...basis, kmHin: t.km_rueck }),
        ]);
        p1 = r1.breakdown?.total ?? null;
        p2 = r2.breakdown?.total ?? null;
        if (cancelled) return;
      }
      setPreisAuto({ p1, p2 });
      const teil = (verguetung: number | null, honorar: number, auslagen: number): TeilForm => ({
        fahrerId: t.fahrer_id ?? '',
        startdatum: t.startdatum ?? '',
        enddatum: t.enddatum ?? '',
        verguetung: betragText(verguetung),
        honorar: betragText(honorar),
        barauslagen: betragText(auslagen),
      });
      // Honorar und Barauslagen: Default alles bei Tour 1.
      setT1(teil(p1, Number(t.fahrer_honorar ?? 0), Number(t.barauslagen ?? 0)));
      setT2(teil(p2, 0, 0));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tourId]);

  const routen = tour ? aufteilungsRouten(tour) : null;
  const kz = tour?.kennzeichen ?? [];
  const zugang = tour?.greimel_zugang_id ? zugaenge.find((z) => z.id === tour.greimel_zugang_id) ?? null : null;

  const werte = useMemo(() => {
    if (!t1 || !t2) return null;
    const p = (s: string) => parseBetrag(s);
    return {
      v1: p(t1.verguetung), v2: p(t2.verguetung),
      h1: p(t1.honorar) ?? 0, h2: p(t2.honorar) ?? 0,
      b1: p(t1.barauslagen) ?? 0, b2: p(t2.barauslagen) ?? 0,
    };
  }, [t1, t2]);
  const ungueltig = !!werte && Object.values(werte).some((v) => typeof v === 'number' && Number.isNaN(v));
  const negativ = !!werte && [werte.h1, werte.h2, werte.b1, werte.b2, werte.v1 ?? 0, werte.v2 ?? 0].some((v) => v < 0);
  const ohneDatum = !!tour && !tour.auf_eis && !!t1 && !!t2
    && (!t1.startdatum || !t1.enddatum || !t2.startdatum || !t2.enddatum);

  async function aufteilen() {
    if (!tour || !t1 || !t2 || !werte || ungueltig || negativ || ohneDatum) return;
    setBusy(true);
    setError(null);
    const optionen = aufteilungsOptionen({
      erwartetUpdatedAt: tour.updated_at,
      tour1: { fahrerId: t1.fahrerId, startdatum: t1.startdatum, enddatum: t1.enddatum, verguetung: werte.v1, fahrerHonorar: werte.h1, barauslagen: werte.b1 },
      tour2: { fahrerId: t2.fahrerId, startdatum: t2.startdatum, enddatum: t2.enddatum, verguetung: werte.v2, fahrerHonorar: werte.h2, barauslagen: werte.b2 },
      zusatzIdsTour2: Object.entries(zusatzWahl).filter(([, n]) => n === 2).map(([id]) => id),
      entwurfIdsTour2: Object.entries(entwurfWahl).filter(([, n]) => n === 2).map(([id]) => id),
      zuweisungen: zuweisungWahl,
      greimelBei,
    });
    const { data, error: err } = await supabase.rpc('tour_aufteilen', {
      p_tour_id: tour.id, p_optionen: optionen as never,
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onDone(data as unknown as AufteilungsErgebnis);
  }

  const teilSpalte = (nr: TourNr, f: TeilForm, set: (f: TeilForm) => void) => {
    if (!tour) return null;
    const rueck = nr === 2;
    const kennz = (rueck ? kz[1] : kz[0])?.trim() || '—';
    const fin = (rueck ? tour.fin_rueck : tour.fin) || '—';
    const modell = (rueck ? tour.fahrzeugmodell_rueck : tour.fahrzeugmodell) || '—';
    const km = rueck ? tour.km_rueck : tour.km_hin;
    const auto = rueck ? preisAuto?.p2 : preisAuto?.p1;
    const pre = `teil${nr}`;
    return (
      <section aria-labelledby={`${pre}-titel`} className="rounded-xl border border-maja-navy/15 p-4 dark:!border-slate-600">
        <h3 id={`${pre}-titel`} className="text-sm font-semibold text-maja-navy">
          {nr === 1 ? `Tour 1 · ${tour.tour_id ?? 'bestehend'} (bleibt)` : 'Tour 2 · neue Tour-ID'}
        </h3>
        <p className="mt-0.5 text-base font-semibold text-maja-ink">{rueck ? routen?.tour2 : routen?.tour1} <span className="text-xs font-normal text-maja-muted">(AB)</span></p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <dt className="text-maja-muted">Kennzeichen</dt><dd className="text-maja-ink">{kennz}</dd>
          <dt className="text-maja-muted">FIN</dt><dd className="break-all text-maja-ink">{fin}</dd>
          <dt className="text-maja-muted">Modell</dt><dd className="text-maja-ink">{modell}</dd>
          <dt className="text-maja-muted">km</dt><dd className="text-maja-ink">{formatKm(km)}</dd>
          <dt className="text-maja-muted">Protokoll</dt>
          <dd className="text-maja-ink">{(rueck ? tour.eingang_id_bc : tour.eingang_id) ? `${rueck ? 'Rück' : 'Hin'}-Protokoll verknüpft` : '—'}</dd>
        </dl>
        <div className="mt-3 space-y-2">
          <div>
            <label htmlFor={`${pre}-fahrer`} className="tf-label">Fahrer</label>
            <FahrerSelect id={`${pre}-fahrer`} className="tf-input" value={f.fahrerId} fahrer={fahrer}
                          onChange={(id) => set({ ...f, fahrerId: id })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor={`${pre}-start`} className="tf-label">Startdatum</label>
              <input id={`${pre}-start`} type="date" className="tf-input" value={f.startdatum}
                     onChange={(e) => set({ ...f, startdatum: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`${pre}-ende`} className="tf-label">Enddatum</label>
              <input id={`${pre}-ende`} type="date" className="tf-input" value={f.enddatum}
                     onChange={(e) => set({ ...f, enddatum: e.target.value })} />
            </div>
          </div>
          <div>
            <label htmlFor={`${pre}-preis`} className="tf-label">Preis (netto, €)</label>
            <input id={`${pre}-preis`} inputMode="decimal" className="tf-input" value={f.verguetung}
                   placeholder={tour.ist_sondervereinbarung ? 'manuell eintragen' : ''}
                   onChange={(e) => set({ ...f, verguetung: e.target.value })} />
            <p className="mt-0.5 text-[11px] text-maja-muted">
              {tour.ist_sondervereinbarung
                ? 'Sondervereinbarung — nicht automatisch berechnet.'
                : auto != null
                  ? `Preisliste AB, ${formatKm(km)}: ${formatEuro(auto)}`
                  : 'Keine passende Preisstufe — bitte manuell eintragen.'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor={`${pre}-honorar`} className="tf-label">Fahrer-Honorar (€)</label>
              <input id={`${pre}-honorar`} inputMode="decimal" className="tf-input" value={f.honorar}
                     onChange={(e) => set({ ...f, honorar: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`${pre}-auslagen`} className="tf-label">Barauslagen (€)</label>
              <input id={`${pre}-auslagen`} inputMode="decimal" className="tf-input" value={f.barauslagen}
                     onChange={(e) => set({ ...f, barauslagen: e.target.value })} />
            </div>
          </div>
        </div>
      </section>
    );
  };

  const hinweisBox = 'rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900';

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8 dark:bg-black/60">
      <div role="dialog" aria-modal="true" aria-labelledby="aufteilen-titel" className="card w-full max-w-4xl p-6">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id="aufteilen-titel" className="text-lg font-semibold text-maja-navy">In zwei AB-Touren aufteilen</h2>
            {tour && (
              <p className="text-xs text-maja-muted">
                {tour.tour_id} · {tour.tourenart}: {tour.start_stadt} → {tour.ziel_stadt} → {tour.rueckfuehrung_stadt}
                {' · '}Vorschau — gespeichert wird erst mit „Aufteilen".
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-maja-muted hover:bg-maja-light" aria-label="Schließen">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-maja-muted">Vorschau wird vorbereitet …</p>
        ) : sperre ? (
          <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-3 text-sm text-red-800">
            <strong>Aufteilen nicht möglich.</strong> {sperre}
          </div>
        ) : tour && t1 && t2 && werte ? (
          <div className="space-y-4">
            <p className="text-xs text-maja-muted">
              Grundlage ist der gespeicherte Stand der Tour. Nicht gespeicherte Eingaben im Bearbeiten-Formular werden verworfen.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {teilSpalte(1, t1, setT1)}
              {teilSpalte(2, t2, setT2)}
            </div>

            {/* Preisvergleich — bewusst bestätigen */}
            <div className="rounded-lg bg-maja-light/60 px-3 py-2 text-sm text-maja-ink dark:!bg-slate-800">
              <div className="font-medium">
                {preisVergleichText({ tourenart: tour.tourenart, bisher: tour.verguetung, preis1: Number.isNaN(werte.v1) ? null : werte.v1, preis2: Number.isNaN(werte.v2) ? null : werte.v2 })}
              </div>
              {tour.ist_sondervereinbarung && (
                <p className="mt-1 text-xs text-amber-800 dark:!text-amber-300">
                  Sondervereinbarung{tour.sondervereinbarung ? ` („${tour.sondervereinbarung}")` : ''}: Preise bitte manuell festlegen.
                </p>
              )}
              {aufteilungsSummeWeichtAb(Number(tour.fahrer_honorar ?? 0), werte.h1, werte.h2) && (
                <p className="mt-1 text-xs text-amber-800 dark:!text-amber-300">
                  Fahrer-Honorar bisher {formatEuro(Number(tour.fahrer_honorar ?? 0))}, aufgeteilt {formatEuro(werte.h1 + werte.h2)}.
                </p>
              )}
              {aufteilungsSummeWeichtAb(Number(tour.barauslagen ?? 0), werte.b1, werte.b2) && (
                <p className="mt-1 text-xs text-amber-800 dark:!text-amber-300">
                  Barauslagen bisher {formatEuro(Number(tour.barauslagen ?? 0))}, aufgeteilt {formatEuro(werte.b1 + werte.b2)}.
                </p>
              )}
            </div>

            {/* Zusätze */}
            {zusaetze.length > 0 && (
              <fieldset>
                <legend className="text-sm font-semibold text-maja-navy">Zusätze</legend>
                <ul className="mt-1 divide-y divide-maja-navy/10 text-sm">
                  {zusaetze.map((z) => {
                    const fest = zusatzZuordnung(z, kz);
                    return (
                      <li key={z.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                        <span className="text-maja-ink">
                          {z.kategorie} · {formatEuro(Number(z.betrag) * Number(z.anzahl ?? 1))}
                          {z.kennzeichen ? <span className="text-maja-muted"> · {z.kennzeichen}</span> : null}
                          {z.notiz ? <span className="text-maja-muted"> · {z.notiz}</span> : null}
                        </span>
                        {fest ? (
                          <span className="text-xs text-maja-muted">→ Tour {fest} (über Kennzeichen)</span>
                        ) : (
                          <span className="flex gap-3 text-xs">
                            {([1, 2] as const).map((n) => (
                              <label key={n} className="inline-flex items-center gap-1">
                                <input type="radio" name={`zusatz-${z.id}`} checked={zusatzWahl[z.id] === n}
                                       onChange={() => setZusatzWahl((m) => ({ ...m, [z.id]: n }))} />
                                Tour {n}
                              </label>
                            ))}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            )}

            {/* Protokoll-Zuweisungen */}
            {zuweisungen.length > 0 && (
              <fieldset>
                <legend className="text-sm font-semibold text-maja-navy">Zugewiesene Protokolle</legend>
                <ul className="mt-1 space-y-1 text-sm">
                  {zuweisungen.map((w) => (
                    <li key={w.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-maja-ink">{w.template?.name ?? 'Protokoll'}</span>
                      <span className="flex gap-3 text-xs">
                        {(['1', '2', 'beide'] as const).map((v) => (
                          <label key={v} className="inline-flex items-center gap-1">
                            <input type="radio" name={`zuw-${w.id}`} checked={zuweisungWahl[w.template_id] === v}
                                   onChange={() => setZuweisungWahl((m) => ({ ...m, [w.template_id]: v }))} />
                            {v === 'beide' ? 'beide' : `Tour ${v}`}
                          </label>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </fieldset>
            )}

            {/* Entwürfe in Bearbeitung */}
            {entwuerfe.length > 0 && (
              <div role="alert" className={hinweisBox}>
                <p className="font-semibold">
                  {entwuerfe.length === 1 ? 'Ein Formular wird gerade ausgefüllt' : `${entwuerfe.length} Formulare werden gerade ausgefüllt`} — der Entwurf bleibt beim gewählten Teil:
                </p>
                <ul className="mt-1 space-y-1">
                  {entwuerfe.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {e.template?.name ?? 'Formular'} · {e.fahrer ? fahrerName(e.fahrer, e.fahrer.user) : 'Fahrer unbekannt'} · begonnen {formatDateTime(e.created_at)}
                      </span>
                      <span className="flex gap-3">
                        {([1, 2] as const).map((n) => (
                          <label key={n} className="inline-flex items-center gap-1">
                            <input type="radio" name={`entwurf-${e.id}`} checked={entwurfWahl[e.id] === n}
                                   onChange={() => setEntwurfWahl((m) => ({ ...m, [e.id]: n }))} />
                            Tour {n}
                          </label>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Greimel */}
            {tour.greimel_zugang_id && (
              <fieldset className="text-sm">
                <legend className="font-semibold text-maja-navy">Greimel-Zugang {zugang ? `„${zugang.titel}"` : ''} bleibt bei</legend>
                <div className="mt-1 flex gap-4 text-xs">
                  {([1, 2] as const).map((n) => (
                    <label key={n} className="inline-flex items-center gap-1">
                      <input type="radio" name="greimel" checked={greimelBei === n} onChange={() => setGreimelBei(n)} />
                      Tour {n}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            <p className="text-xs text-maja-muted">
              Auftraggeber, Kundenname, Sondervereinbarung, Hinweise und Bestätigungsstatus werden in Tour 2 übernommen —
              der Auftraggeber sieht beide Touren. Eine interne Notiz des Auftraggebers bleibt bei Tour 1; Tour 2 erhält
              dann einen Hinweis darauf. Es wird keine E-Mail versendet.
            </p>

            {(ungueltig || negativ || ohneDatum) && (
              <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {ohneDatum ? 'Start- und Enddatum sind für beide Touren nötig. ' : ''}
                {ungueltig ? 'Ein Betrag ist ungültig. ' : ''}
                {negativ ? 'Beträge dürfen nicht negativ sein.' : ''}
              </div>
            )}

            <label className="flex items-start gap-2 text-sm text-maja-ink">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={geprueft} onChange={(e) => setGeprueft(e.target.checked)} />
              Ich habe Preise, Fahrer und Daten der beiden Touren geprüft.
            </label>
          </div>
        ) : null}

        {error && (
          <div role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Abbrechen</button>
          {!loading && !sperre && tour && (
            <button type="button" className="btn-primary" onClick={() => void aufteilen()}
                    disabled={busy || !geprueft || ungueltig || negativ || ohneDatum}>
              {busy ? 'Wird aufgeteilt …' : 'Aufteilen'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
