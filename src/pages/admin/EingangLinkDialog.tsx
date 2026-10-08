import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { ART_BADGE, DIALOG_HINTERGRUND, ERGEBNIS_ZEILE, TOUR_ID_CHIP, HINWEIS_BADGE, UNTERDIALOG_HINTERGRUND, WAHL_KNOPF } from '../../components/tourAuswahlStil';
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
import {
  abgleichAnwenden, fahrzeugAbgleich, type AbgleichZeile, type FahrzeugFeld,
} from '../../lib/fahrzeugAbgleich';
import {
  berechneTourPreis, kmUebernahmeMeldung, preisEntscheidung, rechnungsHinweis,
} from '../../lib/tourPreis';
import { protokolliereVerknuepfung } from '../../lib/tourAenderungen';

interface RouteQueueItem {
  tourId: string;
  origin: string;
  destination: string;
  field: 'km_hin' | 'km_rueck';
  title: string;
  /** Steht die Tour schon auf einer Rechnung? Dann bleibt der Preis. */
  rechnungsnummer: string | null;
}

/** Offener Abgleich der Fahrzeugdaten vor dem Verknüpfen. */
interface Abgleich {
  tour: TourRow;
  abschnitt: ProtokollAbschnitt;
  zeilen: AbgleichZeile[];
  rechnungsnummer: string | null;
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
   * Aufrufer kann daraus eine Toast-Meldung bauen. `hinweise` sind
   * zusätzliche Meldungen (km/Preis, Rechnung, Protokoll-Fehler).
   */
  onLinked: (filledFields: string[], hinweise: string[]) => void;
}

type Tab = 'existing' | 'new';

