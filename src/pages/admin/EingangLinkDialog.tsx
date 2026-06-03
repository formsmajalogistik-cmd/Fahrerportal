import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { displayName } from '../../lib/names';
import { XIcon } from '../../components/icons';
import { RouteSelectorDialog } from '../../components/RouteSelectorDialog';
import {
  abschnittLabels, computeTourStatus, formatDate, formatKm, hasTwoProtokollSlots,
  tourTitel,
  type ProtokollAbschnitt,
} from '../../lib/touren';
import { summarizeEingang, type EingangSummary } from '../../lib/eingangData';
import type {
  AppUser, Auftraggeber, AusgefuelltesFormular, Fahrer, FormularTemplate, Tour,
} from '../../types/db';
import type { Database } from '../../types/supabase';

interface RouteQueueItem {
  tourId: string;
  origin: string;
  destination: string;
  field: 'km_hin' | 'km_rueck';
  title: string;
}

type TourInsert = Database['public']['Tables']['touren']['Insert'];
type TourUpdate = Database['public']['Tables']['touren']['Update'];

type FahrerWithUser = Fahrer & { user: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null };

interface TourRow extends Tour {
  auftraggeber: Pick<Auftraggeber, 'name'> | null;
  fahrer: FahrerWithUser | null;
}

interface Props {
  formular: AusgefuelltesFormular;
  template: Pick<FormularTemplate, 'id' | 'name'> | null;
  onClose: () => void;
  /**
   * Wird nach erfolgreicher Verknüpfung aufgerufen. `filledFields` enthält
   * die Tour-Spalten, die aus dem Eingang übernommen wurden — der
   * Aufrufer kann daraus eine Toast-Meldung bauen.
   */
  onLinked: (filledFields: string[]) => void;
}

type Tab = 'existing' | 'new';

