// PDF-Erzeugung als fortsetzbarer Auftrag (Migration 104).
//
// Warum: Die Erzeugung läuft im Browser. Ein Hintergrund-Tab wird
// gedrosselt oder pausiert, Netz-Anfragen brechen ab — der alte Ablauf
// endete dann an einer zufälligen Stelle und meldete trotzdem „ok".
// Hier hat jeder Teil einen eigenen Status in der Datenbank; ein
// unterbrochener Auftrag wird mit genau den fehlenden Teilen fortgesetzt.
//
// Ablauf eines Durchlaufs:
//   1. offenen Auftrag des Formulars holen (oder neu anlegen; die
//      Datenbank lässt nur EINEN offenen zu — Doppelklick = derselbe)
//   2. beanspruchen (60 s, Server-Uhr), alle 15 s verlängern
//   3. fehlende Teile erzeugen; nach JEDEM Teil den Status speichern
//      • ohne Merge: Teil direkt an den endgültigen Pfad hochladen
//      • mit Merge: Teil im Gerätespeicher ablegen (Cache Storage)
//   4. erst wenn alle Teile da sind: Gesamt-PDF zusammenführen und
//      hochladen, pdf_paths schreiben, Status `fertig`
//
// OneDrive hinterlässt bei Abbrüchen keine halben Dateien: eine Upload-
// Session legt die Datei erst mit dem letzten Stück an, der direkte
// Upload ist atomar, beide mit conflictBehavior „replace". Fehler wie ein
// 409 aus einer verwaisten Session werden einmal mit frischer Session
// wiederholt.

import { supabase } from './supabase';
import { uploadToOneDrive } from './onedrive';
import {
  formularOrdner, fuehrePdfsZusammen, fuellePdfTeil, gesamtPdfEintrag, gesamtPdfZiel,
  generatedToPdfPaths, pdfTeilZiel, planePdfTeile, prefetchFormPhotos, resetPhotoCache,
  type GeneratedPdf,
} from './pdfGenerate';
import {
  endStatus, fehlendeTeile, uploadWiederholbar, alleTeileFertig,
  type JobTeil, type PdfJob,
} from './pdfJobLogik';
import { diagnose } from './diagnose';
import type { AusgefuelltesFormular, FormularTemplate, TemplatePdf } from '../types/db';
import type { Json } from '../types/supabase';

/** Kennung dieses Tabs — wer einen Auftrag gerade bearbeitet. */
export const TAB_ID: string = (() => {
  try { if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID(); } catch { /* */ }
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
})();

const PULS_MS = 15_000;
const CACHE = 'maja-pdf-teile-v1';
const SPALTEN = 'id, formular_id, status, teile, zusammenfuehren, gesamt, halter, lease_bis, gestartet_am, aktualisiert_am, fehler';

/** Aufträge, die in DIESEM Tab gerade laufen (Formular-ID → Promise). */
const laufend = new Map<string, Promise<PdfJob>>();

/** Läufe, die unvollständig endeten, während der Tab im Hintergrund war. */
const imHintergrundUnterbrochen = new Set<string>();

export function laeuftHier(formularId: string): boolean { return laufend.has(formularId); }
/**
 * Soll bei Rückkehr in den Tab automatisch fortgesetzt werden? Nur, wenn
 * der letzte Lauf hier gestartet wurde und unvollständig endete, WÄHREND
 * der Tab (zeitweise) im Hintergrund war — ein dauerhaft kaputter Teil
 * wird so nicht bei jedem Tabwechsel erneut versucht.
 */
export function automatischFortsetzen(formularId: string): boolean {
  return imHintergrundUnterbrochen.has(formularId) && !laufend.has(formularId);
}

// Schließen/Neuladen warnen, solange in diesem Tab erzeugt wird.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (laufend.size === 0) return;
    e.preventDefault();
    e.returnValue = '';
  });
}

export class AuftragBelegtError extends Error {}

function alsJob(r: unknown): PdfJob {
  const j = r as PdfJob;
  return { ...j, teile: Array.isArray(j.teile) ? j.teile : [], gesamt: j.gesamt ?? null };
}

