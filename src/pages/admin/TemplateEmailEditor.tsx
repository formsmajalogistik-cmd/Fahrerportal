import type { EmailConfig, TemplatePdf } from '../../types/db';
import type { PlaceholderToken } from './TemplateEditorPage';

interface Props {
  config: EmailConfig | null;
  onChange: (next: EmailConfig | null) => void;
  pdfs: TemplatePdf[];
  placeholders: PlaceholderToken[];
}

const EMPTY: EmailConfig = {
  to: '', cc: '', subject_pattern: '', body_pattern: '', attach_pdf_ids: [],
};

export function TemplateEmailEditor({ config, onChange, pdfs, placeholders }: Props) {
  const cfg = config ?? EMPTY;
  const setCfg = (patch: Partial<EmailConfig>) => onChange({ ...cfg, ...patch });

  const isEnabled = !!(cfg.to && cfg.to.trim());

  function toggleAttach(id: string) {
    const list = cfg.attach_pdf_ids ?? [];
    setCfg({
      attach_pdf_ids: list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
    });
  }

  function appendPlaceholder(field: 'to' | 'cc' | 'subject_pattern' | 'body_pattern', token: string) {
    const cur = (cfg[field] ?? '') as string;
    setCfg({ [field]: cur + token } as Partial<EmailConfig>);
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-maja-navy">Email-Versand nach Submit</h3>
          <button
            type="button"
            onClick={() => onChange(isEnabled ? null : { ...EMPTY })}
            className="text-xs font-medium text-red-600 hover:underline"
          >
            {isEnabled ? 'Email-Versand deaktivieren' : 'Standardwerte einsetzen'}
          </button>
        </div>
        <p className="text-xs text-maja-muted">
          Wenn „An" ausgefüllt ist, wird nach dem Einreichen automatisch eine Email
          mit den ausgewählten PDFs versendet (Absender:
          {' '}<code className="rounded bg-maja-light px-1">protokollierung@maja-logistik.de</code>).
          Platzhalter <code className="rounded bg-maja-light px-1">{'{feld_id}'}</code> werden
          durch die Werte aus dem ausgefüllten Formular ersetzt.
        </p>

        <FieldRow label="An (kommasepariert)">
          <input
            className="input"
            placeholder="z.B. {email_kunde}, dispo@maja-logistik.de"
            value={cfg.to ?? ''}
            onChange={(e) => setCfg({ to: e.target.value })}
          />
          <PlaceholderHelper
            placeholders={placeholders}
            onPick={(t) => appendPlaceholder('to', t)}
          />
        </FieldRow>

        <FieldRow label="CC (optional)">
          <input
            className="input"
            placeholder="z.B. archiv@maja-logistik.de"
            value={cfg.cc ?? ''}
            onChange={(e) => setCfg({ cc: e.target.value })}
          />
          <PlaceholderHelper
            placeholders={placeholders}
            onPick={(t) => appendPlaceholder('cc', t)}
          />
        </FieldRow>

        <FieldRow label="Betreff-Muster">
          <input
            className="input"
            placeholder="z.B. Fahrzeugprotokoll {kennzeichen} — {datum}"
            value={cfg.subject_pattern ?? ''}
            onChange={(e) => setCfg({ subject_pattern: e.target.value })}
          />
          <PlaceholderHelper
            placeholders={placeholders}
            onPick={(t) => appendPlaceholder('subject_pattern', t)}
          />
        </FieldRow>

        <FieldRow label="Email-Text-Muster">
          <textarea
            className="input min-h-[120px]"
            placeholder="Hallo,&#10;&#10;anbei das Protokoll für {kennzeichen}, Fahrer {fahrername}.&#10;&#10;Viele Grüße"
            value={cfg.body_pattern ?? ''}
            onChange={(e) => setCfg({ body_pattern: e.target.value })}
          />
          <PlaceholderHelper
            placeholders={placeholders}
            onPick={(t) => appendPlaceholder('body_pattern', t)}
          />
        </FieldRow>

        <div>
          <span className="label">Anhänge</span>
          {pdfs.length === 0 ? (
            <p className="text-xs text-maja-muted">
              Noch keine PDF-Vorlagen am Template definiert. Lege sie im Tab
              „PDF-Mapping" an.
            </p>
          ) : (
            <div className="space-y-1">
              {pdfs.map((p) => {
                const checked = (cfg.attach_pdf_ids ?? []).includes(p.id);
                return (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                      checked={checked}
                      onChange={() => toggleAttach(p.id)}
                    />
                    <span className="font-medium text-maja-ink">{p.name}</span>
                    <span className="text-xs text-maja-muted">({p.id})</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function PlaceholderHelper({
  placeholders, onPick,
}: { placeholders: PlaceholderToken[]; onPick: (token: string) => void }) {
  if (placeholders.length === 0) return null;
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-maja-accent hover:underline">
        Platzhalter einfügen ({placeholders.length})
      </summary>
      <div className="mt-2 flex flex-wrap gap-1">
        {placeholders.map((p) => (
          <button
            key={p.token}
            type="button"
            onClick={() => onPick(p.token)}
            title={p.label ? p.label : undefined}
            className="rounded-full bg-maja-light px-2 py-0.5 text-[11px] text-maja-navy hover:bg-maja-accent/20"
          >
            {p.token}
          </button>
        ))}
      </div>
    </details>
  );
}
