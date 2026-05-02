import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import {
  fahrzeugprotokollSchema,
  FAHRZEUGPROTOKOLL_DEFAULT_NAME,
} from '../../lib/templates/fahrzeugprotokoll';
import type { Auftraggeber } from '../../types/db';
import type { Json } from '../../types/supabase';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export function TemplateNewDialog({ onClose, onCreated }: Props) {
  const [name, setName] = useState(FAHRZEUGPROTOKOLL_DEFAULT_NAME);
  const [auftraggeber, setAuftraggeber] = useState<Auftraggeber[]>([]);
  const [auftraggeberId, setAuftraggeberId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('auftraggeber').select('*').order('name');
      setAuftraggeber(data ?? []);
    })();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.from('formular_templates').insert({
      name: name.trim() || FAHRZEUGPROTOKOLL_DEFAULT_NAME,
      auftraggeber_id: auftraggeberId || null,
      schema: fahrzeugprotokollSchema as unknown as Json,
      pdfs: [] as unknown as Json,
      email_config: null,
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-maja-ink/40 px-4">
      <div className="card w-full max-w-md p-6">
        <h2 className="mb-1 text-lg font-semibold text-maja-navy">
          Fahrzeugprotokoll anlegen
        </h2>
        <p className="mb-4 text-xs text-maja-muted">
          Legt das Maja-Logistik Standard-Fahrzeugprotokoll mit allen Sektionen
          (Fahrzeugdaten, Übernahme, Übergabe, Zubehör, Schäden, Reifen, Fotos,
          Unterschriften) an.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="tpl-name" className="label">Name</label>
            <input
              id="tpl-name"
              className="input"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="tpl-ag" className="label">Auftraggeber (optional)</label>
            <select
              id="tpl-ag"
              className="input"
              value={auftraggeberId}
              onChange={(e) => setAuftraggeberId(e.target.value)}
            >
              <option value="">— kein Auftraggeber —</option>
              {auftraggeber.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            {auftraggeber.find((a) => a.id === auftraggeberId)?.kontakt && (
              <p className="mt-1 text-xs text-maja-muted">
                Kontakt: {auftraggeber.find((a) => a.id === auftraggeberId)!.kontakt}
              </p>
            )}
          </div>

          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              Abbrechen
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Anlegen …' : 'Anlegen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
