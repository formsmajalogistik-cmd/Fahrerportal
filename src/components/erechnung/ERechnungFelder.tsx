// Eingabeblock „E-Rechnung (Vorbereitung)" für Rechnungsempfänger
// (Auftraggeber, manuelle Empfänger). Es wird noch nichts als
// E-Rechnung versendet — wählbar ist nur „PDF (wie bisher)".

import { ERECHNUNG_FORMATE, LAENDER, type ERechnungFormat } from '../../lib/erechnung/stammdaten';

export interface ERechnungFelderWert {
  landCode: string;
  format: ERechnungFormat;
  email: string;
  referenz: string;
}

interface Props {
  wert: ERechnungFelderWert;
  onChange: (w: ERechnungFelderWert) => void;
  idPrefix: string;
  /** Ländercode-Feld anzeigen (bei Auftraggebern/manuellen Empfängern ja). */
  mitLand?: boolean;
}

export function ERechnungFelder({ wert, onChange, idPrefix, mitLand = true }: Props) {
  const patch = (p: Partial<ERechnungFelderWert>) => onChange({ ...wert, ...p });
  const landUngueltig = wert.landCode.trim() !== '' && !/^[A-Za-z]{2}$/.test(wert.landCode.trim());
  const xr = wert.format === 'xrechnung_cii';
  const zugferd = wert.format === 'zugferd';
  const eRechnung = wert.format === 'xrechnung_cii' || wert.format === 'en16931_cii' || zugferd;
  // XRechnung: E-Rechnungs-Adresse und Käuferreferenz sind Pflicht.
  const pflichtFehlt = [
    xr && !wert.email.trim() && 'E-Rechnungs-Adresse',
    xr && !wert.referenz.trim() && 'Käuferreferenz / Leitweg-ID',
    eRechnung && mitLand && !wert.landCode.trim() && 'Ländercode',
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-3 rounded-lg border border-maja-navy/10 p-4" data-testid={`${idPrefix}-erechnung`}>
      <div>
        <h3 className="text-sm font-semibold text-maja-navy">E-Rechnung (Vorbereitung)</h3>
        <p className="text-xs text-maja-muted">
          {zugferd
            ? 'Beim Erstellen einer Rechnung wird EIN ZUGFeRD-PDF (PDF/A-3 mit eingebettetem XML, maßgeblich sind die XML-Daten) erzeugt, archiviert und an die E-Rechnungs-Adresse versendet (leer = bisherige Rechnungs-E-Mail).'
            : eRechnung
            ? 'Beim Erstellen einer Rechnung werden XML (maßgeblich) und PDF-Lesekopie erzeugt, archiviert und an die E-Rechnungs-Adresse versendet (leer = bisherige Rechnungs-E-Mail).'
            : 'Rechnungen werden wie bisher als PDF erstellt und versendet.'}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${idPrefix}-format`} className="label">Rechnungsformat</label>
          <select id={`${idPrefix}-format`} className="input" value={wert.format}
                  onChange={(e) => patch({ format: e.target.value as ERechnungFormat })}>
            {ERECHNUNG_FORMATE.map((f) => (
              <option key={f.wert} value={f.wert} disabled={!f.aktiv}>
                {f.label}{f.aktiv ? '' : ' — folgt'}
              </option>
            ))}
          </select>
        </div>
        {mitLand && (
          <div>
            <label htmlFor={`${idPrefix}-land-code`} className="label">Ländercode (ISO)</label>
            <input id={`${idPrefix}-land-code`} className="input uppercase" maxLength={2}
                   list={`${idPrefix}-laender`} placeholder="DE"
                   aria-invalid={landUngueltig || undefined}
                   value={wert.landCode}
                   onChange={(e) => patch({ landCode: e.target.value.toUpperCase() })} />
            <datalist id={`${idPrefix}-laender`}>
              {LAENDER.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </datalist>
            {landUngueltig && (
              <p className="mt-1 text-xs text-red-700">Zwei Buchstaben, z.B. DE, AT, NL.</p>
            )}
          </div>
        )}
        <div>
          <label htmlFor={`${idPrefix}-erech-email`} className="label">E-Rechnungs-Adresse{xr ? ' *' : ''}</label>
          <input id={`${idPrefix}-erech-email`} type="email" className="input"
                 placeholder="z.B. rechnungseingang@kunde.de"
                 value={wert.email} onChange={(e) => patch({ email: e.target.value })} />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-referenz`} className="label">Käuferreferenz / Leitweg-ID{xr ? ' *' : ''}</label>
          <input id={`${idPrefix}-referenz`} className="input"
                 placeholder="vom Kunden vorgegeben"
                 value={wert.referenz} onChange={(e) => patch({ referenz: e.target.value })} />
        </div>
      </div>
      {pflichtFehlt.length > 0 && (
        <p role="alert" className="text-xs font-medium text-red-700 dark:!text-red-300">
          Für {xr ? 'XRechnung' : 'die E-Rechnung'} fehlt noch: {pflichtFehlt.join(', ')} — ohne diese Angaben kann keine Rechnung erstellt werden.
        </p>
      )}
    </div>
  );
}
