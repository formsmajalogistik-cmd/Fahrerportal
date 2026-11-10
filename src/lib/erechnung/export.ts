// Archiv-Export: E-Rechnungen eines Zeitraums als ZIP (Originaldateien
// unverändert + Übersichtsliste als CSV) für die Übertragung in die
// Buchhaltung / auf den eigenen Server.
//
//  * Die Dateien werden NICHT neu erzeugt, sondern aus dem Archiv geholt —
//    über kurzlebige Direkt-Links direkt von OneDrive (nicht durch die
//    Vercel-Function).
//  * Vor dem Packen wird jede Datei gegen den beim Archivieren
//    gespeicherten SHA-256 geprüft; Abweichungen stehen in der Liste und
//    werden in der Oberfläche gemeldet.
//  * Je Beleg wird der Export protokolliert (erechnung_exporte).
//  * Der Export löscht nichts.

import { supabase } from '../supabase';
import { downloadFromOneDrive, holeArchivUrls } from '../onedrive';
import type { Database } from '../../types/supabase';

type DokRow = Database['public']['Tables']['erechnung_dokumente']['Row'];

export interface ExportEintrag {
  dokument: DokRow;
  belegnummer: string;
  /** Belegdatum (YYYY-MM-DD). */
  datum: string;
  empfaenger: string;
  auftraggeberId: string | null;
  typ: 'Rechnung' | 'Storno' | 'Teilgutschrift';
  brutto: number;
  /** Zeitpunkt des letzten Exports (ISO) oder null. */
  zuletztExportiert: string | null;
}

export interface ExportFilter {
  von: string;
  bis: string;
  auftraggeberId?: string | null;
  nurNichtExportiert?: boolean;
}

/** „2026-11" → erster und letzter Tag des Monats. */
export function monatsGrenzen(monat: string): { von: string; bis: string } {
  const [j, m] = monat.split('-').map(Number);
  const letzter = new Date(Date.UTC(j, m, 0)).getUTCDate();
  return { von: `${monat}-01`, bis: `${monat}-${String(letzter).padStart(2, '0')}` };
}

interface RoheZeile extends DokRow {
  rechnung: { datum: string; rechnungsadresse_firma: string | null; ansprechpartner: string | null; brutto_summe: number; auftraggeber_id: string | null } | null;
  gutschrift: { datum: string; adress_snapshot: unknown; brutto_summe: number; art: string; auftraggeber_id: string | null } | null;
}

export async function ladeExportListe(f: ExportFilter): Promise<ExportEintrag[]> {
  const { data, error } = await supabase.from('erechnung_dokumente')
    .select(`*,
      rechnung:rechnung_id (datum, rechnungsadresse_firma, ansprechpartner, brutto_summe, auftraggeber_id),
      gutschrift:gutschrift_id (datum, adress_snapshot, brutto_summe, art, auftraggeber_id)`)
    .order('erzeugt_am', { ascending: true });
  if (error) throw new Error(error.message);
  const zeilen = (data ?? []) as unknown as RoheZeile[];
  const { data: ex, error: eErr } = await supabase.from('erechnung_exporte').select('dokument_id, exportiert_am');
  if (eErr) throw new Error(eErr.message);
  const zuletzt = new Map<string, string>();
  for (const e of ex ?? []) {
    const alt = zuletzt.get(e.dokument_id);
    if (!alt || e.exportiert_am > alt) zuletzt.set(e.dokument_id, e.exportiert_am);
  }
  const liste: ExportEintrag[] = zeilen.map((z) => {
    const a = (z.gutschrift?.adress_snapshot && typeof z.gutschrift.adress_snapshot === 'object'
      ? z.gutschrift.adress_snapshot : {}) as Record<string, string | null>;
    const { rechnung: r, gutschrift: g, ...dokument } = z;
    return {
      dokument: dokument as DokRow,
      belegnummer: z.belegnummer,
      datum: r?.datum ?? g?.datum ?? z.erzeugt_am.slice(0, 10),
      empfaenger: (r ? (r.rechnungsadresse_firma || r.ansprechpartner) : (a.firma || a.ansprechpartner)) || '—',
      auftraggeberId: r?.auftraggeber_id ?? g?.auftraggeber_id ?? null,
      typ: r ? 'Rechnung' : g?.art === 'storno' ? 'Storno' : 'Teilgutschrift',
      brutto: Number(r?.brutto_summe ?? g?.brutto_summe ?? 0),
      zuletztExportiert: zuletzt.get(z.id) ?? null,
    };
  });
  return liste.filter((e) => e.datum >= f.von && e.datum <= f.bis
    && (!f.auftraggeberId || e.auftraggeberId === f.auftraggeberId)
    && (!f.nurNichtExportiert || !e.zuletztExportiert))
    .sort((x, y) => (x.datum === y.datum ? x.belegnummer.localeCompare(y.belegnummer, 'de', { numeric: true }) : x.datum.localeCompare(y.datum)));
}

