// Verwaltung der Brief-Vorlagen (Migration 091).
//
// Platzhalter stehen als klickbare Chips bereit und werden an der
// Cursor-Position eingefügt — dasselbe Muster wie bei der
// Auftrags-E-Mail-Vorlage.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Spinner } from '../../components/Spinner';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useTestGuard } from '../../auth/TestModeContext';
import { BRIEF_PLATZHALTER, ladeVorlagen, type BriefVorlage } from '../../lib/briefe';

export function BriefVorlagenPage() {
  const guard = useTestGuard();
  const [vorlagen, setVorlagen] = useState<BriefVorlage[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  /** null = zu, '' = neu, sonst die bearbeitete Id. */
  const [offen, setOffen] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [typ, setTyp] = useState<'allgemein' | 'tankkarte'>('allgemein');
  const [betreff, setBetreff] = useState('');
  const [inhalt, setInhalt] = useState('');
  const [unterschrift, setUnterschrift] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loeschId, setLoeschId] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  const laden = useCallback(async () => {
    setLoading(true);
    setVorlagen(await ladeVorlagen());
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => { void laden(); }, 0);
    return () => window.clearTimeout(t);
  }, [laden]);

  function neu() {
    setName(''); setTyp('allgemein'); setBetreff(''); setInhalt('');
    setUnterschrift(false); setOffen(''); setFehler(null);
  }

  function bearbeiten(v: BriefVorlage) {
    setName(v.name); setTyp(v.typ === 'tankkarte' ? 'tankkarte' : 'allgemein');
    setBetreff(v.betreff ?? ''); setInhalt(v.inhalt ?? '');
    setUnterschrift(v.unterschrift_erforderlich); setOffen(v.id); setFehler(null);
  }

  /** Platzhalter an der Cursor-Position einfügen. */
  function platzhalterEinfuegen(token: string) {
    const el = textRef.current;
    if (!el) { setInhalt((t) => t + token); return; }
    const start = el.selectionStart ?? inhalt.length;
    const ende = el.selectionEnd ?? inhalt.length;
    const neuText = inhalt.slice(0, start) + token + inhalt.slice(ende);
    setInhalt(neuText);
    window.setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    }, 0);
  }

  async function speichern() {
    if (!name.trim()) { setFehler('Bitte einen Namen angeben.'); return; }
    if (guard()) return;
    setBusy(true);
    const payload = {
      name: name.trim(), typ,
      betreff: betreff.trim() || null,
      inhalt: inhalt.trim() || null,
      unterschrift_erforderlich: unterschrift,
    };
    const { error } = offen
      ? await supabase.from('brief_vorlagen').update(payload).eq('id', offen)
      : await supabase.from('brief_vorlagen').insert(payload);
    setBusy(false);
    if (error) { setFehler(error.message); return; }
    setOffen(null); setFehler(null);
    await laden();
  }

  async function loeschen(id: string) {
    if (guard()) return;
    const { error } = await supabase.from('brief_vorlagen').delete().eq('id', id);
    setLoeschId(null);
    if (error) { setFehler(error.message); return; }
    await laden();
  }

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-maja-navy">Brief-Vorlagen</h2>
          <p className="text-sm text-maja-muted">
            Textbausteine für wiederkehrende Schreiben. Beim Erstellen eines
            Briefs werden die Platzhalter aufgelöst; der Text bleibt danach
            frei bearbeitbar.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={neu}>+ Neue Vorlage</button>
      </div>

      {fehler && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</div>
      )}

      {offen !== null && (
        <div className="card space-y-3 p-5">
          <h3 className="text-base font-semibold text-maja-navy">
            {offen ? 'Vorlage bearbeiten' : 'Neue Vorlage'}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="bv-name" className="label">Name</label>
              <input id="bv-name" className="input" value={name}
                     onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label htmlFor="bv-typ" className="label">Typ</label>
              <select id="bv-typ" className="input" value={typ}
                      onChange={(e) => setTyp(e.target.value as 'allgemein' | 'tankkarte')}>
                <option value="allgemein">Allgemein</option>
                <option value="tankkarte">Tankkarte</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="bv-betreff" className="label">Betreff</label>
              <input id="bv-betreff" className="input" value={betreff}
                     onChange={(e) => setBetreff(e.target.value)} />
            </div>
          </div>

          <div>
            <span className="label">Platzhalter</span>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {BRIEF_PLATZHALTER.map((p) => (
                <button
                  key={p.token}
                  type="button"
                  title={p.label}
                  onClick={() => platzhalterEinfuegen(p.token)}
                  className="rounded-full bg-maja-light px-2.5 py-1 font-mono text-xs text-maja-navy transition hover:bg-maja-navy hover:text-white"
                >
                  {p.token}
                </button>
              ))}
            </div>
            <label htmlFor="bv-inhalt" className="label">Inhalt</label>
            <textarea
              id="bv-inhalt" ref={textRef}
              className="input min-h-[16rem]"
              value={inhalt}
              onChange={(e) => setInhalt(e.target.value)}
            />
            <p className="mt-1 text-xs text-maja-muted">
              Klick auf einen Platzhalter fügt ihn an der Cursor-Position ein.
              Leerzeile trennt Absätze.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm text-maja-ink">
            <input type="checkbox" className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                   checked={unterschrift}
                   onChange={(e) => setUnterschrift(e.target.checked)} />
            Unterschrift erforderlich
          </label>

          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" disabled={busy}
                    onClick={() => { setOffen(null); setFehler(null); }}>
              Abbrechen
            </button>
            <button type="button" className="btn-primary" disabled={busy}
                    onClick={() => void speichern()}>
              {busy ? 'Speichern …' : 'Speichern'}
            </button>
          </div>
        </div>
      )}

      {vorlagen.length === 0 ? (
        <div className="card p-6 text-center text-sm text-maja-muted">
          Noch keine Vorlagen.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-maja-navy/10">
            {vorlagen.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-maja-ink">{v.name}</div>
                  <div className="text-xs text-maja-muted">
                    {v.typ === 'tankkarte' ? 'Tankkarte' : 'Allgemein'}
                    {v.betreff ? ` · ${v.betreff}` : ''}
                    {v.unterschrift_erforderlich ? ' · Unterschrift erforderlich' : ''}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button type="button" className="btn-secondary px-3 py-1.5 text-sm"
                          onClick={() => bearbeiten(v)}>
                    Bearbeiten
                  </button>
                  <button type="button"
                          className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                          onClick={() => setLoeschId(v.id)}>
                    Löschen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {loeschId && (
        <ConfirmDialog
          title="Vorlage löschen?"
          message="Bereits erstellte Briefe bleiben unverändert — sie tragen ihren Text selbst."
          confirmLabel="Löschen"
          onConfirm={async () => { await loeschen(loeschId); }}
          onClose={() => setLoeschId(null)}
        />
      )}
    </div>
  );
}
