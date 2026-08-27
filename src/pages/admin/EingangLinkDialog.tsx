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
import {
  summarizeEingang, type AdresseTeile, type EingangSummary,
} from '../../lib/eingangData';
import { adressPatchFuerStation, composeAdresse } from '../../lib/adresse';
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

export function EingangLinkDialog({ formular, onClose, onLinked }: Props) {
  const [tab, setTab] = useState<Tab>('existing');
  const [touren, setTouren] = useState<TourRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Default-Zeitfenster: letzte 90 Tage. Wenn der Admin sucht, fällt
   *  der Datums-Filter weg und alle Touren sind erreichbar (Aufgabe 1). */
  const [includeAll, setIncludeAll] = useState(false);
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
      //
      // Egress + UX: Default zeigen wir die LETZTEN 90 TAGE (statt
      // .limit(200) ohne Datum, was bei vollen Tagen schon nach ~10
      // Tagen "abschneidet" — Aufgabe 1). Sobald der Admin sucht ODER
      // explizit "alle Touren anzeigen" wählt, fällt das Zeitfenster
      // weg und es kommen ältere Touren mit.
      const hasSearch = search.trim().length >= 2;
      const showAll = includeAll || hasSearch;
      const cutoffDate = (() => {
        const d = new Date();
        d.setDate(d.getDate() - 90);
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      })();
      setLoading(true);
      let q = supabase
        .from('touren')
        .select(`
          id, tour_id, start_stadt, ziel_stadt, rueckfuehrung_stadt,
          startdatum, enddatum, tourenart, kennzeichen, kundenname, fin,
          fin_rueck, fahrzeugmodell, fahrzeugmodell_rueck,
          adresse_start, adresse_ziel, adresse_rueckfuehrung,
          strasse_start, plz_start, strasse_ziel, plz_ziel,
          strasse_rueckfuehrung, plz_rueckfuehrung,
          kontakt_start, kontakt_ziel, kontakt_rueckfuehrung,
          protokoll_daten_felder, protokoll_daten_felder_bc,
          km_gesamt, eingang_id, eingang_id_bc, auftraggeber_id, fahrer_id,
          auftraggeber:auftraggeber_id (name),
          fahrer:fahrer_id (id, user_id, aktiv,
            user:user_id (email, vorname, nachname))
        `)
        .or('eingang_id.is.null,and(tourenart.in.(ABA,ABC),eingang_id_bc.is.null)')
        .order('startdatum', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });
      if (!showAll) {
        q = q.gte('enddatum', cutoffDate).limit(200);
      } else {
        q = q.limit(500);
      }
      const { data, error: err } = await q;
      if (cancelled) return;
      if (err) setError(err.message);
      else setTouren(((data as unknown) as TourRow[]) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [search, includeAll]);

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
    /**
     * @param track false = Spalte NICHT in protokoll_daten_felder
     *   aufnehmen. Nötig für die Stadt-Spalten: sie sind NOT NULL
     *   (Migration 012), und "Verknüpfung lösen + zurücksetzen" schreibt
     *   in jede getrackte Spalte null — das würde fehlschlagen.
     */
    function maybe(
      key: keyof TourUpdate, label: string, current: unknown, next: unknown,
      track = true,
    ) {
      const isEmpty = current == null
        || (typeof current === 'string' && current.trim() === '')
        || (Array.isArray(current) && current.length === 0);
      if (isEmpty && next != null && next !== '' && !(Array.isArray(next) && next.length === 0)) {
        (patch as Record<string, unknown>)[key as string] = next;
        filled.push(label);
        if (track) fieldKeys.push(key as string);
      }
    }
    /**
     * Kennzeichen liegt als Array auf der Tour: Index 0 = Hinfahrt,
     * Index 1 = Rückführung (so lesen es Rechnungs-Platzhalter,
     * Tour-Maske und Export). Deshalb kein `maybe` — der Slot muss
     * gezielt getroffen werden, ohne den anderen zu verschieben.
     */
    function kennzeichenUebernehmen(slot: 0 | 1, label: string) {
      const neu = summary.kennzeichen?.trim().toUpperCase();
      if (!neu) return;
      const alt = Array.isArray(tour.kennzeichen) ? [...tour.kennzeichen] : [];
      if ((alt[slot] ?? '').trim()) return;   // schon gefüllt — nicht überschreiben
      // Fehlt die Hinfahrt noch, bleibt an Index 0 ein leerer
      // Platzhalter stehen. Sonst rutschte das Rück-Kennzeichen auf
      // Index 0 und würde überall als Hin-Kennzeichen gelesen.
      while (alt.length < slot) alt.push('');
      alt[slot] = neu;
      (patch as Record<string, unknown>).kennzeichen = alt;
      filled.push(label);
      fieldKeys.push('kennzeichen');
    }

    // Kundenname gilt für die ganze Tour, unabhängig vom Abschnitt.
    maybe('kundenname', 'Kundenname', tour.kundenname, summary.kundenname);

    // Fahrzeugdaten dagegen gehören zum jeweiligen Abschnitt: Bei
    // ABA/ABC ist das Rückfahrzeug ein anderes als das Hinfahrzeug.
    // Vorher landeten sie immer in den Hin-Spalten — dort waren sie
    // durch das erste Protokoll längst gefüllt, weshalb die Übernahme
    // beim Rück-Teil wirkungslos blieb.
    if (abschnitt === 'bc') {
      maybe('fin_rueck', 'FIN Rück', tour.fin_rueck, summary.fin);
      kennzeichenUebernehmen(1, 'Kennzeichen Rück');
      maybe('fahrzeugmodell_rueck', 'Fahrzeugmodell Rück',
            tour.fahrzeugmodell_rueck, summary.fahrzeugmodell);
    } else {
      maybe('fin', 'FIN', tour.fin, summary.fin);
      kennzeichenUebernehmen(0, 'Kennzeichen');
      maybe('fahrzeugmodell', 'Fahrzeugmodell',
            tour.fahrzeugmodell, summary.fahrzeugmodell);
    }

    // Kilometer werden bewusst NICHT übernommen — weder km_hin noch
    // km_rueck. Sie gehen über km_gesamt in die Preisstufe ein; eine
    // stille Übernahme könnte den Preis einer bestehenden Tour ändern.
    // Das bleibt eine bewusste Eingabe des Admins.

    const kontaktPayload = (summary.kontaktName || summary.kontaktTelefon || summary.kontaktEmail) ? {
      name: summary.kontaktName ?? '',
      telefon: summary.kontaktTelefon ?? '',
      email: summary.kontaktEmail ?? '',
    } : null;

    /**
     * Adresse einer Station übernehmen. Die eigentliche Regel steckt in
     * adressPatchFuerStation() (lib/adresse.ts) — dort auch getestet.
     *
     * Vor diesem Fix wurde ausschließlich das Freitextfeld `adresse_*`
     * beschrieben. Seit Migration 086/087 ist die Tour-Maske aber an die
     * strukturierten Spalten gebunden; die Adressfelder blieben nach
     * einer Verknüpfung deshalb leer.
     */
    function adresseUebernehmen(
      station: 'start' | 'ziel' | 'rueckfuehrung',
      label: string,
      teile: AdresseTeile,
    ) {
      const stadtSpalte = station === 'rueckfuehrung'
        ? 'rueckfuehrung_stadt' : `${station}_stadt`;
      const r = adressPatchFuerStation({
        station,
        neu: teile,
        alt: {
          strasse: (tour[`strasse_${station}` as keyof TourRow] as string | null) ?? null,
          plz: (tour[`plz_${station}` as keyof TourRow] as string | null) ?? null,
          stadt: (tour[stadtSpalte as keyof TourRow] as string | null) ?? null,
          adresse: (tour[`adresse_${station}` as keyof TourRow] as string | null) ?? null,
        },
      });
      Object.assign(patch as Record<string, unknown>, r.patch);
      for (const l of r.labels) filled.push(`${l} ${label}`);
      fieldKeys.push(...r.trackKeys);
    }

    if (abschnitt === 'bc') {
      // Rück/Teil 2: Übernahme = Übergabe-Adresse des AB-Teils (bleibt
      // wie sie ist), Übergabe-Adresse dieses Abschnitts = Rückführung.
      adresseUebernehmen('rueckfuehrung', 'Rückführung', summary.adresseUebergabeTeile);
      if (kontaktPayload) {
        maybe('kontakt_rueckfuehrung', 'Kontakt Rückführung', tour.kontakt_rueckfuehrung, kontaktPayload);
      }
    } else {
      adresseUebernehmen('start', 'Übernahme', summary.adresseUebernahmeTeile);
      adresseUebernehmen('ziel', 'Übergabe', summary.adresseUebergabeTeile);
      if (kontaktPayload) {
        maybe('kontakt_start', 'Kontakt Übernahme', tour.kontakt_start, kontaktPayload);
        maybe('kontakt_ziel',  'Kontakt Übergabe',  tour.kontakt_ziel,  kontaktPayload);
      }
    }

    // Diagnose: was kam aus dem Protokoll, was steht vorher/nachher auf
    // der Tour? Bleibt bewusst drin — die Feld-IDs der Templates sind
    // uneinheitlich, und ohne diese Zeilen ist eine fehlgeschlagene
    // Übernahme von außen nicht nachvollziehbar.
    console.log('[Verknüpfung] Quelle (Protokoll):', {
      uebernahme: summary.adresseUebernahmeTeile,
      uebergabe: summary.adresseUebergabeTeile,
      zusammengesetzt: {
        uebernahme: summary.adresseUebernahme,
        uebergabe: summary.adresseUebergabe,
      },
    });
    console.log('[Verknüpfung] Ziel (Tour) vorher/nachher:', {
      vorher: {
        strasse_start: tour.strasse_start, plz_start: tour.plz_start,
        start_stadt: tour.start_stadt, adresse_start: tour.adresse_start,
        strasse_ziel: tour.strasse_ziel, plz_ziel: tour.plz_ziel,
        ziel_stadt: tour.ziel_stadt, adresse_ziel: tour.adresse_ziel,
        strasse_rueckfuehrung: tour.strasse_rueckfuehrung,
        plz_rueckfuehrung: tour.plz_rueckfuehrung,
        rueckfuehrung_stadt: tour.rueckfuehrung_stadt,
        adresse_rueckfuehrung: tour.adresse_rueckfuehrung,
      },
      nachher: patch,
    });

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
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-maja-muted">
              <span>
                {search.trim().length >= 2
                  ? 'Suche über alle Touren — kein Datums-Filter.'
                  : includeAll
                    ? 'Alle offenen Touren werden geladen.'
                    : 'Zeige Touren der letzten 90 Tage. Suche zeigt auch ältere.'}
              </span>
              {search.trim().length < 2 && (
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-maja-navy/30 text-maja-navy"
                    checked={includeAll}
                    onChange={(e) => setIncludeAll(e.target.checked)}
                  />
                  Auch ältere Touren anzeigen
                </label>
              )}
            </div>
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
    { label: 'Fahrzeugmodell',       value: summary.fahrzeugmodell },
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
  // Stadt bevorzugt aus dem eigenen Stadt-Feld des Protokolls. Nur wenn
  // das Template die Adresse als Freitext liefert, greift die alte
  // Heuristik auf der zusammengesetzten Zeile.
  const start = s.adresseUebernahmeTeile.stadt
    || firstCity(s.adresseUebernahme) || 'Übernahme';
  const ziel = s.adresseUebergabeTeile.stadt
    || firstCity(s.adresseUebergabe) || 'Übergabe';
  const kennzeichen = s.kennzeichen ? [s.kennzeichen.toUpperCase()] : [];
  const kontakt = (s.kontaktName || s.kontaktTelefon || s.kontaktEmail)
    ? { name: s.kontaktName ?? '', telefon: s.kontaktTelefon ?? '', email: s.kontaktEmail ?? '' }
    : null;
  // Bei neuer Tour: alle Spalten, die durch das Protokoll Werte erhalten,
  // im protokoll_daten_felder-Array merken. Damit kann der Admin später
  // gezielt nur diese Felder zurücksetzen.
  const protokollFelder: string[] = [];
  if (s.fin) protokollFelder.push('fin');
  if (s.fahrzeugmodell) protokollFelder.push('fahrzeugmodell');
  if (kennzeichen.length > 0) protokollFelder.push('kennzeichen');
  // Alle Adress-Spalten merken, die aus dem Protokoll kommen — beim
  // "Verknüpfung lösen" werden genau diese wieder geleert.
  if (s.adresseUebernahmeTeile.strasse) protokollFelder.push('strasse_start');
  if (s.adresseUebernahmeTeile.plz) protokollFelder.push('plz_start');
  if (s.adresseUebernahme) protokollFelder.push('adresse_start');
  if (s.adresseUebergabeTeile.strasse) protokollFelder.push('strasse_ziel');
  if (s.adresseUebergabeTeile.plz) protokollFelder.push('plz_ziel');
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
    fahrzeugmodell: s.fahrzeugmodell,
    kennzeichen,
    kundenname: s.kundenname,
    km_hin: s.kmGesamt,
    km_gesamt: s.kmGesamt,
    // startdatum + enddatum sind NOT NULL — Fallback auf heute, wenn
    // das Protokoll kein Datum geliefert hat.
    startdatum: s.datum ?? new Date().toISOString().slice(0, 10),
    enddatum:   s.datum ?? new Date().toISOString().slice(0, 10),
    // Strukturierte Adressfelder (086/087) — daran hängt die Anzeige in
    // der Tour-Maske. Das Freitextfeld wird zusätzlich mitgeführt.
    strasse_start: s.adresseUebernahmeTeile.strasse,
    plz_start: s.adresseUebernahmeTeile.plz,
    strasse_ziel: s.adresseUebergabeTeile.strasse,
    plz_ziel: s.adresseUebergabeTeile.plz,
    adresse_start: composeAdresse({ ...s.adresseUebernahmeTeile, stadt: start }),
    adresse_ziel: composeAdresse({ ...s.adresseUebergabeTeile, stadt: ziel }),
    kontakt_start: kontakt,
    kontakt_ziel: kontakt,
    eingang_id: eingangId,
    protokoll_daten_felder: protokollFelder,
  };
}