// ---------------------------------------------------------------- Hash, CSV, ZIP

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const FORMAT_NAME: Record<string, string> = { en16931_cii: 'EN 16931 (XML)', xrechnung_cii: 'XRechnung (XML)', zugferd: 'ZUGFeRD (PDF)' };

export interface ExportDatei {
  eintrag: ExportEintrag;
  /** Rolle der Datei: maßgebliche Datei oder Lesekopie. */
  art: 'XML' | 'PDF-Lesekopie' | 'ZUGFeRD-PDF';
  pfad: string;
  /** Pfad im ZIP. */
  name: string;
  sollHash: string;
  istHash: string | null;
  bytes: Uint8Array | null;
  fehler: string | null;
}

/** Alle Dateien eines Eintrags (XML + Lesekopie bzw. ein ZUGFeRD-PDF). */
export function dateienVon(e: ExportEintrag): Array<Pick<ExportDatei, 'art' | 'pfad' | 'name' | 'sollHash'>> {
  const d = e.dokument;
  const zipName = (p: string) => p.split('/').slice(-2).join('/'); // „2026/Re_26_5.xml"
  if (!d.xml_pfad) return [{ art: 'ZUGFeRD-PDF', pfad: d.pdf_pfad, name: zipName(d.pdf_pfad), sollHash: d.sha256_pdf }];
  return [
    { art: 'XML', pfad: d.xml_pfad, name: zipName(d.xml_pfad), sollHash: d.sha256_xml },
    { art: 'PDF-Lesekopie', pfad: d.pdf_pfad, name: zipName(d.pdf_pfad), sollHash: d.sha256_pdf },
  ];
}

const csvFeld = (v: string | number) => {
  const s = String(v);
  // Formel-Schutz für Tabellenprogramme + Anführungszeichen.
  const sicher = /^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s.replace(',', '.'))) ? `'${s}` : s;
  return `"${sicher.replace(/"/g, '""')}"`;
};
const datumDe = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? `${m[3]}.${m[2]}.${m[1]}` : iso; };

/** Übersichtsliste (CSV, Semikolon, UTF-8 mit BOM — öffnet direkt in Excel). */
export function baueCsv(dateien: ExportDatei[]): string {
  const kopf = ['Belegnummer', 'Datum', 'Empfänger', 'Typ', 'Format', 'Brutto', 'Datei', 'Dateiname', 'SHA-256', 'erzeugt am', 'Hash-Prüfung'];
  const zeilen = dateien.map((d) => [
    d.eintrag.belegnummer, datumDe(d.eintrag.datum), d.eintrag.empfaenger, d.eintrag.typ,
    FORMAT_NAME[d.eintrag.dokument.format] ?? d.eintrag.dokument.format,
    d.eintrag.brutto.toFixed(2).replace('.', ','), d.art, d.name, d.sollHash,
    new Date(d.eintrag.dokument.erzeugt_am).toLocaleString('de-DE'),
    d.fehler ? `FEHLER: ${d.fehler}` : d.istHash === d.sollHash ? 'ok' : `ABWEICHUNG (Datei: ${d.istHash})`,
  ].map(csvFeld).join(';'));
  return `﻿${[kopf.map(csvFeld).join(';'), ...zeilen].join('\r\n')}\r\n`;
}

