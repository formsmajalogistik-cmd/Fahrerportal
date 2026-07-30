// Einstellungen für das Gutschrift-Dokument (Migration 078).
//
// Der Steuerberater gibt vor, wie das Dokument heißen soll — deshalb ist
// die Bezeichnung hier pflegbar statt im Code. Sie erscheint in der
// PDF-Überschrift, im E-Mail-Betreff und in der Übersicht.

import { useCallback, useEffect, useState } from 'react';
import { Spinner } from '../../components/Spinner';
import { useTestGuard } from '../../auth/TestModeContext';
import {
  DEFAULT_GUTSCHRIFT_SETTINGS, DOKUMENTBEZEICHNUNG_VORSCHLAEGE,
  beispielNummer, loadGutschriftSettings, saveGutschriftSettings,
  type GutschriftSettings,
} from '../../lib/gutschriftSettings';

export function GutschriftSettingsPage() {
  const guard = useTestGuard();
  const [cfg, setCfg] = useState<GutschriftSettings>(DEFAULT_GUTSCHRIFT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setCfg(await loadGutschriftSettings());
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(t);
  }, [load]);

  function patch(p: Partial<GutschriftSettings>) {
    setCfg((cur) => ({ ...cur, ...p }));
    setSaved(false);
  }

  async function speichern() {
    if (guard('Testmodus — Einstellungen werden nicht gespeichert.')) return;
    setSaving(true);
    setError(null);
    try {
      await saveGutschriftSettings(cfg);
      setCfg(await loadGutschriftSettings());
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner label="Einstellungen werden geladen …" />;

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-maja-navy">Gutschriften</h2>
        <p className="text-sm text-maja-muted">
          Bezeichnung, Nummernformat und Standard-Texte für Gutschriften /
          Rechnungskorrekturen. Änderungen gelten für neu erzeugte PDFs und
          E-Mails; bereits erstellte Dokumente bleiben unverändert.
        </p>
      </div>

      <section className="card space-y-4 p-5">
        <div>
          <label htmlFor="gs-bezeichnung" className="label">Dokumentbezeichnung</label>
          <input
            id="gs-bezeichnung"
            className="input"
            list="gs-bezeichnung-vorschlaege"
            value={cfg.dokumentbezeichnung}
            onChange={(e) => patch({ dokumentbezeichnung: e.target.value })}
          />
          <datalist id="gs-bezeichnung-vorschlaege">
            {DOKUMENTBEZEICHNUNG_VORSCHLAEGE.map((v) => <option key={v} value={v} />)}
          </datalist>
          <p className="mt-1 text-xs text-maja-muted">
            Wird als Überschrift auf der PDF, im E-Mail-Betreff und in der
            Übersicht verwendet. Üblich: {DOKUMENTBEZEICHNUNG_VORSCHLAEGE.join(', ')}.
          </p>
        </div>

        <div>
          <label htmlFor="gs-format" className="label">Nummernformat</label>
          <input
            id="gs-format"
            className="input font-mono text-sm"
            value={cfg.nummernformat}
            onChange={(e) => patch({ nummernformat: e.target.value })}
          />
          <p className="mt-1 text-xs text-maja-muted">
            Platzhalter <code>{'{Jahr}'}</code> und <code>{'{Nr}'}</code>.
            Beispiel: <strong>{beispielNummer(cfg.nummernformat)}</strong>.
            Die Serie läuft getrennt von den Rechnungsnummern und beginnt
            jedes Jahr neu bei 1.
          </p>
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <h3 className="text-sm font-semibold text-maja-navy">Standard-Texte</h3>
        <div>
          <label htmlFor="gs-einleitung" className="label">Einleitungstext</label>
          <textarea
            id="gs-einleitung"
            className="input min-h-[4rem]"
            value={cfg.einleitungstext}
            onChange={(e) => patch({ einleitungstext: e.target.value })}
          />
          <p className="mt-1 text-xs text-maja-muted">
            Steht unter der Anrede, vor der Positionstabelle. Pro Gutschrift
            überschreibbar.
          </p>
        </div>
        <div>
          <label htmlFor="gs-schluss" className="label">Schlusstext</label>
          <textarea
            id="gs-schluss"
            className="input min-h-[4rem]"
            value={cfg.schlusstext}
            onChange={(e) => patch({ schlusstext: e.target.value })}
          />
          <p className="mt-1 text-xs text-maja-muted">
            Steht unter dem Summenblock, vor dem Gruß.
          </p>
        </div>
        <div>
          <label htmlFor="gs-summen" className="label">Beschriftung des Gesamtbetrags</label>
          <input
            id="gs-summen"
            className="input"
            value={cfg.summen_label}
            onChange={(e) => patch({ summen_label: e.target.value })}
          />
          <p className="mt-1 text-xs text-maja-muted">
            Ersetzt „Brutto" in der letzten Zeile des Summenblocks.
          </p>
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="btn-primary"
          disabled={saving}
          onClick={() => void speichern()}
        >
          {saving ? 'Speichert …' : 'Speichern'}
        </button>
        {saved && <span className="text-sm text-emerald-700">Gespeichert.</span>}
      </div>
    </div>
  );
}
