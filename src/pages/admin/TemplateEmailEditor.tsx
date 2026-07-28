import { useEffect, useState } from 'react';
import { loadMailboxes, type MailboxConfig } from '../../lib/mailboxSettings';
import type { EmailConfig, TemplatePdf } from '../../types/db';
import type { PlaceholderToken } from './TemplateEditorPage';

interface Props {
  config: EmailConfig | null;
  onChange: (next: EmailConfig | null) => void;
  pdfs: TemplatePdf[];
  placeholders: PlaceholderToken[];
}

/**
 * Drei E-Mail-Vorlagen pro Template:
 *
 *   1. Bestätigung — automatisch bei Submit, geht an Self/Fahrer/Extra.
 *   2. Schieberegler — automatisch bei Submit, geht an die vom Fahrer
 *      eingetragene Adresse, mit den im Template konfigurierten PDFs.
 *   3. Manuell — wird im Eingänge-Dialog vorausgefüllt; Empfänger wählt
 *      der Admin dort selbst.
 *
 * Alle drei teilen sich `template.email_config` (jsonb), historische Felder
 * (`to`, `cc`, `subject_pattern`, `body_pattern`) gehören zu Vorlage 3.
 */
export function TemplateEmailEditor({ config, onChange, pdfs, placeholders }: Props) {
  const cfg = config ?? ({} as EmailConfig);
  const setCfg = (patch: Partial<EmailConfig>) => onChange({ ...cfg, ...patch });

  const [mailboxes, setMailboxes] = useState<MailboxConfig[]>([]);
  useEffect(() => {
    void loadMailboxes().then((mbs) => {
      setMailboxes(mbs.filter((m) => m.address.trim() !== ''));
    });
  }, []);
  const defaultMailbox = mailboxes.find((m) => m.key === 'mail_inbox_2')?.address
    || mailboxes[0]?.address || '';

  // ---- Confirmation -----------------------------------------------
  const conf = cfg.confirmation ?? {
    enabled: false,
    recipient_self: true,
    recipient_fahrer: false,
    recipient_extra: '',
    from: defaultMailbox,
    subject: '',
    body: '',
    attach_pdf_ids: [],
  };
  const setConf = (patch: Partial<NonNullable<EmailConfig['confirmation']>>) =>
    setCfg({ confirmation: { ...conf, ...patch } });

  // ---- Sliders ----------------------------------------------------
  const sliders = cfg.sliders ?? {
    enabled: false,
    count: 1 as 1 | 2,
    labels: ['Protokoll an Übergeber senden', 'Protokoll an Empfänger senden'] as [string, string],
    from: defaultMailbox,
    subject: '',
    body: '',
    attach_pdf_ids: [],
  };
  const setSliders = (patch: Partial<NonNullable<EmailConfig['sliders']>>) =>
    setCfg({ sliders: { ...sliders, ...patch } });

  // ---- Zwischenprotokoll (Vorlage 4) ------------------------------
  const zwischen = cfg.zwischenprotokoll ?? {
    enabled: false,
    recipient_self: true,
    recipient_fahrer: false,
    recipient_extra: '',
    from: defaultMailbox,
    subject: '',
    body: '',
    attach_pdf_ids: [],
  };
  const setZwischen = (patch: Partial<NonNullable<EmailConfig['zwischenprotokoll']>>) =>
    setCfg({ zwischenprotokoll: { ...zwischen, ...patch } });

  return (
    <div className="space-y-6">
      <ConfirmationPanel
        conf={conf}
        setConf={setConf}
        pdfs={pdfs}
        placeholders={placeholders}
        mailboxes={mailboxes}
      />
      <SlidersPanel
        sliders={sliders}
        setSliders={setSliders}
        pdfs={pdfs}
        placeholders={placeholders}
        mailboxes={mailboxes}
      />
      <ConfirmationPanel
        conf={zwischen}
        setConf={setZwischen}
        pdfs={pdfs}
        placeholders={placeholders}
        mailboxes={mailboxes}
        titel="E-Mail 4: Zwischenprotokoll (Übernahme)"
        beschreibung={
          'Wird automatisch versendet, sobald der Fahrer "Zwischenprotokoll '
          + 'abschließen" klickt. Erzeugung und Versand laufen im Hintergrund — '
          + 'das Formular bleibt für den Übergabe-Teil bearbeitbar. Voraussetzung: '
          + 'im Reiter Struktur ist "Zwischenprotokoll erlauben nach Abschnitt" gesetzt.'
        }
        checkboxLabel="Zwischenprotokoll automatisch erzeugen und versenden"
      />
      <ManualPanel
        cfg={cfg}
        setCfg={setCfg}
        pdfs={pdfs}
        placeholders={placeholders}
        mailboxes={mailboxes}
      />
    </div>
  );
}

