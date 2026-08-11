import * as XLSX from 'xlsx';
import { supabase } from './supabase';
import { fahrerName } from './names';
import type { AppUser } from '../types/db';

// ============================================================
// Excel-Export der Tourenliste (Monats-Backup).
//
// WICHTIG — Roundtrip mit TourImportDialog:
// Der Importer (src/pages/touren/TourImportDialog.tsx) erwartet
//   * die HEADER in Zeile 2 (Zeile 1 ist ein Titel),
//   * die Route in EINER Spalte "Fahrauftrag" als "Start / Ziel / Rück",
//   * Fahrer + Auftraggeber per NAME (Fuzzy-Match, kein ID),
//   * und liest genau diese Spalten:
//       Datum, Fahrauftrag, Fahrer, Auftraggeber, Tourenart,
//       Sondervereinbarung, km Zahl, Vergütung (netto), Kennzeichen.
// Diese neun Spalten erzeugen wir mit EXAKT diesen Headern, damit der
// Export direkt re-importierbar ist. Zusätzliche Spalten (Adressen,
// Kontakte, FIN, …) und das zweite Blatt „Zusätze" sind ein vollständigeres
// Backup für Menschen; der aktuelle Importer ignoriert sie.
// ============================================================

interface ExportArgs {
  /** ISO-Datum (YYYY-MM-DD) — wie in der Tourenliste gewählt. */
  dateFrom: string;
  dateTo: string;
  /** Optionaler Auftraggeber-Filter (id) — wenn gesetzt. */
  auftraggeberId?: string | null;
}

interface KontaktJson { name?: string; telefon?: string; email?: string }

interface ExportRow {
  id: string;
  tour_id: string | null;
  status: string;
  tourenart: string | null;
  startdatum: string;
  enddatum: string;
  start_stadt: string;
  ziel_stadt: string;
  rueckfuehrung_stadt: string | null;
  adresse_start: string | null;
  strasse_start: string | null;
  hausnummer_start: string | null;
  plz_start: string | null;
  strasse_ziel: string | null;
  hausnummer_ziel: string | null;
  plz_ziel: string | null;
  strasse_rueckfuehrung: string | null;
  hausnummer_rueckfuehrung: string | null;
  plz_rueckfuehrung: string | null;
  auf_eis: boolean | null;
  auf_eis_notiz: string | null;
  adresse_ziel: string | null;
  adresse_rueckfuehrung: string | null;
  kontakt_start: KontaktJson | null;
  kontakt_ziel: KontaktJson | null;
  kontakt_rueckfuehrung: KontaktJson | null;
  kennzeichen: string[] | null;
  fin: string | null;
  fin_rueck: string | null;
  kundenname: string | null;
  fahrzeugmodell: string | null;
  fahrzeugmodell_rueck: string | null;
  zeit_start: string | null;
  zeit_ziel: string | null;
  zeit_rueckfuehrung: string | null;
  km_hin: number | null;
  km_rueck: number | null;
  km_gesamt: number | null;
  aba_gesamt_km_berechnen: boolean | null;
  verguetung: number | null;
  sondervereinbarung: string | null;
  ist_sondervereinbarung: boolean;
  info: string | null;
  created_at: string;
  bestaetigt: boolean;
  auftraggeber: { name: string } | null;
  fahrer:
    | { vorname: string | null; nachname: string | null; user: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null }
    | null;
  zusaetze: Array<{
    kategorie: string; anzahl: number; betrag: number;
    kennzeichen: string | null; notiz: string | null;
  }> | null;
  ansprechpartner: Array<{
    station: string; name: string | null; telefon: string | null;
    email: string | null; sortierung: number;
  }> | null;
}

function ymd(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function kontaktStr(k: KontaktJson | null): { name: string; tel: string; mail: string } {
  return {
    name: k?.name?.trim() ?? '',
    tel: k?.telefon?.trim() ?? '',
    mail: k?.email?.trim() ?? '',
  };
}

function routeString(r: ExportRow): string {
  return [r.start_stadt, r.ziel_stadt, r.rueckfuehrung_stadt]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' / ');
}