export function EingangLinkDialog({ formular, onClose, onLinked }: Props) {
  const [tab, setTab] = useState<Tab>('existing');
  const [touren, setTouren] = useState<TourRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [serverGesucht, setServerGesucht] = useState(false);
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
  /** Meldungen aus Verknüpfung und km-Übernahme — gehen mit onLinked raus. */
  const hinweiseRef = useRef<string[]>([]);
  /** Abweichende Fahrzeugdaten, über die der Admin vor dem Verknüpfen entscheidet. */
  const [abgleich, setAbgleich] = useState<Abgleich | null>(null);

  const summary = useMemo(() => summarizeEingang(formular), [formular]);

  useEffect(() => {
    // Finalisiert die Post-Link-Routenphase: sobald die Queue leer ist
    // und wir eine ausstehende Verknüpfung haben, geben wir die ge-
    // füllten Felder an den Aufrufer (Toast + Reload).
    if (routeQueue.length === 0 && pendingFilledRef.current !== null) {
      const filled = pendingFilledRef.current;
      pendingFilledRef.current = null;
      onLinked(filled, hinweiseRef.current);
    }
  }, [routeQueue, onLinked]);

  useEffect(() => {
    let cancelled = false;
    // Beim Tippen kurz warten — sonst eine Datenbank-Suche pro Tastendruck.
    const timer = window.setTimeout(() => void (async () => {
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
      // Mit Suchbegriff: Treffer kommen aus der Datenbank-Suche über ALLE
      // Touren (Migration 103) — vorher wurde nur in den jüngsten 500
      // gesucht, ältere Touren waren nicht verknüpfbar.
      let trefferIds: string[] | null = null;
      if (hasSearch) {
        const { data: t, error: sErr } = await supabase.rpc('touren_suche', {
          p_suche: search.trim(), p_fahrer_ids: null, p_limit: 200, p_offset: 0,
        });
        if (!sErr) trefferIds = ((t ?? []) as Array<{ id: string }>).map((x) => x.id);
        else console.warn('[EingangLinkDialog] Datenbank-Suche nicht verfügbar — Rückfall', sErr.message);
      }
      if (cancelled) return;
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
      if (trefferIds) {
        q = q.in('id', trefferIds.length ? trefferIds : ['00000000-0000-0000-0000-000000000000']);
      } else if (!showAll) {
        q = q.gte('enddatum', cutoffDate).limit(200);
      } else {
        q = q.limit(500);
      }
      const { data, error: err } = await q;
      if (cancelled) return;
      if (err) setError(err.message);
      else setTouren(((data as unknown) as TourRow[]) ?? []);
      setServerGesucht(trefferIds !== null);
      setLoading(false);
    })(), search.trim().length >= 2 ? 300 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [search, includeAll]);

  const filteredTouren = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Hat die Datenbank gesucht, nicht noch einmal im Browser filtern —
    // sie findet auch „HHAB1234" für „HH-AB 1234".
    if (!q || serverGesucht) return touren;
    return touren.filter((t) => {
      const fahrerName = displayName(t.fahrer?.user ?? null).toLowerCase();
      return [
        t.tour_id ?? '',
        t.start_stadt, t.ziel_stadt, t.rueckfuehrung_stadt ?? '',
        ...(Array.isArray(t.kennzeichen) ? t.kennzeichen : []),
        fahrerName,
      ].join(' ').toLowerCase().includes(q);
    });
  }, [touren, search, serverGesucht]);

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
  async function linkExisting(
    tour: TourRow,
    abschnitt: ProtokollAbschnitt,
    auswahl: { zeilen: AbgleichZeile[]; gewaehlt: ReadonlySet<FahrzeugFeld>; rechnungsnummer: string | null },
  ) {
    setLinking(true);
    setError(null);
    hinweiseRef.current = [];
    // Bei einer bestehenden Tour: Adressen, Kontakte und Kundenname nur in
    // leere Felder nachfüllen. Ausnahme Fahrzeugdaten — siehe Abgleich unten.
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
    // Kundenname gilt für die ganze Tour, unabhängig vom Abschnitt.
    maybe('kundenname', 'Kundenname', tour.kundenname, summary.kundenname);

    // Fahrzeugdaten (Kennzeichen, FIN, Modell) gehören zum jeweiligen
    // Abschnitt — bei ABA/ABC ist das Rückfahrzeug ein anderes. Was
    // übernommen wird, hat der Admin im Abgleich entschieden (abweichende
    // UND leere Tour-Felder, Default: übernehmen). Ein schon vorhandener
    // Tour-Wert wird dabei bewusst überschrieben; der Altwert landet im
    // Änderungsprotokoll. Regeln: lib/fahrzeugAbgleich.ts.
    const fahrzeug = abgleichAnwenden(auswahl.zeilen, auswahl.gewaehlt, abschnitt, tour.kennzeichen);
    Object.assign(patch as Record<string, unknown>, fahrzeug.patch);
    filled.push(...fahrzeug.labels);
    fieldKeys.push(...fahrzeug.trackKeys);

    // Kilometer kommen NICHT aus dem Protokoll, sondern aus der
    // Routenberechnung im Anschluss (RouteSelectorDialog). Dort wird
    // danach auch der Preis neu berechnet — siehe kmUebernehmen().

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
    if (fahrzeug.protokoll.length > 0) {
      try {
        await protokolliereVerknuepfung(tour.id, fahrzeug.protokoll);
      } catch (e) {
        hinweiseRef.current.push(`Änderungsprotokoll konnte nicht geschrieben werden: ${(e as Error).message}`);
      }
      // Überschrieben wurde nur etwas, das vorher schon auf der Tour stand.
      if (auswahl.rechnungsnummer && fahrzeug.protokoll.some((e) => e.alt)) {
        hinweiseRef.current.push(rechnungsHinweis(
          auswahl.rechnungsnummer,
          fahrzeug.protokoll.some((e) => e.feld.startsWith('kennzeichen')) ? 'Kennzeichen' : 'Fahrzeugdaten',
        ));
      }
    }
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
          rechnungsnummer: auswahl.rechnungsnummer,
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
          rechnungsnummer: auswahl.rechnungsnummer,
        });
      }
    }
    if (queue.length === 0) {
      onLinked(filled, hinweiseRef.current);
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
      void vorbereiten(tour, 'ab');
      return;
    }
    const abFree = !tour.eingang_id;
    const bcFree = !tour.eingang_id_bc;
    if (abFree && !bcFree) { void vorbereiten(tour, 'ab'); return; }
    if (!abFree && bcFree) { void vorbereiten(tour, 'bc'); return; }
    // Beide Slots noch frei → Dialog.
    setAbschnittPick(tour);
  }

  /**
   * Vor dem Verknüpfen: Rechnung der Tour nachsehen und Fahrzeugdaten
   * abgleichen. Weichen sie ab (oder ist das Tour-Feld leer), entscheidet
   * der Admin im Abgleich-Dialog; sonst wird direkt verknüpft.
   */
  async function vorbereiten(tour: TourRow, abschnitt: ProtokollAbschnitt) {
    setLinking(true);
    setError(null);
    const { data: rp, error: rErr } = await supabase
      .from('rechnungspositionen')
      .select('rechnung:rechnung_id (rechnungsnummer)')
      .eq('tour_id', tour.id)
      .limit(1);
    setLinking(false);
    if (rErr) console.warn('[EingangLinkDialog] Rechnungs-Abfrage fehlgeschlagen', rErr.message);
    const rechnung = ((rp ?? [])[0] as { rechnung: { rechnungsnummer: string | null } | null } | undefined)?.rechnung;
    const rechnungsnummer = rechnung ? (rechnung.rechnungsnummer || 'ohne Nummer (Entwurf)') : null;
    const zeilen = fahrzeugAbgleich({
      abschnitt,
      tour,
      protokoll: { kennzeichen: summary.kennzeichen, fin: summary.fin, fahrzeugmodell: summary.fahrzeugmodell },
    });
    if (zeilen.length === 0) {
      void linkExisting(tour, abschnitt, { zeilen, gewaehlt: new Set(), rechnungsnummer });
      return;
    }
    setAbgleich({ tour, abschnitt, zeilen, rechnungsnummer });
  }

  /**
   * km aus der Routenberechnung auf die Tour schreiben — und danach den
   * Preis mit denselben Regeln wie beim Speichern der Tour neu berechnen
   * (lib/tourPreis.ts). Ausnahmen: Sondervereinbarung und Touren, die
   * schon auf einer Rechnung stehen — dort bleibt der Preis.
   */
  async function kmUebernehmen(item: RouteQueueItem, km: number) {
    const { data: t, error: lErr } = await supabase
      .from('touren')
      .select('km_hin, km_rueck, km_gesamt, rueckfuehrung_stadt, tourenart, aba_gesamt_km_berechnen, ist_e_fahrzeug, ist_sondervereinbarung, auftraggeber_id, verguetung')
      .eq('id', item.tourId)
      .single();
    if (lErr || !t) {
      hinweiseRef.current.push(`km konnten nicht übernommen werden: ${lErr?.message ?? 'Tour nicht gefunden'}`);
      return;
    }
    const kmHin = item.field === 'km_hin' ? km : t.km_hin;
    const kmRueck = item.field === 'km_rueck' ? km : t.km_rueck;
    const entscheidung = preisEntscheidung({
      istSondervereinbarung: t.ist_sondervereinbarung,
      rechnungsnummer: item.rechnungsnummer,
    });
    const { kmGesamt, breakdown } = await berechneTourPreis({
      auftraggeberId: t.auftraggeber_id,
      tourenart: t.tourenart,
      kmHin,
      kmRueck,
      hatRueckfuehrung: !!t.rueckfuehrung_stadt,
      abaGesamtKmBerechnen: t.aba_gesamt_km_berechnen,
      istEFahrzeug: t.ist_e_fahrzeug,
    });
    const updatePatch: TourUpdate = { [item.field]: km, km_gesamt: kmGesamt };
    const neuerPreis = entscheidung.art === 'berechnen' ? (breakdown?.total ?? null) : null;
    if (neuerPreis != null) updatePatch.verguetung = neuerPreis;
    const { error: updErr } = await supabase
      .from('touren')
      .update(updatePatch)
      .eq('id', item.tourId);
    if (updErr) {
      console.warn('[EingangLinkDialog] km-Update fehlgeschlagen', updErr);
      hinweiseRef.current.push(`km konnten nicht gespeichert werden: ${updErr.message}`);
      return;
    }
    const alt = item.field === 'km_hin' ? t.km_hin : t.km_rueck;
    const eintraege: Array<{ feld: string; alt: string | null; neu: string | null }> = [];
    if (alt !== km) eintraege.push({ feld: item.field, alt: alt == null ? null : String(alt), neu: String(km) });
    if (neuerPreis != null && Number(t.verguetung ?? NaN) !== neuerPreis) {
      eintraege.push({ feld: 'verguetung', alt: t.verguetung == null ? null : String(t.verguetung), neu: String(neuerPreis) });
    }
    try {
      await protokolliereVerknuepfung(item.tourId, eintraege);
    } catch (e) {
      hinweiseRef.current.push(`Änderungsprotokoll konnte nicht geschrieben werden: ${(e as Error).message}`);
    }
    hinweiseRef.current.push(t.auftraggeber_id || entscheidung.art !== 'berechnen'
      ? kmUebernahmeMeldung({ km, entscheidung, preis: neuerPreis })
      : `km ${km.toLocaleString('de-DE')} übernommen — kein Auftraggeber an der Tour, Preis nicht berechnet.`);
  }

  async function createAndLink() {
    setLinking(true);
    setError(null);
    hinweiseRef.current = [];
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
        rechnungsnummer: null,
      });
    }
    if (queue.length === 0) {
      onLinked(filled, hinweiseRef.current);
    } else {
      pendingFilledRef.current = filled;
      setRouteQueue(queue);
    }
  }

  return (
    <div className={DIALOG_HINTERGRUND}>
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
                        className={ERGEBNIS_ZEILE}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {t.tour_id && (
                              <span className={TOUR_ID_CHIP}>
                                {t.tour_id}
                              </span>
                            )}
                            <span className="font-medium text-maja-ink">{tourTitel(t)}</span>
                            {t.tourenart && (
                              <span className={ART_BADGE}>
                                {t.tourenart}
                              </span>
                            )}
                            {slotBadge && (
                              <span className={HINWEIS_BADGE}>
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
            void vorbereiten(t, abschnitt);
          }}
        />
      )}

      {abgleich && (
        <FahrzeugAbgleichDialog
          abgleich={abgleich}
          onCancel={() => setAbgleich(null)}
          onConfirm={(gewaehlt) => {
            const a = abgleich;
            setAbgleich(null);
            void linkExisting(a.tour, a.abschnitt, {
              zeilen: a.zeilen, gewaehlt, rechnungsnummer: a.rechnungsnummer,
            });
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
              await kmUebernehmen(item, km);
              advance();
            }}
          />
        );
      })()}
    </div>
  );
}