// ====================================================================
// Vorlage 1: Bestätigungs-E-Mail
// ====================================================================

function ConfirmationPanel({
  conf, setConf, pdfs, placeholders, mailboxes,
  titel = 'E-Mail 1: Bestätigung bei Formularabschluss',
  beschreibung = 'Wird beim Einreichen automatisch versendet. Standardmäßig ohne Anhang.',
  checkboxLabel = 'Bestätigungs-E-Mail bei Abschluss senden',
}: {
  conf: NonNullable<EmailConfig['confirmation']>;
  setConf: (patch: Partial<NonNullable<EmailConfig['confirmation']>>) => void;
  pdfs: TemplatePdf[];
  placeholders: PlaceholderToken[];
  mailboxes: MailboxConfig[];
  /** Überschrift/Beschreibung/Label — das Panel wird auch für die
   *  Zwischenprotokoll-Vorlage (E-Mail 4) wiederverwendet, die exakt
   *  dieselbe Feld-Struktur hat. */
  titel?: string;
  beschreibung?: string;
  checkboxLabel?: string;
}) {
  return (
    <section className="card space-y-4 p-5">
      <header>
        <h3 className="text-sm font-semibold text-maja-navy">{titel}</h3>
        <p className="mt-0.5 text-xs text-maja-muted">{beschreibung}</p>
      </header>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
          checked={conf.enabled}
          onChange={(e) => setConf({ enabled: e.target.checked })}
        />
        <span className="font-medium text-maja-ink">{checkboxLabel}</span>
      </label>

      {conf.enabled && (
        <div className="space-y-4 border-l-2 border-maja-accent/30 pl-4">
          <fieldset className="space-y-1">
            <legend className="label">Empfänger</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                checked={conf.recipient_self}
                onChange={(e) => setConf({ recipient_self: e.target.checked })}
              />
              <span>An den eingeloggten Fahrer (Self)</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                checked={conf.recipient_fahrer}
                onChange={(e) => setConf({ recipient_fahrer: e.target.checked })}
              />
              <span>An die im Fahrer-Profil hinterlegte E-Mail</span>
            </label>
            <div>
              <input
                className="input mt-1"
                placeholder="An weitere Adresse(n) — kommasepariert, Platzhalter erlaubt"
                value={conf.recipient_extra}
                onChange={(e) => setConf({ recipient_extra: e.target.value })}
              />
              <PlaceholderHelper
                placeholders={placeholders}
                onPick={(t) => setConf({ recipient_extra: (conf.recipient_extra || '') + t })}
              />
            </div>
          </fieldset>

          <FromPicker
            value={conf.from}
            onChange={(v) => setConf({ from: v })}
            mailboxes={mailboxes}
          />

          <FieldRow label="Betreff">
            <input
              className="input"
              value={conf.subject}
              onChange={(e) => setConf({ subject: e.target.value })}
              placeholder="z.B. Bestätigung — {template_name} {kennzeichen}"
            />
            <PlaceholderHelper
              placeholders={placeholders}
              onPick={(t) => setConf({ subject: conf.subject + t })}
            />
          </FieldRow>

          <FieldRow label="Body">
            <textarea
              className="input min-h-[100px]"
              value={conf.body}
              onChange={(e) => setConf({ body: e.target.value })}
              placeholder={"Hallo {fahrer_name},\n\ndein Protokoll für {kennzeichen} wurde eingereicht.\n\nViele Grüße"}
            />
            <PlaceholderHelper
              placeholders={placeholders}
              onPick={(t) => setConf({ body: conf.body + t })}
            />
          </FieldRow>

          <AttachmentList
            label="Anhänge (optional)"
            pdfs={pdfs}
            selected={conf.attach_pdf_ids ?? []}
            onChange={(next) => setConf({ attach_pdf_ids: next })}
          />
        </div>
      )}
    </section>
  );
}

