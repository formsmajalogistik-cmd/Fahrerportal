// Zustand des PDF-Auftrags an der Eingangs-Karte (Migration 104):
//   * läuft hier       → „PDFs werden erzeugt … 3 von 5 — bitte Tab geöffnet lassen"
//   * läuft woanders   → Hinweis, kein zweiter Start
//   * unvollständig    → „PDF-Erzeugung unvollständig (2 von 5) — fortsetzen"
//   * fertig           → nichts (die PDFs stehen darunter)

import { beanspruchungAbgelaufen, fortschritt, type PdfJob } from '../../lib/pdfJobLogik';

interface Props {
  job: PdfJob;
  laeuftHier: boolean;
  onFortsetzen: (neu: boolean) => void;
}

export function PdfJobHinweis({ job, laeuftHier, onFortsetzen }: Props) {
  if (job.status === 'fertig' || job.status === 'verworfen') return null;
  const { fertig, gesamt } = fortschritt(job);
  const anteil = gesamt > 0 ? Math.round((fertig / gesamt) * 100) : 0;
  const fehler = job.teile.filter((t) => t.status === 'fehler');
  const gesamtFehler = job.gesamt?.status === 'fehler' ? job.gesamt.fehler : null;

  if (laeuftHier) {
    return (
      <div role="status" className="mt-3 rounded-lg border border-maja-accent/30 bg-maja-light/60 px-3 py-2 text-xs text-maja-ink">
        <div className="font-semibold text-maja-navy">PDFs werden erzeugt … {fertig} von {gesamt}</div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white">
          <div className="h-full bg-maja-accent transition-all" style={{ width: `${anteil}%` }} />
        </div>
        <div className="mt-1 text-maja-muted">Bitte diesen Tab geöffnet lassen.</div>
      </div>
    );
  }

  const woanders = job.status === 'laeuft' && !beanspruchungAbgelaufen(job);
  if (woanders) {
    return (
      <div role="status" className="mt-3 rounded-lg bg-maja-light/60 px-3 py-2 text-xs text-maja-ink">
        PDF-Erzeugung läuft gerade in einem anderen Tab ({fertig} von {gesamt}).
      </div>
    );
  }

  return (
    <div role="alert" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <div className="font-semibold">
        PDF-Erzeugung {job.status === 'fehlgeschlagen' ? 'fehlgeschlagen' : 'unvollständig'} ({fertig} von {gesamt})
      </div>
      {(fehler.length > 0 || gesamtFehler) && (
        <ul className="mt-1 space-y-0.5">
          {fehler.map((t) => <li key={t.pdf_id}>{t.name}: {t.fehler ?? 'Fehler'}</li>)}
          {gesamtFehler && <li>Gesamt-PDF: {gesamtFehler}</li>}
        </ul>
      )}
      <div className="mt-1.5 flex flex-wrap gap-3">
        <button type="button" className="font-semibold text-maja-accent hover:underline" onClick={() => onFortsetzen(false)}>
          {job.status === 'fehlgeschlagen' ? 'Erneut versuchen' : 'Fortsetzen'}
        </button>
        <button type="button" className="text-maja-muted hover:underline" onClick={() => onFortsetzen(true)}>
          komplett neu erzeugen
        </button>
      </div>
    </div>
  );
}