/** Neuester Auftrag je Formular (für die Anzeige in Eingänge). */
export async function ladeLetzteJobs(formularIds: string[]): Promise<Record<string, PdfJob>> {
  if (formularIds.length === 0) return {};
  const { data, error } = await supabase
    .from('pdf_jobs').select(SPALTEN)
    .in('formular_id', formularIds)
    .order('gestartet_am', { ascending: false });
  if (error) { console.warn('[pdfJobs] Laden fehlgeschlagen', error.message); return {}; }
  const out: Record<string, PdfJob> = {};
  for (const r of data ?? []) {
    const j = alsJob(r);
    if (!out[j.formular_id]) out[j.formular_id] = j;
  }
  return out;
}

async function offenerJob(formularId: string): Promise<PdfJob | null> {
  const { data } = await supabase.from('pdf_jobs').select(SPALTEN)
    .eq('formular_id', formularId).in('status', ['laeuft', 'teilweise']).maybeSingle();
  return data ? alsJob(data) : null;
}

async function speichern(job: PdfJob, felder: Partial<PdfJob>): Promise<boolean> {
  const { data, error } = await supabase.from('pdf_jobs')
    .update({ ...felder, aktualisiert_am: new Date().toISOString() } as never)
    .eq('id', job.id).eq('halter', TAB_ID).select('id');
  if (error) { console.warn('[pdfJobs] Speichern fehlgeschlagen', error.message); return false; }
  return (data ?? []).length > 0;
}

// ---- Zwischenablage der Teile im Merge-Modus -------------------------
const imSpeicher = new Map<string, Uint8Array>();
const teilSchluessel = (jobId: string, pdfId: string) =>
  `${location.origin}/__pdfteil__/${jobId}/${encodeURIComponent(pdfId)}`;

async function teilAblegen(jobId: string, pdfId: string, bytes: Uint8Array): Promise<void> {
  const k = teilSchluessel(jobId, pdfId);
  imSpeicher.set(k, bytes);
  try {
    const c = await caches.open(CACHE);
    await c.put(k, new Response(new Blob([bytes as unknown as ArrayBuffer], { type: 'application/pdf' })));
  } catch { /* Gerätespeicher nicht verfügbar — Speicher-Kopie reicht für diesen Tab */ }
}

async function teilHolen(jobId: string, pdfId: string): Promise<Uint8Array | null> {
  const k = teilSchluessel(jobId, pdfId);
  const m = imSpeicher.get(k);
  if (m) return m;
  try {
    const c = await caches.open(CACHE);
    const r = await c.match(k);
    if (r) return new Uint8Array(await r.arrayBuffer());
  } catch { /* */ }
  return null;
}

async function teileAufraeumen(jobId: string): Promise<void> {
  for (const k of [...imSpeicher.keys()]) if (k.includes(`/__pdfteil__/${jobId}/`)) imSpeicher.delete(k);
  try {
    const c = await caches.open(CACHE);
    for (const req of await c.keys()) if (req.url.includes(`/__pdfteil__/${jobId}/`)) await c.delete(req);
  } catch { /* */ }
}

// ---- Upload mit Wiederholung -----------------------------------------
async function hochladen(pfad: string, bytes: Uint8Array): Promise<void> {
  const blob = new Blob([bytes as unknown as ArrayBuffer], { type: 'application/pdf' });
  let letzter: unknown = null;
  for (let versuch = 0; versuch < 3; versuch += 1) {
    try {
      await uploadToOneDrive(pfad, blob);
      return;
    } catch (err) {
      letzter = err;
      if (!uploadWiederholbar(err) || versuch === 2) break;
      // Neue Upload-Session beim nächsten Versuch (uploadToOneDrive holt
      // sie jedes Mal frisch) — eine verwaiste Session wird so nicht
      // weiterverwendet.
      await new Promise((r) => window.setTimeout(r, 1500 * (versuch + 1)));
    }
  }
  throw letzter instanceof Error ? letzter : new Error(String(letzter));
}

/**
 * Startet die PDF-Erzeugung für ein Formular oder setzt einen offenen
 * Auftrag fort. `neu: true` verwirft einen offenen Auftrag und beginnt von
 * vorn. Ein zweiter Aufruf, solange dieser Tab schon arbeitet, liefert
 * denselben Ablauf (kein Doppelstart).
 */