// ====================================================================
// Vorlage 2: Schieberegler-E-Mail
// ====================================================================

function SlidersPanel({
  sliders, setSliders, pdfs, placeholders, mailboxes,
}: {
  sliders: NonNullable<EmailConfig['sliders']>;
  setSliders: (patch: Partial<NonNullable<EmailConfig['sliders']>>) => void;
  pdfs: TemplatePdf[];
  placeholders: PlaceholderToken[];
  mailboxes: MailboxConfig[];
}) {
  function setLabel(i: 0 | 1, v: string) {
    const next: [string, string] = [sliders.labels[0], sliders.labels[1]];
    next[i] = v;
    setSliders({ labels: next });
  }

  return (
    <section className="card space-y-4 p-5">
      <header>
        <h3 className="text-sm font-semibold text-maja-navy">
          E-Mail 2: Schieberegler-E-Mail
        </h3>
        <p className="mt-0.5 text-xs text-maja-muted">
          Fahrer entscheidet im Formular per Schieberegler, ob das Protokoll an
          eine eingegebene Adresse versendet wird. EINE Vorlage für alle
          Schieberegler — nur die Empfänger-Adresse ist pro Schieberegler
          unterschiedlich.
        </p>
      </header>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
          checked={sliders.enabled}
          onChange={(e) => setSliders({ enabled: e.target.checked })}
        />
        <span className="font-medium text-maja-ink">Schieberegler-E-Mail aktivieren</span>
      </label>

      {sliders.enabled && (
        <div className="space-y-4 border-l-2 border-maja-accent/30 pl-4">
          <FieldRow label="Anzahl Schieberegler im Formular">
            <select
              className="input"
              value={sliders.count}
              onChange={(e) => setSliders({ count: (Number(e.target.value) === 2 ? 2 : 1) })}
            >
              <option value={1}>1 Schieberegler</option>
              <option value={2}>2 Schieberegler</option>
            </select>
          </FieldRow>

          <FieldRow label="Label Schieberegler 1">
            <input
              className="input"
              value={sliders.labels[0]}
              onChange={(e) => setLabel(0, e.target.value)}
              placeholder="z.B. Protokoll an Übergeber senden"
            />
          </FieldRow>

          {sliders.count === 2 && (
            <FieldRow label="Label Schieberegler 2">
              <input
                className="input"
                value={sliders.labels[1]}
                onChange={(e) => setLabel(1, e.target.value)}
                placeholder="z.B. Protokoll an Empfänger senden"
              />
            </FieldRow>
          )}

          <FromPicker
            value={sliders.from}
            onChange={(v) => setSliders({ from: v })}
            mailboxes={mailboxes}
          />

          <FieldRow label="Betreff">
            <input
              className="input"
              value={sliders.subject}
              onChange={(e) => setSliders({ subject: e.target.value })}
              placeholder="z.B. Protokoll {kennzeichen} — {datum}"
            />
            <PlaceholderHelper
              placeholders={placeholders}
              onPick={(t) => setSliders({ subject: sliders.subject + t })}
            />
          </FieldRow>

          <FieldRow label="Body">
            <textarea
              className="input min-h-[100px]"
              value={sliders.body}
              onChange={(e) => setSliders({ body: e.target.value })}
              placeholder={"Sehr geehrte Damen und Herren,\n\nanbei das Protokoll für {kennzeichen}.\n\nViele Grüße"}
            />
            <PlaceholderHelper
              placeholders={placeholders}
              onPick={(t) => setSliders({ body: sliders.body + t })}
            />
          </FieldRow>

          <AttachmentList
            label="Anhänge"
            pdfs={pdfs}
            selected={sliders.attach_pdf_ids ?? []}
            onChange={(next) => setSliders({ attach_pdf_ids: next })}
          />
        </div>
      )}
    </section>
  );
}