/**
 * Lädt alle Touren des Zeitraums (+ optional Auftraggeber-Filter) inkl.
 * Joins und erzeugt eine .xlsx-Datei, die direkt re-importierbar ist.
 */
export async function exportTourenExcel({ dateFrom, dateTo, auftraggeberId }: ExportArgs): Promise<number> {
  let query = supabase
    .from('touren')
    .select(`
      *,
      auftraggeber:auftraggeber_id (name),
      fahrer:fahrer_id (vorname, nachname, user:user_id (email, vorname, nachname)),
      zusaetze:tour_zusaetze (kategorie, anzahl, betrag, kennzeichen, notiz),
      ansprechpartner:tour_ansprechpartner (station, name, telefon, email, sortierung)
    `)
    .gte('enddatum', dateFrom)
    .lte('enddatum', dateTo)
    .order('enddatum', { ascending: true })
    .order('created_at', { ascending: true });
  if (auftraggeberId) query = query.eq('auftraggeber_id', auftraggeberId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data as unknown as ExportRow[]) ?? [];

  // ---- Blatt „Touren" --------------------------------------------------
  // Die ersten neun Header sind import-kompatibel; der Rest ist Backup.
  const header = [
    // Import-kompatibel (exakte Header!):
    'Datum', 'Fahrauftrag', 'Fahrer', 'Auftraggeber', 'Tourenart',
    'Sondervereinbarung', 'km Zahl', 'Vergütung (netto)', 'Kennzeichen',
    // Zusätzliche Backup-Spalten:
    'Tour-ID', 'Status', 'Enddatum',
    'Start-Stadt', 'Ziel-Stadt', 'Rückführung-Stadt',
    'Adresse Start', 'Adresse Ziel', 'Adresse Rückführung',
    'Kontakt Start Name', 'Kontakt Start Tel', 'Kontakt Start E-Mail',
    'Kontakt Ziel Name', 'Kontakt Ziel Tel', 'Kontakt Ziel E-Mail',
    'Kontakt Rück Name', 'Kontakt Rück Tel', 'Kontakt Rück E-Mail',
    'Kennzeichen Rück', 'FIN', 'FIN Rück', 'Kundenname',
    'km Hin', 'km Rück', 'Info', 'created_at', 'Bestätigt',
    // Migration 080/081 — optional, der Importer kommt auch ohne sie klar.
    'Fahrzeugmodell', 'Fahrzeugmodell Rück',
    'Zeit Start', 'Zeit Ziel', 'Zeit Rückführung',
    // Migration 085 — nur bei ABA relevant.
    'ABA Gesamt-km berechnen',
    // Migration 086 — Adressteile + Terminierung.
    'Straße Start', 'Hausnummer Start', 'PLZ Start',
    'Straße Ziel', 'Hausnummer Ziel', 'PLZ Ziel',
    'Straße Rückführung', 'Hausnummer Rückführung', 'PLZ Rückführung',
    'Auf Eis', 'Auf-Eis-Notiz',
  ];

  const dataRows = rows.map((t) => {
    const ks = kontaktStr(t.kontakt_start);
    const kz = kontaktStr(t.kontakt_ziel);
    const kr = kontaktStr(t.kontakt_rueckfuehrung);
    const kennz = Array.isArray(t.kennzeichen) ? t.kennzeichen : [];
    return [
      ymd(t.startdatum),                                   // Datum
      routeString(t),                                      // Fahrauftrag
      t.fahrer ? fahrerName(t.fahrer, t.fahrer.user ?? null) : '', // Fahrer
      t.auftraggeber?.name ?? '',                          // Auftraggeber
      t.tourenart ?? '',                                   // Tourenart
      t.ist_sondervereinbarung ? (t.sondervereinbarung ?? '') : '', // Sondervereinbarung
      t.km_gesamt ?? '',                                   // km Zahl (Zahl)
      t.verguetung ?? '',                                  // Vergütung (netto) (Zahl)
      kennz[0] ?? '',                                      // Kennzeichen (Erstes — Import nimmt nur eins)
      // Backup-Spalten:
      t.tour_id ?? '',
      t.status ?? '',
      ymd(t.enddatum),
      t.start_stadt ?? '',
      t.ziel_stadt ?? '',
      t.rueckfuehrung_stadt ?? '',
      t.adresse_start ?? '',
      t.adresse_ziel ?? '',
      t.adresse_rueckfuehrung ?? '',
      ks.name, ks.tel, ks.mail,
      kz.name, kz.tel, kz.mail,
      kr.name, kr.tel, kr.mail,
      kennz[1] ?? '',
      t.fin ?? '',
      t.fin_rueck ?? '',
      t.kundenname ?? '',
      t.km_hin ?? '',
      t.km_rueck ?? '',
      t.info ?? '',
      ymd(t.created_at),
      t.bestaetigt ? 'ja' : 'nein',
      t.fahrzeugmodell ?? '',
      t.fahrzeugmodell_rueck ?? '',
      t.zeit_start ?? '',
      t.zeit_ziel ?? '',
      t.zeit_rueckfuehrung ?? '',
      t.aba_gesamt_km_berechnen ? 'ja' : 'nein',
      t.strasse_start ?? '',
      t.hausnummer_start ?? '',
      t.plz_start ?? '',
      t.strasse_ziel ?? '',
      t.hausnummer_ziel ?? '',
      t.plz_ziel ?? '',
      t.strasse_rueckfuehrung ?? '',
      t.hausnummer_rueckfuehrung ?? '',
      t.plz_rueckfuehrung ?? '',
      t.auf_eis ? 'ja' : 'nein',
      t.auf_eis_notiz ?? '',
    ];
  });

  const title = `Touren-Export ${dateFrom} bis ${dateTo}`;
  // Zeile 1 = Titel, Zeile 2 = Header, ab Zeile 3 Daten (Importer erwartet
  // den Header in Zeile 2).
  const tourenAoa = [[title], header, ...dataRows];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tourenAoa), 'Touren');

  // ---- Blatt „Zusätze" (Backup; vom aktuellen Importer nicht gelesen) --
  const zHeader = ['Tour-ID', 'Kategorie', 'Anzahl', 'Betrag', 'Kennzeichen', 'Notiz'];
  const zRows: unknown[][] = [];
  for (const t of rows) {
    for (const z of t.zusaetze ?? []) {
      zRows.push([
        t.tour_id ?? '',
        z.kategorie ?? '',
        z.anzahl ?? '',
        z.betrag ?? '',
        z.kennzeichen ?? '',
        z.notiz ?? '',
      ]);
    }
  }
  const zusaetzeAoa = [['Zusätze'], zHeader, ...zRows];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(zusaetzeAoa), 'Zusätze');

  // ---- Blatt „Ansprechpartner" (Migration 080) -------------------------
  // Der ERSTE Ansprechpartner je Station steht zusätzlich weiterhin in
  // den Kontakt-Spalten des Touren-Blatts — dieses Blatt ist die
  // vollständige Liste inkl. weiterer Kontakte.
  const aHeader = ['Tour-ID', 'Station', 'Name', 'Telefon', 'E-Mail', 'Reihenfolge'];
  const stationLabel: Record<string, string> = {
    start: 'Start', ziel: 'Ziel', rueckfuehrung: 'Rückführung',
  };
  const aRows: unknown[][] = [];
  for (const t of rows) {
    const liste = [...(t.ansprechpartner ?? [])]
      .sort((x, y) => (x.station === y.station
        ? x.sortierung - y.sortierung
        : x.station.localeCompare(y.station)));
    for (const a of liste) {
      aRows.push([
        t.tour_id ?? '',
        stationLabel[a.station] ?? a.station,
        a.name ?? '',
        a.telefon ?? '',
        a.email ?? '',
        a.sortierung + 1,
      ]);
    }
  }
  const apAoa = [['Ansprechpartner'], aHeader, ...aRows];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(apAoa), 'Ansprechpartner');

  // ---- Download --------------------------------------------------------
  const ym = dateFrom.slice(0, 7); // YYYY-MM
  XLSX.writeFile(wb, `Touren_Export_${ym}.xlsx`);
  return rows.length;
}
