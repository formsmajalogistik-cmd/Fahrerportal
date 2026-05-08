import { useState } from 'react';

interface Props {
  /** Wird aufgerufen wenn der User „Speichern" wählt. Nach Erfolg → onLeave. */
  onSave: () => Promise<void>;
  /** Wird aufgerufen wenn der User „Verwerfen" oder nach erfolgreichem Save „weitergehen" wählt. */
  onLeave: () => void;
  /** Wird aufgerufen wenn der User „Abbrechen" wählt. */
  onCancel: () => void;
}

export function UnsavedChangesDialog({ onSave, onLeave, onCancel }: Props) {
  const [busy, setBusy] = useState<'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setBusy('save');
    setError(null);
    try {
      await onSave();
      onLeave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-maja-ink/50 px-4">
      <div className="card w-full max-w-md p-6">
        <h2 className="mb-2 text-lg font-semibold text-maja-navy">
          Ungespeicherte Änderungen
        </h2>
        <p className="mb-4 text-sm text-maja-ink">
          Du hast ungespeicherte Änderungen. Möchtest du speichern bevor du gehst?
        </p>

        {error && (
          <div role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary" disabled={busy !== null}>
            Abbrechen
          </button>
          <button
            type="button"
            onClick={onLeave}
            disabled={busy !== null}
            className="rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Verwerfen
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy !== null}
            className="btn-primary"
          >
            {busy === 'save' ? 'Speichert …' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
}
