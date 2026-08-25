// Schalter „Unterschrift einfügen" / „Firmenstempel einfügen"
// (Migration 092) — je Dokument, für Briefe, Rechnungen und
// Gutschriften gleich.
//
// Ist im Profil nichts hinterlegt, sind die Schalter wirkungslos und
// deshalb deaktiviert; das Dokument sieht dann aus wie bisher.

import type { AbsenderSignatur } from '../lib/absenderSignatur';

interface Props {
  /** Signatur-Zeile des eingeloggten Admins; null = nichts hinterlegt. */
  signatur: AbsenderSignatur | null;
  mitUnterschrift: boolean;
  mitStempel: boolean;
  onChange: (patch: { mitUnterschrift?: boolean; mitStempel?: boolean }) => void;
  disabled?: boolean;
  /** Wo die Bilder landen — nur für den Hinweistext. */
  zielBeschreibung?: string;
}

export function AbsenderSignaturSchalter({
  signatur, mitUnterschrift, mitStempel, onChange, disabled,
  zielBeschreibung = 'in den Unterschriftsbereich',
}: Props) {
  const hatEtwas = !!(signatur?.unterschrift_pfad || signatur?.stempel_pfad);
  return (
    <div className="space-y-2">
      <p className="text-xs text-maja-muted">
        {hatEtwas
          ? `Wird beim Erzeugen der PDF automatisch ${zielBeschreibung} gesetzt.`
          : 'Noch nichts hinterlegt — der Bereich bleibt frei zum Unterschreiben von Hand. '
            + 'Hinterlegen lässt sich beides im Profil unter „Unterschrift & Firmenstempel".'}
      </p>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 text-sm text-maja-ink">
          <input type="checkbox" className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                 checked={mitUnterschrift}
                 disabled={disabled || !signatur?.unterschrift_pfad}
                 onChange={(e) => onChange({ mitUnterschrift: e.target.checked })} />
          Unterschrift einfügen
        </label>
        <label className="flex items-center gap-2 text-sm text-maja-ink">
          <input type="checkbox" className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                 checked={mitStempel}
                 disabled={disabled || !signatur?.stempel_pfad}
                 onChange={(e) => onChange({ mitStempel: e.target.checked })} />
          Firmenstempel einfügen
        </label>
      </div>
    </div>
  );
}
