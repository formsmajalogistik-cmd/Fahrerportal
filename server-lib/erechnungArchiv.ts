// E-Rechnung: Archivierung (serverseitig, Service-Rolle).
//
// Ablauf je Beleg (Rechnung oder Storno/Teilgutschrift):
//   1. Beleg prüfen (erstellt/final, E-Rechnungs-Format, XML gehört zum Beleg)
//   2. SHA-256 von XML und PDF-Lesekopie berechnen
//   3. OneDrive: Maja-Logistik/E-Rechnungen/{Jahr}/{Nummer}[_vN].xml/.pdf —
//      NIE überschreiben (conflictBehavior fail → Abbruch mit Meldung)
//   4. Kopie des XML in den privaten Supabase-Bucket 'erechnung' (upsert: false)
//   5. Eintrag in erechnung_dokumente (nur INSERT möglich)
// Schlägt ein Schritt nach einem Upload fehl, werden NUR die in diesem
// Lauf neu angelegten Dateien wieder entfernt — nie fremde/ältere.

import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from './auth.js';
import { DateiExistiertFehler, deleteFile, uploadFileNeu } from './graph.js';
import { sicheresPfadSegment } from './paths.js';

export const ARCHIV_ROOT = 'Maja-Logistik/E-Rechnungen';
const FORMATE = new Set(['en16931_cii', 'xrechnung_cii']);

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

export interface ArchivEingabe {
  beleg: 'rechnung' | 'gutschrift';
  id: string;
  xml: Uint8Array;
  pdf: Uint8Array;
  userId: string;
}

export async function archiviereERechnung(e: ArchivEingabe): Promise<Record<string, unknown>> {
  const db = adminClient();
  const tabelle = e.beleg === 'rechnung' ? 'rechnungen' : 'gutschriften';
  const nrSpalte = e.beleg === 'rechnung' ? 'rechnungsnummer' : 'gutschrift_nr';
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

  const xmlText = new TextDecoder().decode(e.xml);
  const kopf = xmlKopf(xmlText);
  const nummer = String(beleg[nrSpalte] ?? '');
  if (kopf.nummer !== nummer) throw new HttpError(400, `XML gehört nicht zu diesem Beleg (XML: ${kopf.nummer ?? '—'}, Beleg: ${nummer}).`);
  if (!kopf.typCode) throw new HttpError(400, 'XML ohne Dokumentart (TypeCode).');
  if (e.pdf.byteLength < 100 || new TextDecoder().decode(e.pdf.subarray(0, 5)) !== '%PDF-') {
    throw new HttpError(400, 'PDF-Lesekopie fehlt oder ist keine PDF-Datei.');
  }

  const idSpalte = e.beleg === 'rechnung' ? 'rechnung_id' : 'gutschrift_id';
  const { count, error: cErr } = await db.from('erechnung_dokumente').select('id', { count: 'exact', head: true }).eq(idSpalte, e.id);
  if (cErr) throw new HttpError(500, cErr.message);
  const version = (count ?? 0) + 1;

  const jahr = String(beleg.datum ?? '').slice(0, 4) || String(new Date().getFullYear());
  const basis = sicheresPfadSegment(nummer, 'Beleg') + (version > 1 ? `_v${version}` : '');
  const xmlPfad = `${ARCHIV_ROOT}/${jahr}/${basis}.xml`;
  const pdfPfad = `${ARCHIV_ROOT}/${jahr}/${basis}.pdf`;
  const bucketPfad = `${jahr}/${basis}.xml`;
  const shaXml = sha256Hex(e.xml);
  const shaPdf = sha256Hex(e.pdf);

  const angelegt: string[] = [];
  let bucketAngelegt = false;
  const aufraeumen = async () => {
    for (const p of angelegt) { try { await deleteFile(p); } catch (x) { console.error('[E-Rechnung] Aufräumen', p, x); } }
    if (bucketAngelegt) { await db.storage.from('erechnung').remove([bucketPfad]).catch(() => undefined); }
  };
  try {
    await uploadFileNeu(xmlPfad, e.xml, 'application/xml');
    angelegt.push(xmlPfad);
    await uploadFileNeu(pdfPfad, e.pdf, 'application/pdf');
    angelegt.push(pdfPfad);
    const up = await db.storage.from('erechnung').upload(bucketPfad, e.xml, { contentType: 'application/xml', upsert: false });
    if (up.error) throw new HttpError(500, `Zweitablage (Supabase) fehlgeschlagen: ${up.error.message}`);
    bucketAngelegt = true;

    const { data: u } = await db.from('app_users').select('vorname, nachname, email').eq('id', e.userId).maybeSingle();
    const name = u ? ([u.vorname, u.nachname].filter(Boolean).join(' ') || u.email) : null;
    const { data: row, error: iErr } = await db.from('erechnung_dokumente').insert({
      [idSpalte]: e.id, version, format, typ_code: kopf.typCode, belegnummer: nummer,
      xml_pfad: xmlPfad, pdf_pfad: pdfPfad, bucket_pfad: bucketPfad,
      sha256_xml: shaXml, sha256_pdf: shaPdf, xml_bytes: e.xml.byteLength, pdf_bytes: e.pdf.byteLength,
      erzeugt_von: e.userId, erzeugt_von_name: name,
    }).select('*').single();
    if (iErr) throw new HttpError(500, `Archiv-Eintrag fehlgeschlagen: ${iErr.message}`);
    return row as Record<string, unknown>;
  } catch (err) {
    await aufraeumen();
    if (err instanceof DateiExistiertFehler) {
      throw new HttpError(409, `${err.message} — Abbruch, es wurde nichts überschrieben.`);
    }
    throw err;
  }
}
