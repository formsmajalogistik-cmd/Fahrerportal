// E-Rechnung: Archivierung (serverseitig, Service-Rolle).
//
// Ablauf je Beleg (Rechnung oder Storno/Teilgutschrift):
//   1. Beleg prüfen (erstellt/final, E-Rechnungs-Format, XML gehört zum Beleg).
//      Gibt es schon einen Archiv-Eintrag → Abbruch, NIE ersetzen.
//   2. SHA-256 berechnen.
//   3. OneDrive: Maja-Logistik/E-Rechnungen/{Jahr}/{Nummer}.xml/.pdf
//      (ZUGFeRD: nur das PDF/A-3 mit eingebettetem XML) — nie überschreiben.
//   4. Zweitkopie im privaten Supabase-Bucket 'erechnung'.
//   5. Eintrag in erechnung_dokumente (nur INSERT möglich).
//
// Wiederholbar (Phase 1c): Scheitert ein Versuch nach einem Upload
// (Zeitlimit, Netz, Datenbank), darf der nächste Versuch nicht
// blockieren. Liegt am Zielpfad schon eine Datei OHNE Archiv-Eintrag:
//   * gleicher SHA-256  → übernehmen, weiter;
//   * anderer Inhalt    → sie war nie gültig: umbenennen zu
//                         …_verworfen_{Zeitstempel}, dann neu ablegen.
// Beides wird im Eintrag vermerkt (Spalte protokoll). Diese Funktion
// LÖSCHT NICHTS — weder in OneDrive noch im Bucket.

import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, decodePDFRawStream,
} from 'pdf-lib';
import { HttpError } from './auth.js';
import { DateiExistiertFehler, downloadFile, renameItem, uploadFileNeu } from './graph.js';
import { sicheresPfadSegment } from './paths.js';

export const ARCHIV_ROOT = 'Maja-Logistik/E-Rechnungen';
const FORMATE = new Set(['en16931_cii', 'xrechnung_cii', 'zugferd']);
/** Name der eingebetteten Datei laut Factur-X/ZUGFeRD ab 2.1. */
export const ZUGFERD_DATEINAME = 'factur-x.xml';

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function adminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(500, 'Supabase-Server-Env fehlt (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY)');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Kopfdaten aus dem XML, um zu prüfen, dass es zum Beleg gehört. */
export function xmlKopf(xml: string): { nummer: string | null; typCode: string | null } {
  const dok = /<rsm:ExchangedDocument>([\s\S]*?)<\/rsm:ExchangedDocument>/.exec(xml)?.[1] ?? '';
  const ent = (s: string | undefined) => (s ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const nummer = /<ram:ID>([^<]*)<\/ram:ID>/.exec(dok)?.[1];
  const typ = /<ram:TypeCode>([^<]*)<\/ram:TypeCode>/.exec(dok)?.[1];
  return { nummer: nummer != null ? ent(nummer).trim() : null, typCode: typ?.trim() ?? null };
}

/** Liest die eingebettete factur-x.xml aus einem ZUGFeRD-PDF (null = keine). */
export async function eingebettetesXml(pdf: Uint8Array): Promise<Uint8Array | null> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  const baum = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  const liste = baum?.lookupMaybe(PDFName.of('Names'), PDFArray);
  if (!liste) return null;
  for (let i = 0; i + 1 < liste.size(); i += 2) {
    const n = liste.lookup(i);
    const name = n instanceof PDFString || n instanceof PDFHexString ? n.decodeText() : '';
    if (name !== ZUGFERD_DATEINAME) continue;
    const spec = liste.lookup(i + 1, PDFDict);
    const ef = spec.lookup(PDFName.of('EF'), PDFDict);
    const strom = ef.lookup(PDFName.of('F'));
    if (strom instanceof PDFRawStream) return decodePDFRawStream(strom).decode();
  }
  return null;
}

export interface ArchivEingabe {
  beleg: 'rechnung' | 'gutschrift';
  id: string;
  /** XML-Datei — entfällt bei ZUGFeRD (wird aus dem PDF gelesen). */
  xml?: Uint8Array | null;
  /** PDF-Lesekopie bzw. bei ZUGFeRD das PDF/A-3 mit eingebettetem XML. */
  pdf: Uint8Array;
  userId: string;
}

