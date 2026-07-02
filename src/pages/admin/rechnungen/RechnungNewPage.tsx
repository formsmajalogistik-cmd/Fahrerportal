import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { Spinner } from '../../../components/Spinner';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { formatDate } from '../../../lib/touren';
import {
  DEFAULT_RECHNUNGSFORMAT, auslagenRechnungsdatum, berechneSummenProUst,
  buildAnrede,
  generatePositionenFromTouren, letzterWerktagVor, isoDate,
  type Rechnungsformat, type TourForRechnung, type TourenartReal,
} from '../../../lib/rechnungsformat';
import { PositionsTable } from './PositionsTable';
import { AddTourPositionDialog } from './AddTourPositionDialog';
import { SummenBlock } from './SummenBlock';
import {
  emptyManuellePosition, newKey, type EditorPosition,
} from './positionUtils';
import type { Auftraggeber, AuftraggeberKontakt, Rechnungsadresse } from '../../../types/db';
import type { Database } from '../../../types/supabase';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseRechnungsformat(raw: unknown): Rechnungsformat {
  if (raw && typeof raw === 'object') {
    return { ...DEFAULT_RECHNUNGSFORMAT, ...(raw as Partial<Rechnungsformat>) };
  }
  return DEFAULT_RECHNUNGSFORMAT;
}

interface AuftraggeberFull extends Auftraggeber {
  rechnungsadressen?: Rechnungsadresse[];
}

/**
 * Snapshot der Rechnungsadresse + Kopfdaten. Diese Werte werden als
 * eigenständige Spalten auf der Rechnung gespeichert, NICHT als FK zu
 * den Auftraggeber-Stammdaten — damit eine einmal ausgestellte
 * Rechnung ein festes Dokument bleibt.
 */
interface AdressSnapshot {
  firma: string;
  ansprechpartner: string;
  strasse: string;
  plz_ort: string;
  land: string;
}

function emptySnapshot(): AdressSnapshot {
  return { firma: '', ansprechpartner: '', strasse: '', plz_ort: '', land: '' };
}

function snapshotFromAuftraggeber(a: Auftraggeber): AdressSnapshot {
  const plzOrt = [a.plz, a.ort].filter((x) => !!x && (x as string).trim() !== '').join(' ');
  return {
    firma: a.name ?? '',
    ansprechpartner: '',
    strasse: a.strasse ?? '',
    plz_ort: plzOrt,
    land: '',
  };
}

function snapshotFromRechnungsadresse(r: Rechnungsadresse): AdressSnapshot {
  return {
    firma: r.firma ?? '',
    ansprechpartner: r.ansprechpartner ?? '',
    strasse: r.strasse ?? '',
    plz_ort: r.plz_ort ?? '',
    land: r.land ?? '',
  };
}

