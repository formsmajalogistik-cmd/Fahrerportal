import { useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import type { Auftraggeber } from '../../types/db';

interface Props {
  initial: Auftraggeber | null;
  onClose: () => void;
  onSaved: () => void;
}

export function AuftraggeberEditDialog({ initial, onClose, onSaved }: Props) {
  const isNew = !initial;
  const [name, setName]       = useState(initial?.name ?? '');
  const [kontakt, setKontakt] = useState(initial?.kontakt ?? '');
  const [strasse, setStrasse] = useState(initial?.strasse ?? '');
  const [plz, setPlz]         = useState(initial?.plz ?? '');
  const [ort, setOrt]         = useState(initial?.ort ?? '');
  const [email1, setEmail1]   = useState(initial?.email1 ?? '');
  const [email2, setEmail2]   = useState(initial?.email2 ?? '');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      name: name.trim(),
      kontakt: kontakt.trim() || null,
      strasse: strasse.trim() || null,
      plz:     plz.trim() || null,
      ort:     ort.trim() || null,
      email1:  email1.trim() || null,
      email2:  email2.trim() || null,
    };
    const { error: err } = isNew
      ? await supabase.from('auftraggeber').insert(payload)
      : await supabase.from('auftraggeber').update(payload).eq('id', initial!.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-maja-ink/40 px-4 py-6 overflow-auto">
      <div className="card w-full max-w-lg p-6">
        <h2 className="mb-4 text-lg font-semibold text-maja-navy">
          {isNew ? 'Neuen Auftraggeber anlegen' : 'Auftraggeber bearbeiten'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="ag-name" className="label">Name *</label>
            <input id="ag-name" className="input" required
                   value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div>
            <label htmlFor="ag-kontakt" className="label">Kontaktperson</label>
            <input id="ag-kontakt" className="input"
                   value={kontakt} onChange={(e) => setKontakt(e.target.value)} />
          </div>

          <div className="grid gap-3 sm:grid-cols-[2fr_1fr_2fr]">
            <div>
              <label htmlFor="ag-strasse" className="label">Straße</label>
              <input id="ag-strasse" className="input"
                     value={strasse} onChange={(e) => setStrasse(e.target.value)} />
            </div>
            <div>
              <label htmlFor="ag-plz" className="label">PLZ</label>
              <input id="ag-plz" className="input"
                     value={plz} onChange={(e) => setPlz(e.target.value)} />
            </div>
            <div>
              <label htmlFor="ag-ort" className="label">Ort</label>
              <input id="ag-ort" className="input"
                     value={ort} onChange={(e) => setOrt(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="ag-email1" className="label">E-Mail 1</label>
              <input id="ag-email1" type="email" className="input"
                     value={email1} onChange={(e) => setEmail1(e.target.value)} />
            </div>
            <div>
              <label htmlFor="ag-email2" className="label">E-Mail 2</label>
              <input id="ag-email2" type="email" className="input"
                     value={email2} onChange={(e) => setEmail2(e.target.value)} />
            </div>
          </div>

          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Abbrechen</button>
            <button type="submit" className="btn-primary" disabled={saving || !name.trim()}>
              {saving ? 'Speichern …' : 'Speichern'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