function zeitstempel(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

function verworfenName(pfad: string, ts: string): string {
  const name = pfad.slice(pfad.lastIndexOf('/') + 1);
  const punkt = name.lastIndexOf('.');
  return `${name.slice(0, punkt)}_verworfen_${ts}${name.slice(punkt)}`;
}

/** Wird der Pfad schon von IRGENDEINEM Archiv-Eintrag verwendet? Dann niemals anfassen. */
async function pfadIstArchiviert(db: SupabaseClient, pfad: string): Promise<boolean> {
  for (const spalte of ['xml_pfad', 'pdf_pfad'] as const) {
    const { count, error } = await db.from('erechnung_dokumente').select('id', { count: 'exact', head: true }).eq(spalte, pfad);
    if (error) throw new HttpError(500, error.message);
    if ((count ?? 0) > 0) return true;
  }
  return false;
}

/**
 * Datei in OneDrive ablegen, ohne je zu überschreiben. Liefert einen
 * Protokoll-Vermerk, wenn schon eine Datei dort lag.
 */
async function ablegenOneDrive(db: SupabaseClient, pfad: string, bytes: Uint8Array, typ: string, ts: string): Promise<string | null> {
  try {
    await uploadFileNeu(pfad, bytes, typ);
    return null;
  } catch (err) {
    if (!(err instanceof DateiExistiertFehler)) throw err;
  }
  const name = pfad.slice(pfad.lastIndexOf('/') + 1);
  if (await pfadIstArchiviert(db, pfad)) {
    throw new HttpError(409, `${name} gehört bereits zu einer archivierten E-Rechnung und wird nicht ersetzt.`);
  }
  const alt = await downloadFile(pfad);
  if (sha256Hex(alt.bytes) === sha256Hex(bytes)) {
    return `${name}: identische Datei aus einem früheren Versuch übernommen`;
  }
  const neu = verworfenName(pfad, ts);
  await renameItem(pfad, neu);
  await uploadFileNeu(pfad, bytes, typ);
  return `${name}: nie gültig gewordene Datei aus einem früheren Versuch beiseitegelegt als ${neu}`;
}

async function ablegenBucket(db: SupabaseClient, pfad: string, bytes: Uint8Array, typ: string, ts: string): Promise<string | null> {
  const eimer = db.storage.from('erechnung');
  const up = await eimer.upload(pfad, bytes, { contentType: typ, upsert: false });
  if (!up.error) return null;
  const alt = await eimer.download(pfad);
  if (alt.error || !alt.data) {
    throw new HttpError(500, `Zweitablage (Supabase) fehlgeschlagen: ${up.error.message}`);
  }
  const altBytes = new Uint8Array(await alt.data.arrayBuffer());
  if (sha256Hex(altBytes) === sha256Hex(bytes)) return `Zweitablage ${pfad}: identische Datei übernommen`;
  const neu = `${pfad.slice(0, pfad.lastIndexOf('/') + 1)}${verworfenName(pfad, ts)}`;
  const mv = await eimer.move(pfad, neu);
  if (mv.error) throw new HttpError(500, `Zweitablage (Supabase): ${mv.error.message}`);
  const up2 = await eimer.upload(pfad, bytes, { contentType: typ, upsert: false });
  if (up2.error) throw new HttpError(500, `Zweitablage (Supabase) fehlgeschlagen: ${up2.error.message}`);
  return `Zweitablage ${pfad}: frühere Datei beiseitegelegt als ${neu}`;
}

export async function archiviereERechnung(e: ArchivEingabe): Promise<Record<string, unknown>> {
  const db = adminClient();
  const tabelle = e.beleg === 'rechnung' ? 'rechnungen' : 'gutschriften';
  const nrSpalte = e.beleg === 'rechnung' ? 'rechnungsnummer' : 'gutschrift_nr';
  const idSpalte = e.beleg === 'rechnung' ? 'rechnung_id' : 'gutschrift_id';
  const { data: b, error } = await db.from(tabelle).select('*').eq('id', e.id).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!b) throw new HttpError(404, 'Beleg nicht gefunden');
  const beleg = b as Record<string, unknown>;

  if (e.beleg === 'rechnung' && !['offen', 'bezahlt'].includes(String(beleg.status))) {
    throw new HttpError(409, `Rechnung ist im Status „${String(beleg.status)}" — E-Rechnung nur für erstellte Rechnungen.`);
  }
  if (e.beleg === 'gutschrift') {
    if (beleg.status !== 'final') throw new HttpError(409, 'Gutschrift ist noch ein Entwurf.');
    if (!['storno', 'teilgutschrift'].includes(String(beleg.art))) throw new HttpError(409, 'Nur Storno/Teilgutschrift als E-Rechnung.');
  }
  const format = String(beleg.erechnung_format ?? '');
  if (!FORMATE.has(format)) throw new HttpError(409, `Empfänger-Format „${format || 'pdf'}" ist keine E-Rechnung.`);
  const zugferd = format === 'zugferd';

  // Schon archiviert? Dann niemals ersetzen und keine zweite Fassung.
  const { count, error: cErr } = await db.from('erechnung_dokumente').select('id', { count: 'exact', head: true }).eq(idSpalte, e.id);
  if (cErr) throw new HttpError(500, cErr.message);
  if ((count ?? 0) > 0) {
    throw new HttpError(409, 'ERECHNUNG_BEREITS_ARCHIVIERT: Zu diesem Beleg ist bereits eine E-Rechnung archiviert — sie wird nicht ersetzt.');
  }

  if (e.pdf.byteLength < 100 || new TextDecoder().decode(e.pdf.subarray(0, 5)) !== '%PDF-') {
    throw new HttpError(400, 'PDF fehlt oder ist keine PDF-Datei.');
  }
  let xml: Uint8Array;
  if (zugferd) {
    const eingebettet = await eingebettetesXml(e.pdf).catch(() => null);
    if (!eingebettet) throw new HttpError(400, `ZUGFeRD-PDF ohne eingebettete ${ZUGFERD_DATEINAME}.`);
    xml = eingebettet;
  } else {
    if (!e.xml || e.xml.byteLength === 0) throw new HttpError(400, 'XML fehlt.');
    xml = e.xml;
  }
  const kopf = xmlKopf(new TextDecoder().decode(xml));
  const nummer = String(beleg[nrSpalte] ?? '');
  if (kopf.nummer !== nummer) throw new HttpError(400, `XML gehört nicht zu diesem Beleg (XML: ${kopf.nummer ?? '—'}, Beleg: ${nummer}).`);
  if (!kopf.typCode) throw new HttpError(400, 'XML ohne Dokumentart (TypeCode).');

  const jahr = String(beleg.datum ?? '').slice(0, 4) || String(new Date().getFullYear());
  const basis = sicheresPfadSegment(nummer, 'Beleg');
  const xmlPfad = zugferd ? null : `${ARCHIV_ROOT}/${jahr}/${basis}.xml`;
  const pdfPfad = `${ARCHIV_ROOT}/${jahr}/${basis}.pdf`;
  // Zweitkopie: die maßgebliche Datei (XML bzw. bei ZUGFeRD das PDF).
  const bucketPfad = zugferd ? `${jahr}/${basis}.pdf` : `${jahr}/${basis}.xml`;
  const ts = zeitstempel();

  const vermerke: string[] = [];
  const merke = (v: string | null) => { if (v) vermerke.push(v); };
  try {
    if (xmlPfad) merke(await ablegenOneDrive(db, xmlPfad, xml, 'application/xml', ts));
    merke(await ablegenOneDrive(db, pdfPfad, e.pdf, 'application/pdf', ts));
    merke(zugferd
      ? await ablegenBucket(db, bucketPfad, e.pdf, 'application/pdf', ts)
      : await ablegenBucket(db, bucketPfad, xml, 'application/xml', ts));
  } catch (err) {
    if (err instanceof DateiExistiertFehler) {
      throw new HttpError(409, `${err.message} — Abbruch, es wurde nichts überschrieben. Bitte erneut versuchen.`);
    }
    throw err;
  }

  const { data: u } = await db.from('app_users').select('vorname, nachname, email').eq('id', e.userId).maybeSingle();
  const name = u ? ([u.vorname, u.nachname].filter(Boolean).join(' ') || u.email) : null;
  const { data: row, error: iErr } = await db.from('erechnung_dokumente').insert({
    [idSpalte]: e.id, version: 1, format, typ_code: kopf.typCode, belegnummer: nummer,
    xml_pfad: xmlPfad, pdf_pfad: pdfPfad, bucket_pfad: bucketPfad,
    sha256_xml: sha256Hex(xml), sha256_pdf: sha256Hex(e.pdf), xml_bytes: xml.byteLength, pdf_bytes: e.pdf.byteLength,
    erzeugt_von: e.userId, erzeugt_von_name: name,
    // Spalte erst ab Migration 117 — nur mitschicken, wenn es etwas zu vermerken gibt.
    ...(vermerke.length ? { protokoll: vermerke.join('; ') } : {}),
  }).select('*').single();
  if (iErr) {
    const doppelt = /duplicate key|23505/i.test(iErr.message);
    throw new HttpError(doppelt ? 409 : 500, doppelt
      ? 'ERECHNUNG_BEREITS_ARCHIVIERT: Zu diesem Beleg ist bereits eine E-Rechnung archiviert — sie wird nicht ersetzt.'
      : `Archiv-Eintrag fehlgeschlagen: ${iErr.message}. Die Dateien liegen bereits im Archiv und werden beim nächsten Versuch übernommen.`);
  }
  return row as Record<string, unknown>;
}