let crcTabelle: Uint32Array | null = null;
function crc32(b: Uint8Array): number {
  if (!crcTabelle) {
    crcTabelle = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTabelle[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i += 1) c = crcTabelle[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * ZIP ohne Kompression („stored"): die Dateien stehen Byte für Byte
 * unverändert im Archiv. Dateinamen in UTF-8.
 */
export function baueZip(dateien: Array<{ name: string; bytes: Uint8Array }>, zeit = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const dosZeit = ((zeit.getHours() << 11) | (zeit.getMinutes() << 5) | (zeit.getSeconds() >> 1)) & 0xffff;
  const dosDatum = (((zeit.getFullYear() - 1980) << 9) | ((zeit.getMonth() + 1) << 5) | zeit.getDate()) & 0xffff;
  const teile: Uint8Array[] = [];
  const zentral: Uint8Array[] = [];
  let offset = 0;
  for (const f of dateien) {
    const name = enc.encode(f.name);
    const crc = crc32(f.bytes);
    const lokal = new DataView(new ArrayBuffer(30));
    lokal.setUint32(0, 0x04034b50, true); lokal.setUint16(4, 20, true); lokal.setUint16(6, 0x0800, true); lokal.setUint16(8, 0, true);
    lokal.setUint16(10, dosZeit, true); lokal.setUint16(12, dosDatum, true); lokal.setUint32(14, crc, true);
    lokal.setUint32(18, f.bytes.length, true); lokal.setUint32(22, f.bytes.length, true); lokal.setUint16(26, name.length, true); lokal.setUint16(28, 0, true);
    teile.push(new Uint8Array(lokal.buffer), name, f.bytes);
    const z = new DataView(new ArrayBuffer(46));
    z.setUint32(0, 0x02014b50, true); z.setUint16(4, 20, true); z.setUint16(6, 20, true); z.setUint16(8, 0x0800, true); z.setUint16(10, 0, true);
    z.setUint16(12, dosZeit, true); z.setUint16(14, dosDatum, true); z.setUint32(16, crc, true);
    z.setUint32(20, f.bytes.length, true); z.setUint32(24, f.bytes.length, true); z.setUint16(28, name.length, true);
    z.setUint32(42, offset, true);
    zentral.push(new Uint8Array(z.buffer), name);
    offset += 30 + name.length + f.bytes.length;
  }
  const zLen = zentral.reduce((s, x) => s + x.length, 0);
  const ende = new DataView(new ArrayBuffer(22));
  ende.setUint32(0, 0x06054b50, true); ende.setUint16(8, dateien.length, true); ende.setUint16(10, dateien.length, true);
  ende.setUint32(12, zLen, true); ende.setUint32(16, offset, true);
  const alle = [...teile, ...zentral, new Uint8Array(ende.buffer)];
  const out = new Uint8Array(alle.reduce((s, x) => s + x.length, 0));
  let p = 0;
  for (const x of alle) { out.set(x, p); p += x.length; }
  return out;
}

// ---------------------------------------------------------------- Export

export interface ExportErgebnis {
  zip: Blob;
  dateiname: string;
  dateien: ExportDatei[];
  /** Dateien mit Hash-Abweichung oder Ladefehler. */
  abweichungen: ExportDatei[];
  /** Export-Protokoll geschrieben? (false z.B. im Testmodus) */
  protokolliert: boolean;
  protokollFehler: string | null;
}

async function ladeDatei(pfad: string, url: string | null | undefined): Promise<Uint8Array> {
  if (url) {
    try {
      const r = await fetch(url);
      if (r.ok) return new Uint8Array(await r.arrayBuffer());
    } catch { /* Direkt-Link nicht erreichbar → Ersatzweg unten */ }
  }
  // Ersatzweg (einzelne kleine Datei) über die bestehende Download-Route.
  return new Uint8Array(await (await downloadFromOneDrive(pfad)).arrayBuffer());
}

export async function exportiere(
  eintraege: ExportEintrag[], bezeichnung: string,
  opts: { benutzerName?: string | null; onFortschritt?: (fertig: number, gesamt: number) => void } = {},
): Promise<ExportErgebnis> {
  const plan: ExportDatei[] = eintraege.flatMap((e) => dateienVon(e).map((d) => ({ ...d, eintrag: e, istHash: null, bytes: null, fehler: null })));
  // Direkt-Links in Gruppen holen (kurzlebig → erst unmittelbar vor dem Laden).
  let fertig = 0;
  for (let i = 0; i < plan.length; i += 40) {
    const gruppe = plan.slice(i, i + 40);
    const urls = await holeArchivUrls(gruppe.map((d) => d.pfad)).catch(() => ({} as Record<string, string | null>));
    for (let k = 0; k < gruppe.length; k += 4) {
      await Promise.all(gruppe.slice(k, k + 4).map(async (d) => {
        try {
          d.bytes = await ladeDatei(d.pfad, urls[d.pfad]);
          d.istHash = await sha256Hex(d.bytes);
        } catch (e) {
          d.fehler = e instanceof Error ? e.message : String(e);
        }
        fertig += 1;
        opts.onFortschritt?.(fertig, plan.length);
      }));
    }
  }
  const abweichungen = plan.filter((d) => d.fehler || d.istHash !== d.sollHash);
  const csv = baueCsv(plan);
  const zipBytes = baueZip([
    { name: 'Uebersicht.csv', bytes: new TextEncoder().encode(csv) },
    ...plan.filter((d) => d.bytes).map((d) => ({ name: d.name, bytes: d.bytes! })),
  ]);

  // Export je Beleg protokollieren (hash_ok = alle Dateien des Belegs stimmen).
  const zeilen = eintraege.map((e) => {
    const eigene = plan.filter((d) => d.eintrag === e);
    const schlecht = eigene.filter((d) => d.fehler || d.istHash !== d.sollHash);
    return {
      dokument_id: e.dokument.id, hash_ok: schlecht.length === 0, exportiert_von_name: opts.benutzerName ?? null,
      hinweis: schlecht.length ? schlecht.map((d) => `${d.name}: ${d.fehler ?? 'Hash-Abweichung'}`).join('; ') : null,
    };
  });
  const { error } = zeilen.length ? await supabase.from('erechnung_exporte').insert(zeilen) : { error: null };
  return {
    zip: new Blob([zipBytes as BlobPart], { type: 'application/zip' }),
    dateiname: `E-Rechnungen_${bezeichnung}.zip`,
    dateien: plan, abweichungen,
    protokolliert: !error, protokollFehler: error?.message ?? null,
  };
}