export function RechnungNewPage() {
  const navigate = useNavigate();
  const [auftraggeberList, setAuftraggeberList] = useState<AuftraggeberFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<null | 'entwurf' | 'offen'>(null);

  // Kopfdaten
  const [auftraggeberId, setAuftraggeberId] = useState<string>('');
  /**
   * Optionaler Filter auf einen einzelnen Rechnungsempfänger
   * (auftraggeber_kontakte.id). Leer = "Alle" (Verhalten wie bisher).
   * Wird zusammen mit dem Auftraggeber-Wechsel zurückgesetzt.
   */
  const [rechnungsempfaengerId, setRechnungsempfaengerId] = useState<string>('');
  /**
   * Liste der Rechnungsempfänger, die bei Touren dieses Auftraggebers
   * tatsächlich vorkommen — nur die landen im Dropdown. Wird neu
   * geladen, wenn der Auftraggeber wechselt.
   */
  const [empfaengerOptions, setEmpfaengerOptions] = useState<AuftraggeberKontakt[]>([]);
  const [rechnungsdatum, setRechnungsdatum] = useState<string>(todayIso());
  /** Vorbelegte (per RPC ermittelte) nächste freie Rechnungsnummer.
   *  Der Admin kann sie überschreiben, z.B. wenn er aus einem
   *  externen System eine andere Nummer fortführen will. Leer
   *  lassen = Trigger vergibt automatisch beim INSERT. */
  const [rechnungsnummer, setRechnungsnummer] = useState<string>('');
  const [nummerHint, setNummerHint] = useState<string | null>(null);
  const [anrede, setAnrede] = useState<string>('');
  const [ustSatz, setUstSatz] = useState<number>(19);
  const [notizen, setNotizen] = useState<string>('');

  // Snapshot-Felder (Adresse + Kunden- / Sachbearbeiter-Stammdaten).
  // Werden initial aus dem Auftraggeber befüllt, bleiben aber pro
  // Rechnung frei editierbar.
  const [snapshot, setSnapshot] = useState<AdressSnapshot>(emptySnapshot());
  const [kundennummer, setKundennummer] = useState<string>('');
  const [sachbearbeiter, setSachbearbeiter] = useState<string>('');

  // Bei getrennten Auslagen-Rechnungen kann der Admin steuern, welche Teile
  // angelegt werden sollen.
  const [erstelleTouren, setErstelleTouren] = useState(true);
  const [erstelleAuslagen, setErstelleAuslagen] = useState(true);

  /**
   * "Schnell-Modus" für CC-Auslagenrechnung: nur Auslagen-Positionen
   * werden geladen und gespeichert (kein Touren-Teil). Wird durch
   * den Button "Auslagenrechnung zum Vortag erstellen" aktiviert.
   */
  const [auslagenOnly, setAuslagenOnly] = useState(false);
  const [schnellInfo, setSchnellInfo] = useState<string | null>(null);
  const [loadingSchnell, setLoadingSchnell] = useState(false);

  // Generierte Positionen (zwei Töpfe — für getrennte Rechnungen).
  const [haupt, setHaupt] = useState<EditorPosition[]>([]);
  const [auslagen, setAuslagen] = useState<EditorPosition[]>([]);
  const [touren, setTouren] = useState<TourForRechnung[]>([]);
  const [loadingTouren, setLoadingTouren] = useState(false);
  /** Tour-Picker offen für "haupt" | "auslagen" — null = zu. */
  const [tourPicker, setTourPicker] = useState<null | 'haupt' | 'auslagen'>(null);
  /** Bestätigungs-Dialog für "Touren erneut laden" (Aufgabe 5). */
  const [reloadConfirm, setReloadConfirm] = useState(false);
  const [keepManual, setKeepManual] = useState(true);
  /** Tour-Infos der via Dialog hinzugefügten Touren — landen on-the-fly
   *  in der Map, ohne den gesamten Touren-State zu mutieren. */
  const [addedTourInfos, setAddedTourInfos] = useState<Map<string, string>>(new Map());
  /** tour_id → info-Freitext. Wird aus den geladenen Touren UND den
   *  manuell hinzugefügten Touren gespeist und nur im Editor angezeigt. */
  const tourInfoById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of touren) {
      if (t.info && t.info.trim()) m.set(t.id, t.info.trim());
    }
    for (const [id, info] of addedTourInfos) {
      if (info && info.trim()) m.set(id, info.trim());
    }
    return m;
  }, [touren, addedTourInfos]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error: err } = await supabase
        .from('auftraggeber')
        .select(`
          *,
          rechnungsadressen (id, firma, ansprechpartner, strasse, plz_ort, land, ist_standard, auftraggeber_id, created_at)
        `)
        .order('name');
      if (cancelled) return;
      if (err) setError(err.message);
      else setAuftraggeberList((data as unknown as AuftraggeberFull[]) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  /**
   * Vorschau: nächste freie Rechnungsnummer für das Jahr des aktuellen
   * Rechnungsdatums per RPC abrufen. Der Wert dient nur als Vorschlag —
   * der Admin kann ihn überschreiben. Wenn die Vorschau scheitert (z.B.
   * Migration 042 noch nicht eingespielt), bleibt das Feld leer und der
   * Trigger vergibt die Nummer beim INSERT.
   */
  useEffect(() => {
    let cancelled = false;
    const year = Number(rechnungsdatum.slice(0, 4));
    if (!Number.isFinite(year) || year < 2000) return;
    void (async () => {
      const { data, error: err } = await supabase
        .rpc('next_rechnungsnummer', { p_year: year });
      if (cancelled) return;
      if (err) {
        console.warn('[Rechnungen] next_rechnungsnummer fehlgeschlagen', err);
        return;
      }
      if (typeof data === 'string' && !rechnungsnummer) {
        setRechnungsnummer(data);
        setNummerHint('Vorgeschlagen — überschreibbar, falls eine andere fortlaufende Nummer gewünscht ist.');
      }
    })();
    return () => { cancelled = true; };
    // rechnungsnummer absichtlich nicht in deps — wir füllen sie nur,
    // wenn der Admin noch nichts eingegeben hat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rechnungsdatum]);

  const auftraggeber = useMemo(
    () => auftraggeberList.find((a) => a.id === auftraggeberId) ?? null,
    [auftraggeberList, auftraggeberId],
  );

  const format = useMemo(
    () => parseRechnungsformat(auftraggeber?.rechnungsformat ?? null),
    [auftraggeber],
  );
  const getrennt = format.getrennte_auslagen_rechnung;

  // Bei Auftraggeber-Wechsel: Adress-Snapshot, Anrede, USt, Kundennummer,
  // Sachbearbeiter aus den Stammdaten ziehen. Wenn der Auftraggeber eine
  // hinterlegte Standard-Rechnungsadresse hat, hat die Vorrang.
  useEffect(() => {
    if (!auftraggeber) {
      setSnapshot(emptySnapshot());
      setKundennummer(''); setSachbearbeiter('');
      return;
    }
    const std = (auftraggeber.rechnungsadressen ?? []).find((a) => a.ist_standard);
    setSnapshot(std ? snapshotFromRechnungsadresse(std) : snapshotFromAuftraggeber(auftraggeber));
    setAnrede(format.anrede ?? '');
    setUstSatz(Number(format.ust_satz) || 19);
    setKundennummer(auftraggeber.kundennummer ?? '');
    setSachbearbeiter(auftraggeber.sachbearbeiter ?? '');
    // Bei Wechsel des Auftraggebers Positionen verwerfen — sonst wären
    // sie mit dem falschen Format gerendert.
    setHaupt([]);
    setAuslagen([]);
    setTouren([]);
    setErstelleTouren(true);
    setErstelleAuslagen(true);
    setAuslagenOnly(false);
    setSchnellInfo(null);
    // Auch der Rechnungsempfänger-Filter wird zurückgesetzt, sonst
    // greift er gegen den falschen Auftraggeber.
    setRechnungsempfaengerId('');
  }, [auftraggeber, format.anrede, format.ust_satz]);

  /**
   * Rechnungsempfänger-Optionen für den aktuell gewählten Auftraggeber
   * laden: nur die Kontakte, die mindestens einmal auf einer Tour
   * dieses Auftraggebers als Rechnungsempfänger eingetragen sind. So
   * sehen Admins im Dropdown nur die tatsächlich relevanten Kontakte
   * und nicht den ganzen Adressbuch-Bestand.
   */
  useEffect(() => {
    let cancelled = false;
    if (!auftraggeber) {
      // Auch der leere Reset läuft async, damit der React-Linter
      // (set-state-in-effect) nicht meckert.
      void Promise.resolve().then(() => { if (!cancelled) setEmpfaengerOptions([]); });
      return () => { cancelled = true; };
    }
    void (async () => {
      const { data, error: err } = await supabase
        .from('touren')
        .select('kontakt:kontakt_id (id, auftraggeber_id, name, telefon, email, position, created_at)')
        .eq('auftraggeber_id', auftraggeber.id)
        .not('kontakt_id', 'is', null);
      if (cancelled) return;
      if (err) {
        console.warn('[Rechnungen] Empfaenger-Optionen-Fehler', err.message);
        setEmpfaengerOptions([]);
        return;
      }
      type Row = { kontakt: AuftraggeberKontakt | null };
      const map = new Map<string, AuftraggeberKontakt>();
      for (const r of (data as unknown as Row[]) ?? []) {
        if (r.kontakt) map.set(r.kontakt.id, r.kontakt);
      }
      // Sortierung nach Name; "ohne Namen" landet ans Ende.
      const list = [...map.values()].sort((a, b) =>
        (a.name ?? '').localeCompare(b.name ?? '', 'de', { sensitivity: 'base' }),
      );
      setEmpfaengerOptions(list);
    })();
    return () => { cancelled = true; };
  }, [auftraggeber]);

  /**
   * Wenn ein konkreter Rechnungsempfänger gewählt wird:
   *   - Adresse: falls eine rechnungsadressen-Zeile des Auftraggebers
   *     denselben Ansprechpartner trägt, deren Adresse übernehmen.
   *     Sonst Standard-Adresse + Ansprechpartner mit Empfänger-Namen.
   *   - Anrede: aus dem Empfänger-Namen ableiten.
   * Beim Wechsel auf "Alle" wird auf den Auftraggeber-Standard
   * zurückgesetzt. Beide Felder bleiben jederzeit editierbar.
   */
  useEffect(() => {
    if (!auftraggeber) return;
    let cancelled = false;
    // setState im Mikrotask, NICHT synchron im Effect-Body — React-19-
    // Linter würde sonst "set-state-in-effect" werfen.
    void Promise.resolve().then(() => {
      if (cancelled) return;
      const adressen = auftraggeber.rechnungsadressen ?? [];
      const std = adressen.find((a) => a.ist_standard);
      if (!rechnungsempfaengerId) {
        setSnapshot(std ? snapshotFromRechnungsadresse(std) : snapshotFromAuftraggeber(auftraggeber));
        setAnrede(format.anrede ?? '');
        return;
      }
      const empf = empfaengerOptions.find((k) => k.id === rechnungsempfaengerId);
      if (!empf) return;
      const matchAdresse = adressen.find((a) =>
        (a.ansprechpartner ?? '').trim().toLowerCase() === (empf.name ?? '').trim().toLowerCase()
        && (a.ansprechpartner ?? '').trim() !== '',
      );
      if (matchAdresse) {
        setSnapshot(snapshotFromRechnungsadresse(matchAdresse));
      } else {
        const base = std
          ? snapshotFromRechnungsadresse(std)
          : snapshotFromAuftraggeber(auftraggeber);
        setSnapshot({ ...base, ansprechpartner: empf.name ?? base.ansprechpartner });
      }
      setAnrede(buildAnrede(empf.name));
    });
    return () => { cancelled = true; };
  }, [rechnungsempfaengerId, empfaengerOptions, auftraggeber, format.anrede]);

  const loadTouren = useCallback(async () => {
    if (!auftraggeber) return;
    setLoadingTouren(true);
    setError(null);
    // Manuelle Touren-Ladung verlässt den Auslagen-only-Schnellmodus.
    setAuslagenOnly(false);
    setSchnellInfo(null);
    // Effektives Rechnungsdatum einer Tour:
    //   abweichend=true UND rechnungsdatum gesetzt → rechnungsdatum
    //   sonst                                       → enddatum
    // PostgREST kann das nicht direkt — also drei Branches mit .or():
    //   (rechnungsdatum_abweichend = true  AND rechnungsdatum = X)
    //   OR (rechnungsdatum_abweichend = false AND enddatum = X)
    //   OR (rechnungsdatum_abweichend IS NULL  AND enddatum = X)
    //
    // Bewusst KEIN Filter auf status='abgeschlossen': eine Tour die heute
    // endet (enddatum = today) ist im UI noch "aktiv", soll aber bei
    // Rechnungsdatum=today direkt mit auftauchen. Das ist die explizite
    // Anforderung aus Fix 3. "geplante" Touren ohne tatsächliches Ende
    // werden in der Regel kein Enddatum heute haben — falls doch
    // (Sonderfall), darf sie ja auch berechnet werden.
    const orFilter =
      `and(rechnungsdatum_abweichend.eq.true,rechnungsdatum.eq.${rechnungsdatum}),`
      + `and(rechnungsdatum_abweichend.eq.false,enddatum.eq.${rechnungsdatum}),`
      + `and(rechnungsdatum_abweichend.is.null,enddatum.eq.${rechnungsdatum})`;
    let query = supabase
      .from('touren')
      .select(`
        id, tour_id, start_stadt, ziel_stadt, rueckfuehrung_stadt,
        startdatum, enddatum, tourenart, kennzeichen,
        kundenname, fin, fin_rueck, sondervereinbarung, verguetung, info,
        rechnungsdatum, rechnungsdatum_abweichend, status,
        zusaetze:tour_zusaetze (id, kategorie, anzahl, betrag, notiz, kennzeichen)
      `)
      .eq('auftraggeber_id', auftraggeber.id);
    // Optionaler Filter auf einen konkreten Rechnungsempfänger — bei
    // "Alle" bleibt das Verhalten wie bisher (kein zusätzlicher Filter).
    if (rechnungsempfaengerId) {
      query = query.eq('kontakt_id', rechnungsempfaengerId);
    }
    const { data, error: err } = await query
      .or(orFilter)
      .order('enddatum', { ascending: true });
    setLoadingTouren(false);
    if (err) {
      console.error('[Rechnungen] Touren-Query Fehler', err);
      setError(err.message);
      return;
    }
    type RawTour = {
      id: string; tour_id: string | null;
      start_stadt: string; ziel_stadt: string; rueckfuehrung_stadt: string | null;
      startdatum: string | null; enddatum: string | null;
      tourenart: TourenartReal; kennzeichen: string[] | null;
      kundenname: string | null; fin: string | null; fin_rueck: string | null;
      sondervereinbarung: string | null; verguetung: number | null;
      info: string | null;
      rechnungsdatum: string | null; rechnungsdatum_abweichend: boolean | null;
      status: string | null;
      zusaetze: Array<{ id: string; kategorie: string; anzahl: number; betrag: number; notiz: string | null; kennzeichen: string | null }>;
    };
    const list: TourForRechnung[] = ((data as unknown as RawTour[]) ?? []).map((t) => ({
      id: t.id,
      tour_id: t.tour_id,
      start_stadt: t.start_stadt,
      ziel_stadt: t.ziel_stadt,
      rueckfuehrung_stadt: t.rueckfuehrung_stadt,
      startdatum: t.startdatum,
      enddatum: t.enddatum,
      tourenart: t.tourenart,
      kennzeichen: t.kennzeichen ?? [],
      kundenname: t.kundenname,
      fin: t.fin,
      fin_rueck: t.fin_rueck,
      sondervereinbarung: t.sondervereinbarung,
      verguetung: t.verguetung,
      info: t.info,
      zusaetze: t.zusaetze ?? [],
    }));
    setTouren(list);

    // Positionen rendern: bei getrennten Auslagen-Rechnungen in zwei Töpfe,
    // sonst alles in `haupt`.
    if (getrennt) {
      const teilTouren = generatePositionenFromTouren(list, format, { modus: 'touren' });
      const teilAuslagen = generatePositionenFromTouren(list, format, { modus: 'auslagen' });
      setHaupt(teilTouren.map((p) => ({ ...p, key: newKey('tour') })));
      setAuslagen(teilAuslagen.map((p) => ({ ...p, key: newKey('aus') })));
    } else {
      const alle = generatePositionenFromTouren(list, format, { modus: 'beides' });
      setHaupt(alle.map((p) => ({ ...p, key: newKey('p') })));
      setAuslagen([]);
    }
  }, [auftraggeber, rechnungsdatum, format, getrennt, rechnungsempfaengerId]);

  /**
   * "Touren erneut laden" (Aufgabe 5): überschreibt die generierten
   * Positionen mit dem frischen Touren-Stand. Manuelle Positionen
   * (ist_manuell=true) werden optional erhalten und nach dem Neuladen
   * wieder angehängt.
   */
  const reloadTouren = useCallback(async (keepManualRows: boolean) => {
    const manualHaupt = keepManualRows ? haupt.filter((p) => p.ist_manuell) : [];
    const manualAuslagen = keepManualRows ? auslagen.filter((p) => p.ist_manuell) : [];
    await loadTouren();
    if (manualHaupt.length > 0) setHaupt((rows) => [...rows, ...manualHaupt]);
    if (manualAuslagen.length > 0) setAuslagen((rows) => [...rows, ...manualAuslagen]);
  }, [haupt, auslagen, loadTouren]);

  /**
   * Schnell-Erstellung der CC-Auslagenrechnung zum letzten Touren-
   * Rechnungstag.
   *
   * Schritt 1: ermittele den Referenz-Rechnungstag — bevorzugt das
   *   `datum` der zuletzt erstellten TOUREN-Rechnung (also nicht
   *   ist_auslagen_rechnung), Fallback: letzter Werktag vor heute.
   * Schritt 2: lade alle Touren des Auftraggebers, deren effektives
   *   Rechnungsdatum diesem Referenzdatum entspricht.
   * Schritt 3: generiere NUR die Auslagen-Positionen (Zusätze die
   *   NICHT in zusaetze_auf_touren_rechnung sind).
   * Schritt 4: setze das Rechnungsdatum gemäß Monatsübergangs-Regel
   *   (heute vs. letzter Monatsende).
   * Schritt 5: schalte den Editor in auslagenOnly-Mode, damit nur
   *   die Auslagen-Sektion sichtbar und ist_auslagen_rechnung=true
   *   gespeichert wird.
   */
  const loadAuslagenVortag = useCallback(async () => {
    if (!auftraggeber) return;
    setLoadingSchnell(true);
    setError(null);
    setSchnellInfo(null);
    try {
      // 1. Letzte Touren-Rechnung des Auftraggebers finden.
      const { data: lastRow, error: lastErr } = await supabase
        .from('rechnungen')
        .select('id, datum')
        .eq('auftraggeber_id', auftraggeber.id)
        .eq('ist_auslagen_rechnung', false)
        .order('datum', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastErr) throw lastErr;

      let referenzDatum: string;
      if (lastRow) {
        referenzDatum = lastRow.datum;
      } else {
        // Fallback: letzter Werktag vor heute.
        referenzDatum = isoDate(letzterWerktagVor());
        setSchnellInfo(
          'Keine Touren-Rechnung vom Vortag gefunden — nutze letzten Werktag '
          + `(${formatDate(referenzDatum)}). Bitte Touren prüfen oder manuell erstellen.`,
        );
      }

      // 2. Touren mit diesem effektiven Rechnungsdatum laden.
      const orFilter =
        `and(rechnungsdatum_abweichend.eq.true,rechnungsdatum.eq.${referenzDatum}),`
        + `and(rechnungsdatum_abweichend.eq.false,enddatum.eq.${referenzDatum}),`
        + `and(rechnungsdatum_abweichend.is.null,enddatum.eq.${referenzDatum})`;
      const { data, error: err } = await supabase
        .from('touren')
        .select(`
          id, tour_id, start_stadt, ziel_stadt, rueckfuehrung_stadt,
          startdatum, enddatum, tourenart, kennzeichen,
          kundenname, fin, fin_rueck, sondervereinbarung, verguetung, info,
          rechnungsdatum, rechnungsdatum_abweichend,
          zusaetze:tour_zusaetze (id, kategorie, anzahl, betrag, notiz, kennzeichen)
        `)
        .eq('auftraggeber_id', auftraggeber.id)
        .or(orFilter)
        .order('enddatum', { ascending: true });
      if (err) throw err;
      type RawTour = {
        id: string; tour_id: string | null;
        start_stadt: string; ziel_stadt: string; rueckfuehrung_stadt: string | null;
        startdatum: string | null; enddatum: string | null;
        tourenart: TourenartReal; kennzeichen: string[] | null;
        kundenname: string | null; fin: string | null; fin_rueck: string | null;
        sondervereinbarung: string | null; verguetung: number | null;
        info: string | null;
        rechnungsdatum: string | null; rechnungsdatum_abweichend: boolean | null;
        zusaetze: Array<{ id: string; kategorie: string; anzahl: number; betrag: number; notiz: string | null; kennzeichen: string | null }>;
      };
      const list: TourForRechnung[] = ((data as unknown as RawTour[]) ?? []).map((t) => ({
        id: t.id, tour_id: t.tour_id,
        start_stadt: t.start_stadt, ziel_stadt: t.ziel_stadt,
        rueckfuehrung_stadt: t.rueckfuehrung_stadt,
        startdatum: t.startdatum, enddatum: t.enddatum,
        tourenart: t.tourenart, kennzeichen: t.kennzeichen ?? [],
        kundenname: t.kundenname, fin: t.fin,
        fin_rueck: t.fin_rueck,
        sondervereinbarung: t.sondervereinbarung,
        verguetung: t.verguetung,
        info: t.info,
        zusaetze: t.zusaetze ?? [],
      }));

      // 3. NUR Auslagen-Positionen generieren.
      const teilAuslagen = generatePositionenFromTouren(list, format, { modus: 'auslagen' });

      // 4. Rechnungsdatum gemäß Monatsübergangs-Regel.
      const neuesRechnungsdatum = auslagenRechnungsdatum(referenzDatum);

      setTouren(list);
      setHaupt([]);
      setAuslagen(teilAuslagen.map((p) => ({ ...p, key: newKey('aus') })));
      setRechnungsdatum(neuesRechnungsdatum);
      setAuslagenOnly(true);
      setErstelleTouren(false);
      setErstelleAuslagen(true);

      if (teilAuslagen.length === 0) {
        setSchnellInfo(
          (schnellInfo ?? '')
          + (schnellInfo ? ' ' : '')
          + `Keine Auslagen für ${formatDate(referenzDatum)} gefunden.`,
        );
      } else if (!schnellInfo) {
        setSchnellInfo(
          `Auslagen aus ${list.length} Tour(en) zum Referenz-Datum ${formatDate(referenzDatum)}. `
          + `Rechnungsdatum: ${formatDate(neuesRechnungsdatum)}.`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Schnellerstellung fehlgeschlagen');
    } finally {
      setLoadingSchnell(false);
    }
    // schnellInfo wird absichtlich nicht in die Deps aufgenommen — nur
    // initiale Werte sind relevant, die Funktion wird per Button getriggert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auftraggeber, format]);

  // Summen wandern in SummenBlock — die alten useMemos sind nicht mehr
  // nötig, da der Block selbst pro Render aggregiert.

  /**
   * Frühestes Startdatum und spätestes Enddatum der geladenen Touren —
   * wird für leistungszeitraum_von/_bis auf der Rechnung gespeichert.
   * Fällt auf das Rechnungsdatum zurück, wenn keine Touren geladen sind.
   */
  const leistungszeitraum = useMemo(() => {
    if (touren.length === 0) {
      return { von: rechnungsdatum, bis: rechnungsdatum };
    }
    let von: string | null = null;
    let bis: string | null = null;
    for (const t of touren) {
      const s = t.startdatum ?? t.enddatum;
      const e = t.enddatum ?? t.startdatum;
      if (s && (!von || s < von)) von = s;
      if (e && (!bis || e > bis)) bis = e;
    }
    return { von: von ?? rechnungsdatum, bis: bis ?? rechnungsdatum };
  }, [touren, rechnungsdatum]);

  async function speichern(status: 'entwurf' | 'offen') {
    if (!auftraggeber) { setError('Bitte einen Auftraggeber wählen.'); return; }
    if (!rechnungsdatum) { setError('Bitte das Rechnungsdatum angeben.'); return; }
    setError(null);
    setSaving(status);

    async function insertOne(
      positionen: EditorPosition[],
      istAuslagen: boolean,
      customNummer: string | null,
    ): Promise<{ ok: boolean; id?: string; error?: string }> {
      if (positionen.length === 0) return { ok: true };
      // Brutto + USt-Summe mehrmonatig korrekt: pro USt-Satz aggregieren.
      const sum = berechneSummenProUst(positionen, ustSatz);
      type Insert = Database['public']['Tables']['rechnungen']['Insert'];
      const insertPayload: Insert = {
        auftraggeber_id: auftraggeber!.id,
        // FK auf rechnungsadressen wird nicht mehr genutzt — wir
        // speichern den Snapshot direkt auf der Rechnung.
        rechnungsadresse_id: null,
        datum: rechnungsdatum,
        leistungszeitraum_von: leistungszeitraum.von,
        leistungszeitraum_bis: leistungszeitraum.bis,
        anrede: anrede || null,
        netto_summe: sum.netto,
        ust_satz: ustSatz,
        ust_betrag: sum.ust,
        brutto_summe: sum.brutto,
        status,
        notizen: notizen || null,
        ist_auslagen_rechnung: istAuslagen,
        ansprechpartner: snapshot.ansprechpartner || null,
        sachbearbeiter: sachbearbeiter || null,
        kundennummer: kundennummer || null,
        rechnungsadresse_firma:   snapshot.firma   || null,
        rechnungsadresse_strasse: snapshot.strasse || null,
        rechnungsadresse_plz_ort: snapshot.plz_ort || null,
        rechnungsadresse_land:    snapshot.land    || null,
        rechnungsempfaenger_id:   rechnungsempfaengerId || null,
      };
      // Manuelle Nummer nur, wenn der Admin sie nicht leer gelassen hat;
      // ansonsten vergibt der DB-Trigger die nächste freie Nummer.
      if (customNummer && customNummer.trim()) {
        insertPayload.rechnungsnummer = customNummer.trim();
      }
      const { data: rRow, error: rErr } = await supabase
        .from('rechnungen')
        .insert(insertPayload)
        .select('id')
        .single();
      if (rErr || !rRow) {
        return { ok: false, error: rErr?.message ?? 'Rechnung konnte nicht angelegt werden.' };
      }
      const rows = positionen.map((p, idx) => ({
        rechnung_id: rRow.id,
        position_nr: idx + 1,
        bezeichnung: p.bezeichnung,
        unterzeilen: p.unterzeilen,
        menge: p.menge,
        einzelpreis: p.einzelpreis,
        gesamtpreis: p.gesamtpreis,
        tour_id: p.tour_id,
        zusatz_id: p.zusatz_id,
        ist_manuell: p.ist_manuell,
        ust_satz: p.ust_satz,
      }));
      const { error: pErr } = await supabase.from('rechnungspositionen').insert(rows);
      if (pErr) return { ok: false, error: pErr.message };
      return { ok: true, id: rRow.id };
    }

    try {
      // Manuelle Rechnungsnummer (falls gesetzt) gilt für die ERSTE
      // angelegte Rechnung — bei getrennten Rechnungen würde sie sonst
      // den UNIQUE-Constraint verletzen. Die zweite Rechnung bekommt
      // ihre Nummer vom Trigger.
      const manuelleNummer = rechnungsnummer.trim() || null;
      let firstId: string | null = null;
      let nummerUsed = false;
      if (getrennt) {
        if (erstelleTouren) {
          const r = await insertOne(haupt, false, nummerUsed ? null : manuelleNummer);
          if (!r.ok) throw new Error(r.error);
          if (r.id) { firstId = r.id; nummerUsed = true; }
        }
        if (erstelleAuslagen) {
          const r = await insertOne(auslagen, true, nummerUsed ? null : manuelleNummer);
          if (!r.ok) throw new Error(r.error);
          if (!firstId && r.id) firstId = r.id;
        }
      } else {
        const r = await insertOne(haupt, false, manuelleNummer);
        if (!r.ok) throw new Error(r.error);
        if (r.id) firstId = r.id;
      }

      if (status === 'offen') {
        alert('Rechnung erstellt. PDF-Generierung wird in Kürze verfügbar.');
      }
      if (firstId) navigate(`/rechnungen/${firstId}`);
      else navigate('/rechnungen');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Postgres UNIQUE-Violation auf rechnungen.rechnungsnummer →
      // freundlicher Hinweis statt Roh-DB-Text.
      const isDuplicate = /duplicate key|unique|23505/i.test(msg)
        && /rechnungsnummer/i.test(msg);
      setError(isDuplicate
        ? `Rechnungsnummer „${rechnungsnummer.trim()}" existiert bereits. Bitte eine andere Nummer wählen oder das Feld leeren.`
        : (msg || 'Speichern fehlgeschlagen'));
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <Spinner label="Auftraggeber werden geladen …" />;

  const hauptTitle = getrennt ? 'Touren-Positionen' : 'Positionen';
  const adressVorlagen = auftraggeber?.rechnungsadressen ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-maja-navy">Neue Rechnung</h1>
          <p className="text-sm text-maja-muted">
            Auftraggeber wählen, Rechnungsdatum setzen, Touren laden — die
            Positionen werden automatisch aus dem Rechnungsformat generiert
            und sind danach frei editierbar.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => navigate('/rechnungen')}>
          Zurück
        </button>
      </div>

      {/* Kopfdaten */}
      <section className="card space-y-4 p-5">
        <h2 className="text-base font-semibold text-maja-navy">Kopfdaten</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="ag" className="label">Auftraggeber *</label>
            <select
              id="ag"
              className="input"
              value={auftraggeberId}
              onChange={(e) => setAuftraggeberId(e.target.value)}
            >
              <option value="">— wählen —</option>
              {auftraggeberList.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          {/* Optionaler Rechnungsempfänger-Filter. Wird nur eingeblendet,
              sobald ein Auftraggeber gewählt ist UND es mindestens
              einen Empfänger auf seinen Touren gibt — sonst wäre
              das Feld nutzlos. */}
          {auftraggeberId && empfaengerOptions.length > 0 && (
            <div>
              <label htmlFor="re-empf" className="label">Rechnungsempfänger</label>
              <select
                id="re-empf"
                className="input"
                value={rechnungsempfaengerId}
                onChange={(e) => setRechnungsempfaengerId(e.target.value)}
              >
                <option value="">Alle</option>
                {empfaengerOptions.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}{k.position ? ` · ${k.position}` : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-maja-muted">
                Filtert "Touren laden" auf Touren mit diesem Empfänger
                und füllt Adresse + Anrede passend voraus.
              </p>
            </div>
          )}
          <div>
            <label htmlFor="rdat" className="label">Rechnungsdatum *</label>
            <input
              id="rdat" type="date" className="input"
              value={rechnungsdatum} onChange={(e) => setRechnungsdatum(e.target.value)}
            />
            <p className="mt-1 text-xs text-maja-muted">
              "Touren laden" findet abgeschlossene Touren des Auftraggebers,
              deren effektives Rechnungsdatum (rechnungsdatum_abweichend
              bzw. enddatum) genau diesem Datum entspricht.
            </p>
          </div>
          <div>
            <label htmlFor="rnr" className="label">Rechnungsnummer</label>
            <input
              id="rnr" className="input"
              value={rechnungsnummer}
              onChange={(e) => { setRechnungsnummer(e.target.value); setNummerHint(null); }}
              placeholder="z. B. Re-2026/349"
              spellCheck={false}
            />
            <p className="mt-1 text-xs text-maja-muted">
              {nummerHint ?? 'Leer lassen, um die nächste freie Nummer automatisch zu vergeben.'}
            </p>
          </div>
          <div>
            <label htmlFor="kdnr" className="label">Kundennummer</label>
            <input
              id="kdnr" className="input"
              value={kundennummer} onChange={(e) => setKundennummer(e.target.value)}
              placeholder={auftraggeber?.kundennummer ?? ''}
            />
          </div>
          <div>
            <label htmlFor="sb" className="label">Sachbearbeiter</label>
            <input
              id="sb" className="input"
              value={sachbearbeiter} onChange={(e) => setSachbearbeiter(e.target.value)}
              placeholder={auftraggeber?.sachbearbeiter ?? ''}
            />
          </div>
          <div>
            <label htmlFor="ust" className="label">USt.-Satz (%)</label>
            <input
              id="ust" type="number" min={0} step={0.5} className="input"
              value={ustSatz}
              onChange={(e) => setUstSatz(Number(e.target.value) || 0)}
            />
          </div>
          <div>
            <label htmlFor="anrede" className="label">Anrede</label>
            <input
              id="anrede" className="input"
              value={anrede} onChange={(e) => setAnrede(e.target.value)}
              placeholder="Sehr geehrte Damen und Herren,"
            />
          </div>
        </div>

        {/* Rechnungsadresse — editierbare Snapshot-Felder */}
        <div className="space-y-3 rounded-lg bg-maja-light/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-maja-navy">Rechnungsadresse</h3>
            {adressVorlagen.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-maja-muted">
                <span>Adresse laden von …</span>
                <select
                  className="input py-1 text-xs"
                  value=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) return;
                    if (id === '__stammdaten' && auftraggeber) {
                      setSnapshot(snapshotFromAuftraggeber(auftraggeber));
                    } else {
                      const adr = adressVorlagen.find((a) => a.id === id);
                      if (adr) setSnapshot(snapshotFromRechnungsadresse(adr));
                    }
                    e.currentTarget.selectedIndex = 0;
                  }}
                >
                  <option value="">— wählen —</option>
                  {auftraggeber && <option value="__stammdaten">Stammdaten</option>}
                  {adressVorlagen.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.firma}{a.ist_standard ? ' (Standard)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="adr-firma" className="label">Firma</label>
              <input id="adr-firma" className="input"
                     value={snapshot.firma}
                     onChange={(e) => setSnapshot((s) => ({ ...s, firma: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="adr-ap" className="label">Ansprechpartner</label>
              <input id="adr-ap" className="input"
                     value={snapshot.ansprechpartner}
                     onChange={(e) => setSnapshot((s) => ({ ...s, ansprechpartner: e.target.value }))}
                     placeholder="z. B. Herr Jens Dracker" />
            </div>
            <div>
              <label htmlFor="adr-str" className="label">Straße</label>
              <input id="adr-str" className="input"
                     value={snapshot.strasse}
                     onChange={(e) => setSnapshot((s) => ({ ...s, strasse: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="adr-plz" className="label">PLZ / Ort</label>
              <input id="adr-plz" className="input"
                     value={snapshot.plz_ort}
                     onChange={(e) => setSnapshot((s) => ({ ...s, plz_ort: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="adr-land" className="label">Land</label>
              <input id="adr-land" className="input"
                     value={snapshot.land}
                     onChange={(e) => setSnapshot((s) => ({ ...s, land: e.target.value }))}
                     placeholder="(leer = Deutschland)" />
            </div>
          </div>
        </div>

        {getrennt && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">
              {auslagenOnly
                ? 'Schnellmodus: Es wird NUR eine Auslagen-Rechnung angelegt.'
                : 'Hinweis: Touren und Auslagen werden als separate Rechnungen erstellt.'}
            </p>
            {!auslagenOnly && (
              <div className="mt-2 flex flex-wrap gap-4 text-sm">
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4"
                         checked={erstelleTouren}
                         onChange={(e) => setErstelleTouren(e.target.checked)} />
                  Touren-Rechnung
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4"
                         checked={erstelleAuslagen}
                         onChange={(e) => setErstelleAuslagen(e.target.checked)} />
                  Auslagen-Rechnung
                </label>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="button"
            className="btn-primary"
            onClick={() => void loadTouren()}
            disabled={!auftraggeber || loadingTouren || loadingSchnell}
          >
            {loadingTouren ? 'Lade Touren …' : 'Touren laden'}
          </button>
          {(haupt.length > 0 || auslagen.length > 0) && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => { setKeepManual(true); setReloadConfirm(true); }}
              disabled={!auftraggeber || loadingTouren || loadingSchnell}
              title="Positionen neu aus den aktuellen Touren-Daten generieren"
            >
              Touren erneut laden
            </button>
          )}
          {getrennt && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void loadAuslagenVortag()}
              disabled={!auftraggeber || loadingTouren || loadingSchnell}
              title="Erstellt eine Auslagenrechnung basierend auf der letzten Touren-Sammelrechnung dieses Auftraggebers"
            >
              {loadingSchnell ? 'Lade Vortag …' : 'Auslagenrechnung zum Vortag erstellen'}
            </button>
          )}
          {auslagenOnly && (
            <span className="inline-flex items-center rounded-full bg-maja-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-maja-accent">
              Nur Auslagen
            </span>
          )}
          {touren.length > 0 && !auslagenOnly && (
            <span className="text-xs text-maja-muted">
              {touren.length} Tour{touren.length === 1 ? '' : 'en'} mit Rechnungsdatum {formatDate(rechnungsdatum)} — Leistungszeitraum {formatDate(leistungszeitraum.von)} – {formatDate(leistungszeitraum.bis)}.
            </span>
          )}
        </div>
        {schnellInfo && (
          <p className="rounded-md bg-maja-light/60 p-2 text-xs text-maja-ink">{schnellInfo}</p>
        )}
      </section>

      {/* Haupt-Positionen — im "Auslagen-only"-Schnellmodus ausgeblendet */}
      {!auslagenOnly && (haupt.length > 0 || auslagen.length > 0) && (
        <section className="card space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-maja-navy">{hauptTitle}</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={() => setHaupt((rows) => [...rows, emptyManuellePosition()])}
              >
                + Leere Position
              </button>
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={() => setTourPicker('haupt')}
                disabled={!auftraggeber}
                title={auftraggeber ? 'Tour auswählen + automatische Positionen' : 'Erst Auftraggeber wählen'}
              >
                + Tour hinzufügen
              </button>
            </div>
          </div>
          <PositionsTable
            positionen={haupt}
            defaultUstSatz={ustSatz}
            tourInfoById={tourInfoById}
            onChange={setHaupt}
          />
          <SummenBlock positionen={haupt} defaultSatz={ustSatz} prominent />
        </section>
      )}

      {/* Getrennte Auslagen */}
      {getrennt && auslagen.length > 0 && (
        <section className="card space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-maja-navy">Auslagen-Positionen</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={() => setAuslagen((rows) => [...rows, emptyManuellePosition()])}
              >
                + Leere Position
              </button>
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={() => setTourPicker('auslagen')}
                disabled={!auftraggeber}
                title={auftraggeber ? 'Tour auswählen + automatische Positionen' : 'Erst Auftraggeber wählen'}
              >
                + Tour hinzufügen
              </button>
            </div>
          </div>
          <PositionsTable
            positionen={auslagen}
            defaultUstSatz={ustSatz}
            tourInfoById={tourInfoById}
            onChange={setAuslagen}
          />
          <SummenBlock positionen={auslagen} defaultSatz={ustSatz} prominent />
        </section>
      )}

      {/* Notizen */}
      <section className="card space-y-3 p-5">
        <h2 className="text-base font-semibold text-maja-navy">Interne Notizen</h2>
        <textarea
          className="input min-h-[5rem]"
          value={notizen}
          onChange={(e) => setNotizen(e.target.value)}
          placeholder="Nur intern sichtbar."
        />
      </section>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Aktionen */}
      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-maja-navy/10 bg-white/95 px-2 py-3 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void speichern('entwurf')}
          disabled={saving !== null}
        >
          {saving === 'entwurf' ? 'Speichert …' : 'Als Entwurf speichern'}
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => void speichern('offen')}
          disabled={saving !== null}
        >
          {saving === 'offen' ? 'Erstellt …' : 'Rechnung erstellen'}
        </button>
      </div>

      {reloadConfirm && (
        <ConfirmDialog
          title="Touren erneut laden?"
          message={
            <>
              Alle Positionen werden neu aus den aktuellen Touren-Daten
              generiert. Manuelle Änderungen an generierten Positionen gehen
              verloren.
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                  checked={keepManual}
                  onChange={(e) => setKeepManual(e.target.checked)}
                />
                <span className="text-maja-ink">Manuelle Positionen behalten</span>
              </label>
            </>
          }
          confirmLabel="Neu laden"
          destructive
          onConfirm={() => { setReloadConfirm(false); void reloadTouren(keepManual); }}
          onClose={() => setReloadConfirm(false)}
        />
      )}

      {tourPicker && auftraggeber && (
        <AddTourPositionDialog
          auftraggeberId={auftraggeber.id}
          leistungszeitraumVon={leistungszeitraum.von}
          leistungszeitraumBis={leistungszeitraum.bis}
          modus={getrennt ? (tourPicker === 'auslagen' ? 'auslagen' : 'touren') : 'beides'}
          onClose={() => setTourPicker(null)}
          onAdd={(positionen, tour) => {
            const withKeys = positionen.map((p) => ({
              ...p,
              key: newKey(tourPicker === 'auslagen' ? 'aus' : 'tour'),
            }));
            if (tourPicker === 'auslagen') {
              setAuslagen((rows) => [...rows, ...withKeys]);
            } else {
              setHaupt((rows) => [...rows, ...withKeys]);
            }
            if (tour.info && tour.info.trim()) {
              setAddedTourInfos((m) => {
                const next = new Map(m);
                next.set(tour.id, tour.info!.trim());
                return next;
              });
            }
            setTourPicker(null);
          }}
        />
      )}
    </div>
  );
}

