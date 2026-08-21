// Briefe in der Fahrer-Ansicht (Migration 091).
//
// Der Fahrer sieht ausschließlich Briefe, die ihm zugestellt wurden —
// das erzwingt die RLS, nicht diese Seite. Er kann sie lesen und, wenn
// noch offen, unterschreiben.
//
// Datenschutz: Es wird AUSSCHLIESSLICH die Unterschrift erfasst. Es gibt
// hier bewusst kein Feld und keinen Upload für Ausweisdaten — die
// Ausweisprüfung findet persönlich vor Ort statt.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Spinner } from '../components/Spinner';
import { SignatureField } from '../components/forms/fields/SignatureField';
import { useTestGuard } from '../auth/TestModeContext';
import { formatDate, formatDateTime } from '../lib/touren';
import {
  BRIEF_STATUS_LABEL, unterschreibeBrief, type Brief,
} from '../lib/briefe';
import type { FormField } from '../types/db';

/** Synthetisches Feld für die geteilte Signature-Komponente. */
const UNTERSCHRIFT_FELD: FormField = {
  id: 'brief_unterschrift',
  label: 'Ihre Unterschrift',
  type: 'signature',
} as FormField;

export function FahrerBriefePage() {
  const guard = useTestGuard();
  const [briefe, setBriefe] = useState<Brief[]>([]);
  const [loading, setLoading] = useState(true);
  const [offen, setOffen] = useState<string | null>(null);
  const [unterschrift, setUnterschrift] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const laden = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('briefe').select('*').order('datum', { ascending: false });
    setBriefe((data as Brief[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => { void laden(); }, 0);
    return () => window.clearTimeout(t);
  }, [laden]);

  async function unterschreiben(brief: Brief) {
    if (!unterschrift) { setFehler('Bitte zuerst unterschreiben.'); return; }
    if (guard()) return;
    setBusy(true);
    setFehler(null);
    const res = await unterschreibeBrief(brief.id, unterschrift);
    setBusy(false);
    if (!res.ok) { setFehler(res.fehler ?? 'Speichern fehlgeschlagen.'); return; }
    setUnterschrift(null);
    setOffen(null);
    await laden();
  }

  if (loading) return <Spinner label="Briefe werden geladen …" />;

  if (briefe.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-maja-muted">
        Es liegen keine Briefe für Sie vor.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-maja-navy">Briefe</h1>
        <p className="text-sm text-maja-muted">
          Schreiben von Maja-Logistik. Offene Briefe bitte lesen und
          unterschreiben.
        </p>
      </div>

      {fehler && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</div>
      )}

      <ul className="space-y-3">
        {briefe.map((b) => {
          const istOffen = offen === b.id;
          const signiert = !!b.unterschrieben_am;
          return (
            <li key={b.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-block rounded-full bg-maja-light px-2 py-0.5 text-xs font-semibold text-maja-navy">
                      {b.brief_nr}
                    </span>
                    <h2 className="text-base font-semibold text-maja-navy">
                      {b.betreff || 'Schreiben'}
                    </h2>
                    {signiert ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:!bg-emerald-900 dark:!text-emerald-100">
                        Unterschrieben
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:!bg-amber-900 dark:!text-amber-100">
                        Unterschrift offen
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-maja-muted">
                    {formatDate(b.datum)}
                    {signiert && ` · unterschrieben am ${formatDateTime(b.unterschrieben_am)}`}
                    {!signiert && ` · Status: ${BRIEF_STATUS_LABEL[b.status] ?? b.status}`}
                  </p>
                </div>
                <button
                  type="button"
                  className={signiert ? 'btn-secondary' : 'btn-primary'}
                  onClick={() => { setOffen(istOffen ? null : b.id); setUnterschrift(null); setFehler(null); }}
                >
                  {istOffen ? 'Schließen' : signiert ? 'Ansehen' : 'Lesen & unterschreiben'}
                </button>
              </div>

              {istOffen && (
                <div className="mt-4 space-y-4 border-t border-maja-navy/10 pt-4">
                  {/* Brieftext — scrollbar, damit auch lange Schreiben
                      auf dem Handy vollständig lesbar bleiben. */}
                  <div className="max-h-[50vh] overflow-y-auto rounded-lg bg-maja-light/40 p-4">
                    {(b.inhalt ?? '').split(/\n{2,}/).map((abs) => (
                      <p key={abs.slice(0, 40)} className="mb-3 whitespace-pre-wrap text-sm text-maja-ink">
                        {abs}
                      </p>
                    ))}
                  </div>

                  {signiert ? (
                    <p className="text-sm text-maja-muted">
                      Sie haben diesen Brief am {formatDateTime(b.unterschrieben_am)}{' '}
                      digital unterschrieben.
                    </p>
                  ) : (
                    <>
                      <SignatureField
                        field={UNTERSCHRIFT_FELD}
                        value={unterschrift}
                        onChange={(v) => setUnterschrift(v)}
                        disabled={busy}
                      />
                      <p className="text-xs text-maja-muted">
                        Mit der Unterschrift bestätigen Sie den Inhalt dieses
                        Schreibens. Gespeichert wird ausschließlich die
                        Unterschrift mit Zeitstempel.
                      </p>
                      <button
                        type="button"
                        className="btn-primary w-full sm:w-auto"
                        disabled={busy || !unterschrift}
                        onClick={() => void unterschreiben(b)}
                      >
                        {busy ? 'Wird gespeichert …' : 'Bestätigen und unterschreiben'}
                      </button>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
