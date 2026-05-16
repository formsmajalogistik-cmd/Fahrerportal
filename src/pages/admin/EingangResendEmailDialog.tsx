import { useMemo, useState, type FormEvent } from 'react';
import { sendEmail } from '../../lib/onedrive';
import { useAuth } from '../../auth/AuthContext';
import {
  expectedOneDrivePath, resolveFilename, resolvePattern,
} from '../../lib/pdfGenerate';
import type { AusgefuelltesFormular, FormularTemplate } from '../../types/db';

interface Props {
  formular: AusgefuelltesFormular;
  template: FormularTemplate;
  onClose: () => void;
  onSent: () => void;
}

interface AttachmentDraft {
  id: string;
  name: string;
  filename: string;
  onedrive_path: string;
  selected: boolean;
}

/**
 * Modal "E-Mail erneut senden" für einen bestehenden Eingang.
 * Empfänger, CC, Betreff und Anhänge sind aus der Template-Email-Config
 * vorbefüllt und können vor dem Versand frei angepasst werden.
 */
export function EingangResendEmailDialog({ formular, template, onClose, onSent }: Props) {
  const { session } = useAuth();
  const submitterEmail = session?.user?.email ?? '';

  const initial = useMemo(() => {
    const cfg = template.email_config ?? null;
    const data = formular.daten as Record<string, unknown>;
    const splitList = (s: string) => s.split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
    const to = cfg?.to ? splitList(resolvePattern(cfg.to, data)) : [];
    let cc = cfg?.cc ? splitList(resolvePattern(cfg.cc, data)) : [];
    if (submitterEmail && submitterEmail.includes('@')) {
      const norm = (a: string) => a.trim().toLowerCase();
      const present = new Set([...to, ...cc].map(norm));
      if (!present.has(norm(submitterEmail))) cc = [...cc, submitterEmail];
    }
    const subject = cfg?.subject_pattern
      ? resolvePattern(cfg.subject_pattern, data)
      : template.name;
    const body = cfg?.body_pattern ? resolvePattern(cfg.body_pattern, data) : '';
    const wanted = new Set(cfg?.attach_pdf_ids ?? []);
    const attachments: AttachmentDraft[] = (template.pdfs ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      filename: resolveFilename(p.filename_pattern, data, p.id),
      onedrive_path: expectedOneDrivePath(template, formular, p),
      // Standardmäßig nur die PDFs vorausgewählt, die auch beim Erst-
      // versand als Anhang konfiguriert sind. Hat das Template keine
      // attach_pdf_ids gesetzt (z.B. Legacy), wählen wir alle vor.
      selected: wanted.size === 0 ? true : wanted.has(p.id),
    }));
    return { to: to.join(', '), cc: cc.join(', '), subject, body, attachments };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id, formular.id]);

  const [toStr, setToStr] = useState(initial.to);
  const [ccStr, setCcStr] = useState(initial.cc);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>(initial.attachments);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleAttachment(id: string) {
    setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, selected: !a.selected } : a)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const split = (s: string) => s.split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
    const to = split(toStr);
    if (to.length === 0) { setError('Mindestens einen Empfänger angeben.'); return; }
    if (!subject.trim()) { setError('Betreff darf nicht leer sein.'); return; }
    const cc = split(ccStr);
    const selected = attachments.filter((a) => a.selected);
    setBusy(true);
    try {
      await sendEmail({
        to,
        cc: cc.length > 0 ? cc : undefined,
        subject,
        body,
        attachments: selected.map((a) => ({
          name: a.filename,
          contentType: 'application/pdf',
          onedrive_path: a.onedrive_path,
        })),
      });
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Versand fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8">
      <div className="card w-full max-w-2xl p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-maja-navy">E-Mail erneut senden</h2>
            <p className="text-xs text-maja-muted">
              Eingang von {formular.created_at?.slice(0, 10) ?? '—'} — alle Felder
              vor dem Versand anpassbar.
            </p>
          </div>
          <button type="button" onClick={onClose}
                  className="rounded-md p-1 text-maja-muted hover:bg-maja-light"
                  aria-label="Schließen">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="re-to" className="label">An (kommagetrennt)</label>
            <input id="re-to" className="input" value={toStr}
                   onChange={(e) => setToStr(e.target.value)} />
          </div>
          <div>
            <label htmlFor="re-cc" className="label">CC (optional)</label>
            <input id="re-cc" className="input" value={ccStr}
                   onChange={(e) => setCcStr(e.target.value)} />
          </div>
          <div>
            <label htmlFor="re-subject" className="label">Betreff</label>
            <input id="re-subject" className="input" value={subject}
                   onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <label htmlFor="re-body" className="label">Text</label>
            <textarea id="re-body" className="input min-h-[6rem]" value={body}
                      onChange={(e) => setBody(e.target.value)} />
          </div>

          <div>
            <span className="label">Anhänge</span>
            {attachments.length === 0 ? (
              <p className="text-xs text-maja-muted">
                Keine PDF-Vorlagen am Template — der Versand enthält keine Anhänge.
              </p>
            ) : (
              <ul className="space-y-1">
                {attachments.map((a) => (
                  <li key={a.id}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                        checked={a.selected}
                        onChange={() => toggleAttachment(a.id)}
                      />
                      <span className="font-medium text-maja-ink">{a.name}</span>
                      <span className="text-xs text-maja-muted">{a.filename}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary" disabled={busy}>
              Abbrechen
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Sendet …' : 'Senden'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