/**
 * Protokoll und Tour weichen bei Kennzeichen/FIN/Modell ab (oder das
 * Tour-Feld ist leer): beide Werte nebeneinander, je Feld ein Haken
 * „übernehmen" — Default an.
 */
function FahrzeugAbgleichDialog({
  abgleich, onCancel, onConfirm,
}: {
  abgleich: Abgleich;
  onCancel: () => void;
  onConfirm: (gewaehlt: ReadonlySet<FahrzeugFeld>) => void;
}) {
  const { tour, abschnitt, zeilen, rechnungsnummer } = abgleich;
  const [gewaehlt, setGewaehlt] = useState<Set<FahrzeugFeld>>(() => new Set(zeilen.map((z) => z.feld)));
  const umschalten = (f: FahrzeugFeld) => setGewaehlt((alt) => {
    const neu = new Set(alt);
    if (neu.has(f)) neu.delete(f); else neu.add(f);
    return neu;
  });
  const ueberschreibtEtwas = zeilen.some((z) => z.tourWert && gewaehlt.has(z.feld));
  const zweiSlots = hasTwoProtokollSlots(tour.tourenart);
  return (
    <div className={UNTERDIALOG_HINTERGRUND}>
      <div role="dialog" aria-modal="true" aria-labelledby="abgleich-titel" className="card w-full max-w-xl p-5">
        <h3 id="abgleich-titel" className="text-base font-semibold text-maja-navy">Fahrzeugdaten abgleichen</h3>
        <p className="mt-1 text-xs text-maja-muted">
          {tour.tour_id ? <><span className="font-medium">{tour.tour_id}</span> — </> : null}
          {tourTitel(tour)}
          {zweiSlots ? ` · ${abschnittLabels(tour)[abschnitt].short}-Abschnitt` : ''}
        </p>
        <p className="mt-3 text-sm text-maja-ink">
          Das Protokoll weicht von der Tour ab. Angehakte Werte werden aus dem Protokoll übernommen.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-maja-navy/10 text-left text-[11px] uppercase tracking-wider text-maja-muted dark:!border-slate-600">
                <th className="py-1.5 pr-2 font-semibold">Feld</th>
                <th className="py-1.5 pr-2 font-semibold">Tour</th>
                <th className="py-1.5 pr-2 font-semibold">Protokoll</th>
                <th className="py-1.5 text-center font-semibold">Übernehmen</th>
              </tr>
            </thead>
            <tbody>
              {zeilen.map((z) => {
                const an = gewaehlt.has(z.feld);
                const id = `abgleich-${z.feld}`;
                return (
                  <tr key={z.feld} className="border-b border-maja-navy/5 align-top last:border-0 dark:!border-slate-700">
                    <td className="py-2 pr-2 font-medium text-maja-ink">
                      <label htmlFor={id}>{z.label}</label>
                    </td>
                    <td className="py-2 pr-2 font-mono text-xs">
                      {z.tourWert
                        ? <span className={an ? 'text-red-700 line-through dark:!text-red-300' : 'text-maja-ink'}>{z.tourWert}</span>
                        : <span className="italic text-maja-muted">leer</span>}
                    </td>
                    <td className="py-2 pr-2 font-mono text-xs">
                      <span className={an ? 'font-semibold text-emerald-700 dark:!text-emerald-300' : 'text-maja-muted'}>
                        {z.protokollWert}
                      </span>
                    </td>
                    <td className="py-2 text-center">
                      <input
                        id={id}
                        type="checkbox"
                        className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                        checked={an}
                        onChange={() => umschalten(z.feld)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rechnungsnummer && ueberschreibtEtwas && (
          <div role="note" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:!border-amber-700 dark:!bg-amber-950/60 dark:!text-amber-100">
            {rechnungsHinweis(rechnungsnummer, zeilen.some((z) => z.feld === 'kennzeichen' && gewaehlt.has('kennzeichen') && z.tourWert) ? 'Kennzeichen' : 'Fahrzeugdaten')}
          </div>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel}>Zurück</button>
          <button type="button" className="btn-primary" onClick={() => onConfirm(gewaehlt)}>
            {gewaehlt.size > 0 ? 'Übernehmen + verknüpfen' : 'Nur verknüpfen'}
          </button>
        </div>
      </div>
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
    <div className={UNTERDIALOG_HINTERGRUND}>
      <div className="card w-full max-w-md p-5">
        <h3 className="text-base font-semibold text-maja-navy">Welcher Streckenabschnitt?</h3>
        <p className="mt-1 text-xs text-maja-muted">
          {tour.tour_id ? <><span className="font-medium">{tour.tour_id}</span> — </> : null}
          {tourTitel(tour)} ({tour.tourenart})
        </p>
        <div className="mt-4 grid gap-2">
          <button
            type="button"
            className={WAHL_KNOPF}
            onClick={() => onChoose('ab')}
          >
            <div className="font-medium text-maja-ink">{labels.ab.short}: {labels.ab.route}</div>
            <div className="text-xs text-maja-muted">Daten fließen in Übernahme/Übergabe (1. Teil).</div>
          </button>
          <button
            type="button"
            className={WAHL_KNOPF}
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