// ====================================================================
// Vorlage 3: Manuelle E-Mail (aus Eingänge)
// ====================================================================

function ManualPanel({
  cfg, setCfg, pdfs, placeholders, mailboxes,
}: {
  cfg: EmailConfig;
  setCfg: (patch: Partial<EmailConfig>) => void;
  pdfs: TemplatePdf[];
  placeholders: PlaceholderToken[];
  mailboxes: MailboxConfig[];
}) {
  return (
    <section className="card space-y-4 p-5">
      <header>
        <h3 className="text-sm font-semibold text-maja-navy">
          E-Mail 3: Manueller Versand aus Eingänge
        </h3>
        <p className="mt-0.5 text-xs text-maja-muted">
          Wird im Eingänge-Dialog vorausgefüllt. Der Empfänger wird im Modal
          gewählt — hier nur die Vorlage.
        </p>
      </header>

      <FromPicker
        value={cfg.from ?? ''}
        onChange={(v) => setCfg({ from: v })}
        mailboxes={mailboxes}
      />

      <FieldRow label="Betreff-Muster">
        <input
          className="input"
          placeholder="z.B. Fahrzeugprotokoll {kennzeichen} — {datum}"
          value={cfg.subject_pattern ?? ''}
          onChange={(e) => setCfg({ subject_pattern: e.target.value })}
        />
        <PlaceholderHelper
          placeholders={placeholders}
          onPick={(t) => setCfg({ subject_pattern: (cfg.subject_pattern ?? '') + t })}
        />
      </FieldRow>

      <FieldRow label="Body-Muster">
        <textarea
          className="input min-h-[100px]"
          placeholder={"Hallo,\n\nanbei das Protokoll für {kennzeichen}.\n\nViele Grüße"}
          value={cfg.body_pattern ?? ''}
          onChange={(e) => setCfg({ body_pattern: e.target.value })}
        />
        <PlaceholderHelper
          placeholders={placeholders}
          onPick={(t) => setCfg({ body_pattern: (cfg.body_pattern ?? '') + t })}
        />
      </FieldRow>

      <AttachmentList
        label="Anhänge (Default-Auswahl im Modal)"
        pdfs={pdfs}
        selected={cfg.attach_pdf_ids ?? []}
        onChange={(next) => setCfg({ attach_pdf_ids: next })}
      />
    </section>
  );
}

// ====================================================================
// Subkomponenten
// ====================================================================

function FromPicker({
  value, onChange, mailboxes,
}: { value: string; onChange: (v: string) => void; mailboxes: MailboxConfig[] }) {
  if (mailboxes.length === 0) {
    return (
      <FieldRow label="Absender (Von)">
        <p className="text-xs text-maja-muted">
          Noch keine Postfächer konfiguriert — siehe Einstellungen → Postfächer.
        </p>
      </FieldRow>
    );
  }
  return (
    <FieldRow label="Absender (Von)">
      <select
        className="input"
        value={value || mailboxes[0]?.address || ''}
        onChange={(e) => onChange(e.target.value)}
      >
        {mailboxes.map((m) => (
          <option key={m.key} value={m.address}>
            {m.address}{m.label ? ` (${m.label})` : ''}
          </option>
        ))}
      </select>
    </FieldRow>
  );
}

function AttachmentList({
  label, pdfs, selected, onChange,
}: {
  label: string;
  pdfs: TemplatePdf[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }
  return (
    <div>
      <span className="label">{label}</span>
      {pdfs.length === 0 ? (
        <p className="text-xs text-maja-muted">
          Noch keine PDF-Vorlagen am Template — lege sie im Tab „PDF-Mapping" an.
        </p>
      ) : (
        <div className="space-y-1">
          {pdfs.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                checked={selected.includes(p.id)}
                onChange={() => toggle(p.id)}
              />
              <span className="font-medium text-maja-ink">{p.name}</span>
              <span className="text-xs text-maja-muted">({p.id})</span>
            </label>
          ))}
        </div>
      )}
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
            title={p.label}
            className="rounded-full bg-maja-light px-2 py-0.5 text-[11px] text-maja-navy hover:bg-maja-accent/20"
          >
            {p.token}
          </button>
        ))}
      </div>
    </details>
  );
}
