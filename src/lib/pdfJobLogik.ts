// Job-Modell der PDF-Erzeugung — reine Regeln (testbar, ohne IO).
// Der Ablauf mit Datenbank, Uploads und Tab-Beanspruchung steht in
// lib/pdfJobs.ts; Tabelle und RPCs in Migration 104.

export type TeilStatus = 'offen' | 'fertig' | 'uebersprungen' | 'fehler';
export type JobStatus = 'laeuft' | 'teilweise' | 'fertig' | 'fehlgeschlagen' | 'verworfen';

export interface JobTeil {
  pdf_id: string;
  name: string;
  status: TeilStatus;
  filename?: string | null;
  onedrive_path?: string | null;
  fehler?: string | null;
  grund?: string | null;
}

export interface GesamtTeil {
  status: 'offen' | 'fertig' | 'fehler';
  filename?: string | null;
  onedrive_path?: string | null;
  fehler?: string | null;
}

export interface PdfJob {
  id: string;
  formular_id: string;
  status: JobStatus;
  teile: JobTeil[];
  zusammenfuehren: boolean;
  gesamt: GesamtTeil | null;
  halter: string | null;
  lease_bis: string | null;
  gestartet_am: string;
  aktualisiert_am: string;
  fehler: string | null;
}

/** Teile, die (noch) erzeugt werden müssen — offen oder beim letzten Mal gescheitert. */
export function fehlendeTeile(teile: JobTeil[]): JobTeil[] {
  return teile.filter((t) => t.status === 'offen' || t.status === 'fehler');
}

/** Alle zu erzeugenden Einzelteile fertig? (Übersprungene zählen nicht.) */
export function alleTeileFertig(teile: JobTeil[]): boolean {
  return teile.every((t) => t.status === 'fertig' || t.status === 'uebersprungen');
}

/**
 * Fortschritt für die Anzeige („3 von 5"). Im Merge-Modus zählt die
 * Gesamt-PDF als eigener, letzter Schritt.
 */
export function fortschritt(job: Pick<PdfJob, 'teile' | 'zusammenfuehren' | 'gesamt'>): { fertig: number; gesamt: number } {
  const relevant = job.teile.filter((t) => t.status !== 'uebersprungen');
  let gesamt = relevant.length;
  let fertig = relevant.filter((t) => t.status === 'fertig').length;
  if (job.zusammenfuehren && relevant.length > 0) {
    gesamt += 1;
    if (job.gesamt?.status === 'fertig') fertig += 1;
  }
  return { fertig, gesamt };
}

/** Vollständig = alle Teile fertig und (im Merge-Modus) die Gesamt-PDF hochgeladen. */
export function istVollstaendig(job: Pick<PdfJob, 'teile' | 'zusammenfuehren' | 'gesamt'>): boolean {
  if (!alleTeileFertig(job.teile)) return false;
  const relevant = job.teile.filter((t) => t.status !== 'uebersprungen');
  if (job.zusammenfuehren && relevant.length > 0) return job.gesamt?.status === 'fertig';
  return true;
}

/**
 * Status nach einem Durchlauf. Nie einen Teilstand als `fertig`:
 *   * alles da                         → fertig
 *   * etwas da, etwas fehlt            → teilweise (fortsetzbar)
 *   * nichts geschafft (alles gescheitert) → fehlgeschlagen
 */
export function endStatus(job: Pick<PdfJob, 'teile' | 'zusammenfuehren' | 'gesamt'>): JobStatus {
  if (istVollstaendig(job)) return 'fertig';
  const relevant = job.teile.filter((t) => t.status !== 'uebersprungen');
  const irgendwas = relevant.some((t) => t.status === 'fertig');
  return irgendwas ? 'teilweise' : 'fehlgeschlagen';
}

/** Ist die Beanspruchung (laut Uhr des Browsers) abgelaufen? Nur für die Anzeige. */
export function beanspruchungAbgelaufen(job: Pick<PdfJob, 'lease_bis'>, jetzt = Date.now()): boolean {
  if (!job.lease_bis) return true;
  const t = Date.parse(job.lease_bis);
  return Number.isNaN(t) || t < jetzt;
}

/** Fehler, bei denen ein erneuter Upload-Versuch sinnvoll ist (verwaiste Session, Netz). */
export function uploadWiederholbar(fehler: unknown): boolean {
  const m = fehler instanceof Error ? fehler.message : String(fehler);
  return /\b(409|412|423|429|5\d\d)\b|nameAlreadyExists|resourceModified|Failed to fetch|NetworkError|network|abort|timeout|Zeitüberschreitung/i.test(m);
}