export function pdfJobStarten(args: {
  template: FormularTemplate;
  formular: AusgefuelltesFormular;
  neu?: boolean;
  onUpdate?: (job: PdfJob) => void;
}): Promise<PdfJob> {
  const vorhanden = laufend.get(args.formular.id);
  if (vorhanden) return vorhanden;
  imHintergrundUnterbrochen.delete(args.formular.id);
  const p = ablauf(args).finally(() => laufend.delete(args.formular.id));
  laufend.set(args.formular.id, p);
  return p;
}

async function ablauf({ template, formular, neu, onUpdate }: {
  template: FormularTemplate; formular: AusgefuelltesFormular; neu?: boolean; onUpdate?: (job: PdfJob) => void;
}): Promise<PdfJob> {
  const merge = !!template.pdfs_zusammenfuehren;
  let job = await offenerJob(formular.id);
  if (job && neu) {
    // „Komplett neu": den offenen Auftrag verwerfen — nur, wenn ihn nicht
    // gerade ein anderer Tab hält (sonst liefen zwei Erzeugungen parallel).
    const { data: frei } = await supabase.rpc('pdf_job_beanspruchen', { p_job: job.id, p_halter: TAB_ID });
    if (!frei) throw new AuftragBelegtError('Die PDF-Erzeugung läuft gerade in einem anderen Tab.');
    await supabase.from('pdf_jobs').update({ status: 'verworfen', halter: null, lease_bis: null }).eq('id', job.id);
    await teileAufraeumen(job.id);
    job = null;
  }

  if (!job) {
    const teile: JobTeil[] = planePdfTeile(template, formular).map((t) => ({
      pdf_id: t.pdf.id, name: t.pdf.name, status: t.status, grund: t.grund ?? null,
    }));
    const { data, error } = await supabase.from('pdf_jobs').insert({
      formular_id: formular.id, status: 'teilweise', teile: teile as unknown as Json,
      zusammenfuehren: merge, gesamt: merge ? { status: 'offen' } : null,
    }).select(SPALTEN).single();
    if (error) {
      // 23505 = schon ein offener Auftrag (Doppelklick in einem anderen
      // Tab o.ä.) — den nehmen statt einen zweiten anzulegen.
      if (error.code !== '23505') throw new Error(`Auftrag anlegen fehlgeschlagen: ${error.message}`);
      job = await offenerJob(formular.id);
      if (!job) throw new Error('Auftrag konnte nicht angelegt werden.');
    } else {
      job = alsJob(data);
    }
  }

  const { data: beansprucht, error: bErr } = await supabase.rpc('pdf_job_beanspruchen', { p_job: job.id, p_halter: TAB_ID });
  if (bErr) throw new Error(`Auftrag beanspruchen fehlgeschlagen: ${bErr.message}`);
  if (!beansprucht) throw new AuftragBelegtError('Die PDF-Erzeugung läuft gerade in einem anderen Tab.');
  job = { ...job, status: 'laeuft', halter: TAB_ID };
  onUpdate?.(job);
  diagnose('pdf_job_start', { formular: formular.id, fehlend: fehlendeTeile(job.teile).length, merge }, 'pdf');

  let verloren = false;
  // Lag der Tab während dieses Laufs (zeitweise) im Hintergrund?
  let warVersteckt = document.hidden;
  const merkeVersteckt = () => { if (document.hidden) warVersteckt = true; };
  document.addEventListener('visibilitychange', merkeVersteckt);
  const puls = window.setInterval(() => {
    void supabase.rpc('pdf_job_puls', { p_job: job!.id, p_halter: TAB_ID }).then(({ data }) => {
      if (data === false) verloren = true;
    });
  }, PULS_MS);

  try {
    const folder = formularOrdner(template, formular);
    const vorlagen = new Map((template.pdfs ?? []).map((p) => [p.id, p]));
    resetPhotoCache();
    await prefetchFormPhotos(formular.daten, formular.id);

    let teile = [...job.teile];
    for (const teil of fehlendeTeile(teile)) {
      if (verloren) break;
      const tplPdf = vorlagen.get(teil.pdf_id);
      let neuerTeil: JobTeil;
      try {
        if (!tplPdf) throw new Error('PDF-Vorlage gibt es im Template nicht mehr');
        const t0 = performance.now();
        const bytes = await fuellePdfTeil(template, formular, tplPdf);
        if (merge) {
          await teilAblegen(job.id, teil.pdf_id, bytes);
          neuerTeil = { ...teil, status: 'fertig', fehler: null };
        } else {
          const ziel = pdfTeilZiel(folder, tplPdf, formular.daten);
          await hochladen(ziel.onedrive_path, bytes);
          neuerTeil = { ...teil, status: 'fertig', fehler: null, ...ziel };
        }
        diagnose('pdf_teil_fertig', { formular: formular.id, teil: teil.pdf_id, ms: Math.round(performance.now() - t0), kb: Math.round(bytes.length / 1024), versteckt: document.hidden }, 'pdf');
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        neuerTeil = { ...teil, status: 'fehler', fehler: text.slice(0, 300) };
        diagnose('pdf_teil_fehler', { formular: formular.id, teil: teil.pdf_id, fehler: text, versteckt: document.hidden }, 'pdf');
      }
      teile = teile.map((t) => (t.pdf_id === teil.pdf_id ? neuerTeil : t));
      job = { ...job, teile };
      if (!(await speichern(job, { teile } as Partial<PdfJob>))) { verloren = true; break; }
      onUpdate?.(job);
    }

    let gesamt = job.gesamt;
    if (!verloren && merge && alleTeileFertig(teile)) {
      try {
        const reihenfolge = (template.pdfs ?? []).filter((p) => teile.some((t) => t.pdf_id === p.id && t.status === 'fertig'));
        const bytesListe: Uint8Array[] = [];
        for (const p of reihenfolge) {
          // Liegt ein Teil nicht mehr im Gerätespeicher (anderes Gerät,
          // Speicher geleert), wird genau dieser eine neu erzeugt.
          let b = await teilHolen(job.id, p.id);
          if (!b) {
            diagnose('pdf_teil_neu_fuer_merge', { formular: formular.id, teil: p.id }, 'pdf');
            b = await fuellePdfTeil(template, formular, p);
          }
          bytesListe.push(b);
        }
        const erste: TemplatePdf = reihenfolge[0];
        const ziel = gesamtPdfZiel(folder, erste, formular.daten);
        await hochladen(ziel.onedrive_path, await fuehrePdfsZusammen(bytesListe));
        gesamt = { status: 'fertig', ...ziel, fehler: null };
      } catch (err) {
        gesamt = { status: 'fehler', fehler: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
      }
      job = { ...job, gesamt };
    }

    if (verloren) {
      diagnose('pdf_job_verloren', { formular: formular.id }, 'pdf');
      return job;
    }

    const status = endStatus(job);
    if (status !== 'fertig' && warVersteckt) imHintergrundUnterbrochen.add(formular.id);
    if (status === 'fertig') {
      // Erst jetzt — vollständig — die Liste der PDFs am Formular setzen.
      const erzeugt: GeneratedPdf[] = merge && gesamt?.onedrive_path
        ? [{ pdf: gesamtPdfEintrag((template.pdfs ?? []).find((p) => teile.some((t) => t.pdf_id === p.id && t.status === 'fertig'))!), filename: gesamt.filename!, onedrive_path: gesamt.onedrive_path }]
        : (template.pdfs ?? []).flatMap((p) => {
            const t = teile.find((x) => x.pdf_id === p.id && x.status === 'fertig');
            return t?.onedrive_path ? [{ pdf: p, filename: t.filename!, onedrive_path: t.onedrive_path }] : [];
          });
      await supabase.from('ausgefuellte_formulare')
        .update({ pdf_paths: generatedToPdfPaths(erzeugt) as unknown as Json, pdf_status: 'ok', pdf_fehler: null })
        .eq('id', formular.id);
      await teileAufraeumen(job.id);
    }
    job = { ...job, status, halter: null, lease_bis: null };
    await speichern(job, { status, gesamt, teile, halter: null, lease_bis: null } as Partial<PdfJob>);
    diagnose('pdf_job_ende', { formular: formular.id, status, versteckt: document.hidden }, 'pdf');
    onUpdate?.(job);
    return job;
  } finally {
    window.clearInterval(puls);
    document.removeEventListener('visibilitychange', merkeVersteckt);
  }
}
