// Abschnitt „E-Rechnung" an Rechnung bzw. Storno/Teilgutschrift:
//   * erstellt: archivierte Fassung(en) mit Format, Typ-Code, SHA-256 und
//     Zugriff auf XML (maßgeblich) und PDF-Lesekopie
//   * Entwurf: Ergebnis der Vorprüfung (Fehler blockieren das Erstellen)

import { useState } from 'react';
import { previewOneDrivePdf, triggerOneDriveDownload, type ERechnungDokument } from '../../lib/onedrive';
import { ERECHNUNG_FORMATE } from '../../lib/erechnung/stammdaten';
import type { Vorpruefung } from '../../lib/erechnung/erstellen';
import type { Mangel } from '../../lib/erechnung/pruefung';

const formatLabel = (f: string) => ERECHNUNG_FORMATE.find((x) => x.wert === f)?.label ?? f;
const zeit = (iso: string) => new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });

const STUFE: Record<Mangel['schwere'], { label: string; cls: string }> = {
  fehler: { label: 'Fehlt / ungültig', cls: 'text-red-700 dark:!text-red-300' },
  warnung: { label: 'Bitte prüfen', cls: 'text-amber-700 dark:!text-amber-300' },
  hinweis: { label: 'Hinweis', cls: 'text-maja-muted' },
};

export function MaengelListe({ maengel }: { maengel: Mangel[] }) {
  if (!maengel.length) return null;
  return (
    <ul className="space-y-1 text-sm" aria-label="Prüfergebnis E-Rechnung">
      {(['fehler', 'warnung', 'hinweis'] as const).flatMap((st) => maengel.filter((m) => m.schwere === st).map((m, i) => (
        <li key={`${st}-${i}`} className={STUFE[st].cls}>
          <span className="font-medium">{STUFE[st].label}:</span> {m.text}
          <span className="ml-1 text-xs text-maja-muted">({m.bt})</span>
        </li>
      )))}
    </ul>
  );
}

export function ERechnungAbschnitt({
  dokumente, vorpruefung, format, onErzeugen, erzeugenBusy,
}: {
  dokumente: ERechnungDokument[];
  /** Nur im Entwurf: Ergebnis der Vorprüfung. */
  vorpruefung?: Vorpruefung | null;
  /** Format des Empfängers (zur Anzeige, wenn noch nichts erzeugt ist). */
  format?: string | null;
  /** „E-Rechnung erzeugen" (nur wenn erlaubt, z.B. Storno ohne E-Rechnung). */
  onErzeugen?: () => void;
  erzeugenBusy?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!dokumente.length && !vorpruefung && !onErzeugen) return null;
  const fehler = vorpruefung ? vorpruefung.maengel.filter((m) => m.schwere === 'fehler').length : 0;

  async function oeffne(d: ERechnungDokument, art: 'xml' | 'pdf') {
    setBusy(`${d.id}-${art}`);
    try {
      if (art === 'pdf') await previewOneDrivePdf(d.pdf_pfad, { filename: d.pdf_pfad.split('/').pop() });
      else if (d.xml_pfad) await triggerOneDriveDownload(d.xml_pfad, d.xml_pfad.split('/').pop() ?? 'rechnung.xml');
      else await triggerOneDriveDownload(d.pdf_pfad, d.pdf_pfad.split('/').pop() ?? 'rechnung.pdf');
    } finally { setBusy(null); }
  }

  return (
    <section className="card space-y-3 p-5" data-testid="erechnung-abschnitt">
      <h2 className="text-base font-semibold text-maja-navy">E-Rechnung</h2>
      {dokumente.length > 0 ? (
        <ul className="space-y-3">
          {dokumente.map((d) => (
            <li key={d.id} className="rounded-md border border-maja-navy/10 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-maja-ink">
                  {formatLabel(d.format)} · Typ {d.typ_code}{d.version > 1 ? ` · Version ${d.version}` : ''}
                </span>
                <span className="flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary px-3 py-1 text-xs" disabled={busy !== null}
                          onClick={() => void oeffne(d, 'xml')}>
                    {d.xml_pfad ? 'XML herunterladen (maßgeblich)' : 'ZUGFeRD-PDF herunterladen (maßgeblich)'}
                  </button>
                  <button type="button" className="btn-secondary px-3 py-1 text-xs" disabled={busy !== null}
                          onClick={() => void oeffne(d, 'pdf')}>{d.xml_pfad ? 'PDF-Lesekopie ansehen' : 'ZUGFeRD-PDF ansehen'}</button>
                </span>
              </div>
              <p className="mt-1 text-xs text-maja-muted">
                Erzeugt am {zeit(d.erzeugt_am)}{d.erzeugt_von_name ? ` von ${d.erzeugt_von_name}` : ''} · archiviert unter {d.xml_pfad ?? d.pdf_pfad}
              </p>
              <p className="mt-0.5 break-all font-mono text-[11px] text-maja-muted" title={d.xml_pfad ? 'SHA-256 der XML-Datei' : 'SHA-256 der ZUGFeRD-Datei (PDF)'}>
                {d.xml_pfad ? `SHA-256 (XML): ${d.sha256_xml}` : `SHA-256 (PDF): ${d.sha256_pdf}`}
              </p>
              {d.protokoll && <p className="mt-0.5 text-xs text-amber-700 dark:!text-amber-300">Vermerk: {d.protokoll}</p>}
            </li>
          ))}
        </ul>
      ) : vorpruefung ? (
        <div className="space-y-2">
          <p className="text-sm text-maja-ink">
            Empfänger-Format: <strong>{formatLabel(vorpruefung.format)}</strong>. Beim Erstellen werden XML und
            PDF-Lesekopie erzeugt und unveränderlich archiviert.
          </p>
          {vorpruefung.abbruch ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:!bg-red-900/40 dark:!text-red-200">{vorpruefung.abbruch}</p>
          ) : fehler > 0 ? (
            <p className="text-sm font-medium text-red-700 dark:!text-red-300">
              {fehler} {fehler === 1 ? 'Angabe fehlt' : 'Angaben fehlen'} — „Rechnung erstellen" ist erst danach möglich.
            </p>
          ) : (
            <p className="text-sm text-emerald-700 dark:!text-emerald-300">Alle Pflichtangaben vorhanden.</p>
          )}
          <MaengelListe maengel={vorpruefung.maengel} />
        </div>
      ) : (
        <p className="text-sm text-maja-muted">
          Noch keine E-Rechnung archiviert{format ? ` (Format: ${formatLabel(format)})` : ''}.
        </p>
      )}
      {onErzeugen && dokumente.length === 0 && (
        <button type="button" className="btn-primary text-sm" disabled={erzeugenBusy} onClick={onErzeugen}>
          {erzeugenBusy ? 'Erzeuge …' : 'E-Rechnung erzeugen'}
        </button>
      )}
    </section>
  );
}
