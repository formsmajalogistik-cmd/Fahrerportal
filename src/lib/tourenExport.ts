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
  adresse_ziel: string | null;
  adresse_rueckfuehrung: string | null;
  kontakt_start: KontaktJson | null;
  kontakt_ziel: KontaktJson | null;
  kontakt_rueckfuehrung: KontaktJson | null;
  kennzeichen: string[] | null;
  fin: string | null;
  kundenname: string | null;
  km_hin: number | null;
  km_rueck: number | null;
  km_gesamt: number | null;
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
      zusaetze:tour_zusaetze (kategorie, anzahl, betrag, kennzeichen, notiz)
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
    'Kennzeichen Rück', 'FIN', 'Kundenname',
    'km Hin', 'km Rück', 'Info', 'created_at', 'Bestätigt',
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
      t.kundenname ?? '',
      t.km_hin ?? '',
      t.km_rueck ?? '',
      t.info ?? '',
      ymd(t.created_at),
      t.bestaetigt ? 'ja' : 'nein',
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

  // ---- Download --------------------------------------------------------
  const ym = dateFrom.slice(0, 7); // YYYY-MM
  XLSX.writeFile(wb, `Touren_Export_${ym}.xlsx`);
  return rows.length;
}
