// Vorlage für die Auftrags-E-Mail an den Fahrer (Migration 082).
//
// Hinweis zur Datensparsamkeit: die Auftraggeber-Vergütung steht
// bewusst NICHT in der Platzhalter-Liste — der Fahrer soll sie nicht
// sehen. {fahrer_honorar} ist erlaubt, weil es ihn selbst betrifft.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Spinner } from '../../components/Spinner';
import { useTestGuard } from '../../auth/TestModeContext';
import { loadMailboxes, type MailboxConfig } from '../../lib/mailboxSettings';
import {
  AUFTRAGS_PLATZHALTER, DEFAULT_AUFTRAGS_EMAIL, loadAuftragsEmail,
  saveAuftragsEmail, type AuftragsEmailVorlage,
} from '../../lib/auftragsEmail';

export function AuftragsEmailSettingsPage() {
  const guard = useTestGuard();
  const [cfg, setCfg] = useState<AuftragsEmailVorlage>(DEFAULT_AUFTRAGS_EMAIL);
  const [mailboxes, setMailboxes] = useState<MailboxConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const subjectRef = useRef<HTMLInputElement | null>(null);
  /** Wohin ein angeklickter Platzhalter eingefügt wird. */
  const [ziel, setZiel] = useState<'subject' | 'body'>('body');

  const load = useCallback(async () => {
    const [v, mbs] = await Promise.all([loadAuftragsEmail(), loadMailboxes()]);
    setCfg(v);
    setMailboxes(mbs.filter((m) => m.address.trim() !== ''));
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(t);
  }, [load]);

  function patch(p: Partial<AuftragsEmailVorlage>) {
    setCfg((c) => ({ ...c, ...p }));
    setSaved(false);
  }

  /** Platzhalter an der Cursor-Position einfügen. */
  function einfuegen(token: string) {
    if (ziel === 'subject') {
      const el = subjectRef.current;
      const pos = el?.selectionStart ?? cfg.subject.length;
      patch({ subject: cfg.subject.slice(0, pos) + token + cfg.subject.slice(pos) });
      return;
    }
    const el = bodyRef.current;
    const pos = el?.selectionStart ?? cfg.body.length;
    patch({ body: cfg.body.slice(0, pos) + token + cfg.body.slice(pos) });
  }

  async function speichern() {
    if (guard('Testmodus — Einstellungen werden nicht gespeichert.')) return;
    setSaving(true);
    setError(null);
    try {
      await saveAuftragsEmail(cfg);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner label="Einstellungen werden geladen …" />;

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-maja-navy">Auftrags-E-Mail</h2>
        <p className="text-sm text-maja-muted">
          Vorlage für den Button „Auftrag per E-Mail versenden" in der
          Tour-Ansicht. Betreff und Text sind beim Versand noch
          änderbar. Leere Felder werden beim Versand automatisch
          weggelassen, damit keine leeren Zeilen entstehen.
        </p>
      </div>

      <section className="card space-y-4 p-5">
        <div>
          <label htmlFor="ae-from" className="label">Absender (Default)</label>
          {mailboxes.length === 0 ? (
            <p className="text-xs text-maja-muted">
              Noch keine Postfächer konfiguriert — siehe Einstellungen →
              E-Mail-Postfächer.
            </p>
          ) : (
            <select id="ae-from" className="input" value={cfg.from}
                    onChange={(e) => patch({ from: e.target.value as AuftragsEmailVorlage['from'] })}>
              {mailboxes.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.address}{m.label ? ` (${m.label})` : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label htmlFor="ae-subject" className="label">Betreff</label>
          <input
            id="ae-subject"
            ref={subjectRef}
            className="input"
            value={cfg.subject}
            onFocus={() => setZiel('subject')}
            onChange={(e) => patch({ subject: e.target.value })}
          />
        </div>

        <div>
          <label htmlFor="ae-body" className="label">Text</label>
          <textarea
            id="ae-body"
            ref={bodyRef}
            className="input min-h-[22rem] font-mono text-xs"
            value={cfg.body}
            onFocus={() => setZiel('body')}
            onChange={(e) => patch({ body: e.target.value })}
          />
          <p className="mt-1 text-xs text-maja-muted">
            Die Signatur wird beim Versand automatisch angehängt.
          </p>
        </div>

        <div>
          <span className="label">
            Platzhalter — Klick fügt sie in {ziel === 'subject' ? 'den Betreff' : 'den Text'} ein
          </span>
          <div className="flex flex-wrap gap-1.5">
            {AUFTRAGS_PLATZHALTER.map((p) => (
              <button
                key={p.token}
                type="button"
                onClick={() => einfuegen(p.token)}
                title={p.label}
                className="rounded-full border border-maja-navy/20 bg-maja-light px-2.5 py-1 font-mono text-[11px] text-maja-navy hover:bg-maja-accent/20"
              >
                {p.token}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-maja-muted">
            Die Vergütung des Auftraggebers ist bewusst kein Platzhalter —
            sie gehört nicht in eine E-Mail an den Fahrer.
            <span className="font-mono"> {'{fahrer_honorar}'}</span> ist
            zulässig.
          </p>
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <div className="flex items-center gap-3">
        <button type="button" className="btn-primary" disabled={saving}
                onClick={() => void speichern()}>
          {saving ? 'Speichert …' : 'Speichern'}
        </button>
        <button type="button" className="btn-secondary" disabled={saving}
                onClick={() => { setCfg(DEFAULT_AUFTRAGS_EMAIL); setSaved(false); }}>
          Standard-Text wiederherstellen
        </button>
        {saved && <span className="text-sm text-emerald-700">Gespeichert.</span>}
      </div>
    </div>
  );
}
