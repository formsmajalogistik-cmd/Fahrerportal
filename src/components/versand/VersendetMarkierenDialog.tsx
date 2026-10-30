// „Als versendet markieren" — einzeln (Detail) oder für die Auswahl in
// der Übersicht: Weg, Datum (Standard heute), optionale Notiz.

import { useState } from 'react';
import { MANUELLE_WEGE, WEG_LABEL, type VersandWeg } from '../../lib/belegVersand';

function heute(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
}

export function VersendetMarkierenDialog({
  titel, hinweis, onCancel, onConfirm,
}: {
  titel: string;
  hinweis?: string;
  onCancel: () => void;
  onConfirm: (weg: VersandWeg, datum: string, notiz: string) => Promise<void>;
}) {
  const [weg, setWeg] = useState<VersandWeg>('post');
  const [datum, setDatum] = useState(heute());
  const [notiz, setNotiz] = useState('');
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function bestaetigen() {
    setBusy(true); setFehler(null);
    try { await onConfirm(weg, datum, notiz); } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Speichern fehlgeschlagen');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-maja-ink/40 px-4 dark:bg-black/60">
      <div role="dialog" aria-modal="true" aria-labelledby="versendet-titel" className="card w-full max-w-sm p-5">
        <h3 id="versendet-titel" className="text-base font-semibold text-maja-navy">{titel}</h3>
        {hinweis && <p className="mt-1 text-xs text-maja-muted">{hinweis}</p>}
        <fieldset className="mt-3">
          <legend className="label">Weg</legend>
          <div className="grid grid-cols-2 gap-1.5 text-sm">
            {MANUELLE_WEGE.map((w) => (
              <label key={w} className="flex items-center gap-2">
                <input type="radio" name="versand-weg" checked={weg === w} onChange={() => setWeg(w)} />
                {WEG_LABEL[w]}
              </label>
            ))}
          </div>
        </fieldset>
        <label htmlFor="versendet-datum" className="label mt-3">Datum</label>
        <input id="versendet-datum" type="date" className="input" value={datum} onChange={(e) => setDatum(e.target.value)} />
        <label htmlFor="versendet-notiz" className="label mt-3">Notiz (optional)</label>
        <input id="versendet-notiz" className="input" value={notiz} onChange={(e) => setNotiz(e.target.value)}
               placeholder="z.B. Einschreiben, Upload im Portal" />
        {fehler && <div role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>Abbrechen</button>
          <button type="button" className="btn-primary" disabled={busy || !datum} onClick={() => void bestaetigen()}>
            {busy ? 'Speichert …' : 'Als versendet markieren'}
          </button>
        </div>
      </div>
    </div>
  );
}