export function EingangLinkDialog({ formular, template: _template, onClose, onLinked }: Props) {
  const [tab, setTab] = useState<Tab>('existing');
  const [touren, setTouren] = useState<TourRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bei ABA/ABC mit zwei freien Slots: Tour, deren Abschnitt gerade gewählt wird. */
  const [abschnittPick, setAbschnittPick] = useState<TourRow | null>(null);
  /**
   * Queue für die automatische Routenberechnung nach erfolgreicher
   * Verknüpfung. Wird vom RouteSelectorDialog der Reihe nach abgearbeitet.
   * Sobald die Queue leer ist UND eine Verknüpfung gespeichert war,
   * rufen wir onLinked auf und schließen den Dialog (siehe finalize-Effekt).
   */
  const [routeQueue, setRouteQueue] = useState<RouteQueueItem[]>([]);
  const pendingFilledRef = useRef<string[] | null>(null);

  const summary = useMemo(() => summarizeEingang(formular), [formular]);

  useEffect(() => {
    // Finalisiert die Post-Link-Routenphase: sobald die Queue leer ist
    // und wir eine ausstehende Verknüpfung haben, geben wir die ge-
    // füllten Felder an den Aufrufer (Toast + Reload).
    if (routeQueue.length === 0 && pendingFilledRef.current !== null) {
      const filled = pendingFilledRef.current;
      pendingFilledRef.current = null;
      onLinked(filled);
    }
  }, [routeQueue, onLinked]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Touren laden, bei denen mindestens ein Protokoll-Slot frei ist:
      //   AB-Touren: eingang_id IS NULL
      //   ABA/ABC: AB-Slot ODER BC-Slot frei (2 Protokolle pro Tour)
      // PostgREST kann das mit `.or(...)` als kombinierter Filter:
      //   eingang_id IS NULL OR
      //   (tourenart in (ABA,ABC) AND eingang_id_bc IS NULL)
      const { data, error: err } = await supabase
        .from('touren')
        .select(`
          *,
          auftraggeber:auftraggeber_id (name),
          fahrer:fahrer_id (id, user_id, aktiv,
            user:user_id (email, vorname, nachname))
        `)
        .or('eingang_id.is.null,and(tourenart.in.(ABA,ABC),eingang_id_bc.is.null)')
        .order('startdatum', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(200);
      if (cancelled) return;
      if (err) setError(err.message);
      else setTouren(((data as unknown) as TourRow[]) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const filteredTouren = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return touren;
    return touren.filter((t) => {
      const fahrerName = displayName(t.fahrer?.user ?? null).toLowerCase();
      return [
        t.tour_id ?? '',
        t.start_stadt, t.ziel_stadt, t.rueckfuehrung_stadt ?? '',
        ...(Array.isArray(t.kennzeichen) ? t.kennzeichen : []),
        fahrerName,
      ].join(' ').toLowerCase().includes(q);
    });
  }, [touren, search]);

  /**
   * Verknüpfungs-Logik für eine bestehende Tour. Bei ABA/ABC mit zwei
   * Slots wird `abschnitt` mitgegeben — daraus ergibt sich, welche Tour-
   * Spalten aus dem Eingang befüllt werden.
   *
   *   abschnitt === 'ab' (Default für AB-Touren): Daten fließen in
   *     adresse_start/ziel + kontakt_start/ziel (wie bisher).
   *   abschnitt === 'bc' (Rück/Teil 2): Daten fließen in
   *     adresse_rueckfuehrung + kontakt_rueckfuehrung. adresse_start/ziel
   *     bleibt unberührt — der AB-Teil ist bereits gefüllt.
   */
  async function linkExisting(tour: TourRow, abschnitt: ProtokollAbschnitt = 'ab') {
    setLinking(true);
    setError(null);
    // Bei einer bestehenden Tour: nur leere Felder aus dem Eingang nachfüllen.
    // Bereits eingetragene Tour-Werte werden NICHT überschrieben.
    const patch: TourUpdate = abschnitt === 'bc'
      ? { eingang_id_bc: formular.id }
      : { eingang_id: formular.id };
    const filled: string[] = [];
    const fieldKeys: string[] = [];
    function maybe(key: keyof TourUpdate, label: string, current: unknown, next: unknown) {
      const isEmpty = current == null
        || (typeof current === 'string' && current.trim() === '')
        || (Array.isArray(current) && current.length === 0);
      if (isEmpty && next != null && next !== '' && !(Array.isArray(next) && next.length === 0)) {
        (patch as Record<string, unknown>)[key as string] = next;
        filled.push(label);
        fieldKeys.push(key as string);
      }
    }
    // Feld-übergreifende Daten (FIN, Kennzeichen, Kundenname, km) gelten
    // für die ganze Tour — nur ergänzen, wenn noch leer.
    maybe('fin', 'FIN', tour.fin, summary.fin);
    maybe('kennzeichen', 'Kennzeichen', tour.kennzeichen, summary.kennzeichen ? [summary.kennzeichen.toUpperCase()] : null);
    maybe('kundenname', 'Kundenname', tour.kundenname, summary.kundenname);

    const kontaktPayload = (summary.kontaktName || summary.kontaktTelefon || summary.kontaktEmail) ? {
      name: summary.kontaktName ?? '',
      telefon: summary.kontaktTelefon ?? '',
      email: summary.kontaktEmail ?? '',
    } : null;

    if (abschnitt === 'bc') {
      // Rück/Teil 2: Übernahme = Übergabe-Adresse des AB-Teils (bleibt
      // wie sie ist), Übergabe-Adresse dieses Abschnitts = Rückführung.
      maybe('adresse_rueckfuehrung', 'Adresse Rückführung', tour.adresse_rueckfuehrung, summary.adresseUebergabe);
      if (kontaktPayload) {
        maybe('kontakt_rueckfuehrung', 'Kontakt Rückführung', tour.kontakt_rueckfuehrung, kontaktPayload);
      }
    } else {
      maybe('adresse_start', 'Adresse Übernahme', tour.adresse_start, summary.adresseUebernahme);
      maybe('adresse_ziel', 'Adresse Übergabe', tour.adresse_ziel, summary.adresseUebergabe);
      if (kontaktPayload) {
        maybe('kontakt_start', 'Kontakt Übernahme', tour.kontakt_start, kontaktPayload);
        maybe('kontakt_ziel',  'Kontakt Übergabe',  tour.kontakt_ziel,  kontaktPayload);
      }
    }

    // Liste der durch das Protokoll befüllten Spalten persistieren —
    // wird beim "Verknüpfung lösen" wieder gezielt zurückgesetzt. Pro
    // Abschnitt eigene Liste.
    if (fieldKeys.length > 0) {
      const colName = abschnitt === 'bc' ? 'protokoll_daten_felder_bc' : 'protokoll_daten_felder';
      (patch as Record<string, unknown>)[colName] = fieldKeys;
    }

    const { error: err } = await supabase
      .from('touren')
      .update(patch)
      .eq('id', tour.id);
    setLinking(false);
    if (err) { setError(err.message); return; }
    // Resultierende Adressen nach dem Update bestimmen — entweder
    // war der Wert schon auf der Tour, oder er kam gerade aus dem
    // Patch. Auto-Routenberechnung nur, wenn beide Enden für die
    // jeweilige Strecke ausgefüllt sind.
    const finalStart = (patch.adresse_start as string | null | undefined) ?? tour.adresse_start ?? null;
    const finalZiel  = (patch.adresse_ziel  as string | null | undefined) ?? tour.adresse_ziel  ?? null;
    const finalRueck = (patch.adresse_rueckfuehrung as string | null | undefined)
      ?? tour.adresse_rueckfuehrung ?? null;
    const queue: RouteQueueItem[] = [];
    if (abschnitt === 'bc') {
      if (finalZiel && finalRueck) {
        queue.push({
          tourId: tour.id,
          origin: finalZiel,
          destination: finalRueck,
          field: 'km_rueck',
          title: 'Routen für Rück-Strecke',
        });
      }
    } else {
      if (finalStart && finalZiel) {
        queue.push({
          tourId: tour.id,
          origin: finalStart,
          destination: finalZiel,
          field: 'km_hin',
          title: 'Routen für Hin-Strecke',
        });
      }
    }
    if (queue.length === 0) {
      onLinked(filled);
    } else {
      pendingFilledRef.current = filled;
      setRouteQueue(queue);
    }
  }

  /**
   * Wird vom Tour-Listen-Button aufgerufen. Bei ABA/ABC entscheidet sich
   * hier, ob ein Abschnitts-Dialog nötig ist (beide Slots noch frei) oder
   * der freie Slot direkt verwendet werden kann.
   */
  function handleTourClick(tour: TourRow) {
    if (!hasTwoProtokollSlots(tour.tourenart)) {
      void linkExisting(tour, 'ab');
      return;
    }
    const abFree = !tour.eingang_id;
    const bcFree = !tour.eingang_id_bc;
    if (abFree && !bcFree) { void linkExisting(tour, 'ab'); return; }
    if (!abFree && bcFree) { void linkExisting(tour, 'bc'); return; }
    // Beide Slots noch frei → Dialog.
    setAbschnittPick(tour);
  }

  async function createAndLink() {
    setLinking(true);
    setError(null);
    const payload = buildTourPayload(summary, formular.id);
    // id zurückholen, damit wir bei vorhandenen Adressen anschließend
    // die Auto-Routenberechnung starten können.
    const { data: inserted, error: err } = await supabase
      .from('touren').insert(payload).select('id').single();
    setLinking(false);
    if (err) { setError(err.message); return; }
    // Bei neuer Tour werden ALLE Felder direkt aus dem Eingang gesetzt.
    const filled = [
      summary.fin && 'FIN',
      summary.kennzeichen && 'Kennzeichen',
      summary.adresseUebernahme && 'Adresse Übernahme',
      summary.adresseUebergabe && 'Adresse Übergabe',
      summary.kundenname && 'Kundenname',
      (summary.kontaktName || summary.kontaktTelefon || summary.kontaktEmail) && 'Kontakt vor Ort',
    ].filter((s): s is string => !!s);
    const queue: RouteQueueItem[] = [];
    const tourId = inserted?.id;
    if (tourId && summary.adresseUebernahme && summary.adresseUebergabe) {
      queue.push({
        tourId,
        origin: summary.adresseUebernahme,
        destination: summary.adresseUebergabe,
        field: 'km_hin',
        title: 'Routen für Hin-Strecke',
      });
    }
    if (queue.length === 0) {
      onLinked(filled);
    } else {
      pendingFilledRef.current = filled;
      setRouteQueue(queue);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8">
      <div className="card w-full max-w-3xl p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-maja-navy">Mit Tour verknüpfen</h2>
            <p className="text-xs text-maja-muted">
              {summary.kennzeichen ? `Kennzeichen ${summary.kennzeichen}` : 'Eingang ohne Kennzeichen'}
              {' · '}{formular.created_at?.slice(0, 10) ?? '—'}
            </p>
          </div>
          <button type="button" onClick={onClose}
                  className="rounded-md p-1 text-maja-muted hover:bg-maja-light"
                  aria-label="Schließen"><XIcon className="h-4 w-4" /></button>
        </div>

        <div className="mb-4 inline-flex rounded-lg border border-maja-navy/15 bg-white p-0.5">
          {([{ id: 'existing', label: 'Bestehende Tour' },
             { id: 'new',      label: '+ Neue Tour anlegen' }] as Array<{ id: Tab; label: string }>)
            .map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  tab === t.id ? 'bg-maja-navy text-white' : 'text-maja-navy hover:bg-maja-light'
                }`}
              >
                {t.label}
              </button>
            ))}
        </div>

        {tab === 'existing' && (
          <div className="space-y-3">
            <input
              className="input"
              placeholder="Tour-ID, Stadt, Kennzeichen, Fahrer …"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {loading ? (
              <p className="text-sm text-maja-muted">Touren werden geladen …</p>
            ) : filteredTouren.length === 0 ? (
              <p className="text-sm text-maja-muted">Keine offenen Touren gefunden.</p>
            ) : (
              <ul className="max-h-96 space-y-1 overflow-auto">
                {filteredTouren.map((t) => {
                  const status = computeTourStatus(t.startdatum, t.enddatum);
                  const twoSlots = hasTwoProtokollSlots(t.tourenart);
                  const abFilled = !!t.eingang_id;
                  const bcFilled = !!t.eingang_id_bc;
                  const slotBadge = twoSlots
                    ? (abFilled || bcFilled
                        ? `1/2 verknüpft (${abFilled ? abschnittLabels(t).bc.short : abschnittLabels(t).ab.short} fehlt)`
                        : '2 Slots')
                    : null;
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => handleTourClick(t)}
                        disabled={linking}
                        className="flex w-full flex-wrap items-start justify-between gap-2 rounded-lg border border-maja-navy/10 bg-white p-3 text-left text-sm hover:bg-maja-light disabled:opacity-50"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {t.tour_id && (
                              <span className="rounded-full bg-maja-light px-2 py-0.5 text-xs font-semibold text-maja-navy">
                                {t.tour_id}
                              </span>
                            )}
                            <span className="font-medium text-maja-ink">{tourTitel(t)}</span>
                            {t.tourenart && (
                              <span className="rounded-full bg-maja-navy/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-maja-navy">
                                {t.tourenart}
                              </span>
                            )}
                            {slotBadge && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900">
                                {slotBadge}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 text-xs text-maja-muted">
                            {displayName(t.fahrer?.user ?? null) || '—'}
                            {t.startdatum && <> · {formatDate(t.startdatum)}</>}
                            {t.km_gesamt != null && <> · {formatKm(t.km_gesamt)}</>}
                            {(t.kennzeichen ?? []).length > 0 && <> · {(t.kennzeichen ?? []).join(', ')}</>}
                          </div>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          status === 'aktiv' ? 'bg-emerald-100 text-emerald-700'
                            : status === 'geplant' ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {status === 'aktiv' ? 'Aktiv' : status === 'geplant' ? 'Geplant' : 'Abgeschlossen'}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {tab === 'new' && (
          <div className="space-y-3">
            <p className="text-sm text-maja-muted">
              Eine neue Tour wird mit den Daten aus dem Formular angelegt und direkt
              mit diesem Eingang verknüpft.
            </p>
            <PrefillSummary summary={summary} />
            <button
              type="button"
              className="btn-primary w-full"
              onClick={() => void createAndLink()}
              disabled={linking}
            >
              {linking ? 'Tour wird angelegt …' : 'Neue Tour anlegen + verknüpfen'}
            </button>
          </div>
        )}

        {error && (
          <div role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="btn-secondary" disabled={linking}>
            Abbrechen
          </button>
        </div>
      </div>

      {abschnittPick && (
        <AbschnittPickerDialog
          tour={abschnittPick}
          onCancel={() => setAbschnittPick(null)}
          onChoose={(abschnitt) => {
            const t = abschnittPick;
            setAbschnittPick(null);
            void linkExisting(t, abschnitt);
          }}
        />
      )}

      {routeQueue.length > 0 && (() => {
        const item = routeQueue[0];
        const advance = () => setRouteQueue((q) => q.slice(1));
        return (
          <RouteSelectorDialog
            title={item.title}
            origin={item.origin}
            destination={item.destination}
            onClose={advance}
            onApply={async (km) => {
              const updatePatch: TourUpdate = item.field === 'km_rueck'
                ? { km_rueck: km }
                : { km_hin: km };
              const { error: updErr } = await supabase
                .from('touren')
                .update(updatePatch)
                .eq('id', item.tourId);
              if (updErr) {
                console.warn('[EingangLinkDialog] km-Update fehlgeschlagen', updErr);
              }
              advance();
            }}
          />
        );
      })()}
    </div>
  );
}

function AbschnittPickerDialog({
  tour, onCancel, onChoose,
}: {
  tour: TourRow;
  onCancel: () => void;
  onChoose: (abschnitt: ProtokollAbschnitt) => void;
}) {
  const labels = abschnittLabels(tour);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-maja-ink/50 px-4">
      <div className="card w-full max-w-md p-5">
        <h3 className="text-base font-semibold text-maja-navy">Welcher Streckenabschnitt?</h3>
        <p className="mt-1 text-xs text-maja-muted">
          {tour.tour_id ? <><span className="font-medium">{tour.tour_id}</span> — </> : null}
          {tourTitel(tour)} ({tour.tourenart})
        </p>
        <div className="mt-4 grid gap-2">
          <button
            type="button"
            className="rounded-lg border border-maja-navy/15 bg-white px-4 py-3 text-left text-sm hover:bg-maja-light"
            onClick={() => onChoose('ab')}
          >
            <div className="font-medium text-maja-ink">{labels.ab.short}: {labels.ab.route}</div>
            <div className="text-xs text-maja-muted">Daten fließen in Übernahme/Übergabe (1. Teil).</div>
          </button>
          <button
            type="button"
            className="rounded-lg border border-maja-navy/15 bg-white px-4 py-3 text-left text-sm hover:bg-maja-light"
            onClick={() => onChoose('bc')}
          >
            <div className="font-medium text-maja-ink">{labels.bc.short}: {labels.bc.route}</div>
            <div className="text-xs text-maja-muted">Daten fließen in die Rückführungs-Adresse.</div>
          </button>
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}

function PrefillSummary({ summary }: { summary: EingangSummary }) {
  const items: Array<{ label: string; value: string | null }> = [
    { label: 'Kennzeichen',          value: summary.kennzeichen },
    { label: 'FIN',                  value: summary.fin },
    { label: 'Fahrer',               value: summary.fahrername },
    { label: 'Kunde',                value: summary.kundenname },
    { label: 'Datum',                value: summary.datum?.slice(0, 10) ?? null },
    { label: 'Übernahme-Adresse',    value: summary.adresseUebernahme },
    { label: 'Übergabe-Adresse',     value: summary.adresseUebergabe },
    { label: 'km',                   value: summary.kmGesamt != null ? `${summary.kmGesamt} km` : null },
  ];
  const filled = items.filter((i) => !!i.value);
  if (filled.length === 0) {
    return <p className="text-xs text-maja-muted">Im Formular wurden keine Daten gefunden, die in eine Tour übernommen werden könnten.</p>;
  }
  return (
    <dl className="grid gap-2 rounded-lg bg-maja-light/40 p-3 text-xs sm:grid-cols-2">
      {filled.map((i) => (
        <div key={i.label}>
          <dt className="font-medium uppercase tracking-wide text-maja-muted">{i.label}</dt>
          <dd className="text-maja-ink">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function firstCity(addr: string | null): string {
  if (!addr) return '';
  // Heuristik: nimm den Teil hinter dem letzten Komma; bei "PLZ Stadt"
  // schneide die PLZ ab.
  const tail = addr.split(',').pop()?.trim() ?? addr;
  return tail.replace(/^\d{4,5}\s+/, '').trim();
}

function buildTourPayload(
  s: EingangSummary,
  eingangId: string,
): TourInsert {
  const start = firstCity(s.adresseUebernahme) || 'Übernahme';
  const ziel  = firstCity(s.adresseUebergabe) || 'Übergabe';
  const kennzeichen = s.kennzeichen ? [s.kennzeichen.toUpperCase()] : [];
  const kontakt = (s.kontaktName || s.kontaktTelefon || s.kontaktEmail)
    ? { name: s.kontaktName ?? '', telefon: s.kontaktTelefon ?? '', email: s.kontaktEmail ?? '' }
    : null;
  // Bei neuer Tour: alle Spalten, die durch das Protokoll Werte erhalten,
  // im protokoll_daten_felder-Array merken. Damit kann der Admin später
  // gezielt nur diese Felder zurücksetzen.
  const protokollFelder: string[] = [];
  if (s.fin) protokollFelder.push('fin');
  if (kennzeichen.length > 0) protokollFelder.push('kennzeichen');
  if (s.adresseUebernahme) protokollFelder.push('adresse_start');
  if (s.adresseUebergabe) protokollFelder.push('adresse_ziel');
  if (s.kundenname) protokollFelder.push('kundenname');
  if (s.kmGesamt != null) protokollFelder.push('km_hin', 'km_gesamt');
  if (s.datum) protokollFelder.push('startdatum', 'enddatum');
  if (kontakt) protokollFelder.push('kontakt_start', 'kontakt_ziel');

  return {
    start_stadt: start,
    ziel_stadt: ziel,
    auftraggeber_id: null,
    fin: s.fin,
    kennzeichen,
    kundenname: s.kundenname,
    km_hin: s.kmGesamt,
    km_gesamt: s.kmGesamt,
    // startdatum + enddatum sind NOT NULL — Fallback auf heute, wenn
    // das Protokoll kein Datum geliefert hat.
    startdatum: s.datum ?? new Date().toISOString().slice(0, 10),
    enddatum:   s.datum ?? new Date().toISOString().slice(0, 10),
    adresse_start: s.adresseUebernahme,
    adresse_ziel: s.adresseUebergabe,
    kontakt_start: kontakt,
    kontakt_ziel: kontakt,
    eingang_id: eingangId,
    protokoll_daten_felder: protokollFelder,
  };
}
