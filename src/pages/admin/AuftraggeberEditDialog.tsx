import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import type { Auftraggeber, AuftraggeberKontakt } from '../../types/db';
import { RechnungsadressenEditor } from './RechnungsadressenEditor';
import { RechnungsformatEditor } from './RechnungsformatEditor';
import type { Rechnungsformat } from '../../lib/rechnungsformat';
import type { Json } from '../../types/supabase';

interface Props {
  initial: Auftraggeber | null;
  onClose: () => void;
  onSaved: () => void;
}

interface KontaktDraft {
  key: string;
  id: string | null;
  name: string;
  telefon: string;
  email: string;
  position: string;
}

function newKontakt(): KontaktDraft {
  return {
    key: `new-${Math.random().toString(36).slice(2, 10)}`,
    id: null,
    name: '',
    telefon: '',
    email: '',
    position: '',
  };
}

function fromServer(k: AuftraggeberKontakt): KontaktDraft {
  return {
    key: k.id,
    id: k.id,
    name: k.name,
    telefon: k.telefon ?? '',
    email: k.email ?? '',
    position: k.position ?? '',
  };
}

export function AuftraggeberEditDialog({ initial, onClose, onSaved }: Props) {
  const isNew = !initial;
  const [name, setName]       = useState(initial?.name ?? '');
  const [strasse, setStrasse] = useState(initial?.strasse ?? '');
  const [plz, setPlz]         = useState(initial?.plz ?? '');
  const [ort, setOrt]         = useState(initial?.ort ?? '');
  const [email1, setEmail1]   = useState(initial?.email1 ?? '');
  const [email2, setEmail2]   = useState(initial?.email2 ?? '');
  const [externeAppName, setExterneAppName] = useState(initial?.externe_app_name ?? '');
  const [externeAppUrl,  setExterneAppUrl]  = useState(initial?.externe_app_url  ?? '');

  // Rechnungs-Metadaten
  const [kundennummer,   setKundennummer]   = useState(initial?.kundennummer ?? '');
  const [sachbearbeiter, setSachbearbeiter] = useState(initial?.sachbearbeiter ?? '');
  const [kundenUid,      setKundenUid]      = useState(initial?.kunden_uid ?? '');
  const [zahlungsziel,   setZahlungsziel]   = useState<string>(
    initial?.zahlungsziel_tage != null ? String(initial.zahlungsziel_tage) : '',
  );
  const [rechnungsformat, setRechnungsformat] = useState<Rechnungsformat | null>(
    (initial?.rechnungsformat as Rechnungsformat | null) ?? null,
  );

  // Erst nach dem Speichern eines NEUEN Auftraggebers haben wir eine ID
  // für die rechnungsadressen — bis dahin disabelen wir den Bereich.
  const [auftraggeberIdLive, setAuftraggeberIdLive] = useState<string | null>(initial?.id ?? null);

  // Kontakte
  const [serverKontakte, setServerKontakte] = useState<AuftraggeberKontakt[]>([]);
  const [kontakte, setKontakte]             = useState<KontaktDraft[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!initial) {
      // Neuer Auftraggeber → leere Liste, ggf. legacy `kontakt` als ersten Eintrag.
      setKontakte([]);
      setServerKontakte([]);
      return;
    }
    void (async () => {
      const { data } = await supabase
        .from('auftraggeber_kontakte')
        .select('*')
        .eq('auftraggeber_id', initial.id)
        .order('created_at', { ascending: true });
      const list = Array.isArray(data) ? data : [];
      setServerKontakte(list);
      if (list.length > 0) {
        setKontakte(list.map(fromServer));
      } else if (initial.kontakt && initial.kontakt.trim()) {
        // Legacy single-kontakt-Feld als ersten Kontakt vorbelegen.
        const fresh = newKontakt();
        fresh.name = initial.kontakt.trim();
        setKontakte([fresh]);
      } else {
        setKontakte([]);
      }
    })();
  }, [initial]);

  function updateK(key: string, patch: Partial<KontaktDraft>) {
    setKontakte((ks) => ks.map((k) => (k.key === key ? { ...k, ...patch } : k)));
  }
  function removeK(key: string) {
    setKontakte((ks) => ks.filter((k) => k.key !== key));
  }
  function addK() {
    setKontakte((ks) => [...ks, newKontakt()]);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Name ist Pflicht.'); return; }
    setError(null);
    setSaving(true);
    try {
      // Auftraggeber speichern (kontakt-Legacy-Feld auf primären Kontakt-Namen
      // synchronisieren, damit alte Anzeigen weiter sinnvolle Werte zeigen).
      const primaerKontaktName = kontakte[0]?.name.trim() || null;
      const zahlungszielN = zahlungsziel.trim() ? Number(zahlungsziel) : null;
      const payload = {
        name: name.trim(),
        kontakt: primaerKontaktName,
        strasse: strasse.trim() || null,
        plz:     plz.trim() || null,
        ort:     ort.trim() || null,
        email1:  email1.trim() || null,
        email2:  email2.trim() || null,
        externe_app_name: externeAppName.trim() || null,
        externe_app_url:  externeAppUrl.trim()  || null,
        kundennummer:   kundennummer.trim()   || null,
        sachbearbeiter: sachbearbeiter.trim() || null,
        kunden_uid:     kundenUid.trim()      || null,
        zahlungsziel_tage: zahlungszielN != null && Number.isFinite(zahlungszielN) ? zahlungszielN : null,
        rechnungsformat: (rechnungsformat as unknown as Json | null) ?? null,
      };
      let auftraggeberId: string;
      if (isNew) {
        const { data, error: err } = await supabase
          .from('auftraggeber').insert(payload).select('id').single();
        if (err) throw err;
        auftraggeberId = data.id;
        setAuftraggeberIdLive(auftraggeberId);
      } else {
        const { error: err } = await supabase
          .from('auftraggeber').update(payload).eq('id', initial!.id);
        if (err) throw err;
        auftraggeberId = initial!.id;
      }

      // Kontakte diffen
      const draftIds = new Set(kontakte.map((k) => k.id).filter((id): id is string => !!id));
      const toDelete = serverKontakte.filter((s) => !draftIds.has(s.id)).map((s) => s.id);
      const toInsert = kontakte
        .filter((k) => k.id === null && k.name.trim())
        .map((k) => ({
          auftraggeber_id: auftraggeberId,
          name: k.name.trim(),
          telefon: k.telefon.trim() || null,
          email: k.email.trim() || null,
          position: k.position.trim() || null,
        }));
      const toUpdate = kontakte.filter((k) => k.id !== null && k.name.trim());

      if (toDelete.length > 0) {
        const { error: err } = await supabase
          .from('auftraggeber_kontakte').delete().in('id', toDelete);
        if (err) throw err;
      }
      if (toInsert.length > 0) {
        const { error: err } = await supabase
          .from('auftraggeber_kontakte').insert(toInsert);
        if (err) throw err;
      }
      for (const u of toUpdate) {
        const { error: err } = await supabase
          .from('auftraggeber_kontakte').update({
            name: u.name.trim(),
            telefon: u.telefon.trim() || null,
            email: u.email.trim() || null,
            position: u.position.trim() || null,
          }).eq('id', u.id!);
        if (err) throw err;
      }

      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center bg-maja-ink/40 px-4 py-6 overflow-auto">
      <div className="card w-full max-w-2xl p-6">
        <h2 className="mb-4 text-lg font-semibold text-maja-navy">
          {isNew ? 'Neuen Auftraggeber anlegen' : 'Auftraggeber bearbeiten'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="ag-name" className="label">Name *</label>
            <input id="ag-name" className="input" required
                   value={name} onChange={(e) => setName(e.target.value)} />
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

          {/* Externe Protokollierungs-App */}
          <div className="space-y-3 rounded-lg border border-maja-navy/10 p-4">
            <h3 className="text-sm font-semibold text-maja-navy">Externe Protokollierungs-App</h3>
            <p className="text-xs text-maja-muted">
              Wenn gesetzt, wird bei Touren dieses Auftraggebers mit Protokollart
              „App" ein Button zur externen App angezeigt.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="ag-extname" className="label">App-Name</label>
                <input id="ag-extname" className="input" placeholder="z.B. FleetBoard App"
                       value={externeAppName}
                       onChange={(e) => setExterneAppName(e.target.value)} />
              </div>
              <div>
                <label htmlFor="ag-exturl" className="label">App-URL</label>
                <input id="ag-exturl" className="input" type="url"
                       placeholder="https://app.fleetboard.de oder fleetboard://"
                       value={externeAppUrl}
                       onChange={(e) => setExterneAppUrl(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Rechnungs-Stammdaten */}
          <div className="space-y-3 rounded-lg border border-maja-navy/10 p-4">
            <h3 className="text-sm font-semibold text-maja-navy">Rechnungs-Stammdaten</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="ag-kdnr" className="label">Kundennummer</label>
                <input id="ag-kdnr" className="input"
                       value={kundennummer} onChange={(e) => setKundennummer(e.target.value)} />
              </div>
              <div>
                <label htmlFor="ag-sb" className="label">Sachbearbeiter</label>
                <input id="ag-sb" className="input"
                       value={sachbearbeiter} onChange={(e) => setSachbearbeiter(e.target.value)} />
              </div>
              <div>
                <label htmlFor="ag-uid" className="label">Kunden-UID</label>
                <input id="ag-uid" className="input"
                       value={kundenUid} onChange={(e) => setKundenUid(e.target.value)} />
              </div>
              <div>
                <label htmlFor="ag-zz" className="label">Zahlungsziel (Tage)</label>
                <input id="ag-zz" className="input" type="number" min={0}
                       value={zahlungsziel} onChange={(e) => setZahlungsziel(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Rechnungsadressen */}
          <RechnungsadressenEditor auftraggeberId={auftraggeberIdLive} />

          {/* Rechnungsformat */}
          <RechnungsformatEditor value={rechnungsformat} onChange={setRechnungsformat} />

          {/* Kontakte */}
          <div className="space-y-3 rounded-lg border border-maja-navy/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-maja-navy">Kontakte</h3>
              <button type="button" className="btn-secondary px-3 py-1 text-sm" onClick={addK}>
                + Kontakt hinzufügen
              </button>
            </div>
            {kontakte.length === 0 ? (
              <p className="text-xs text-maja-muted">Noch keine Kontakte hinterlegt.</p>
            ) : (
              <ul className="space-y-3">
                {kontakte.map((k, idx) => (
                  <li key={k.key} className="rounded-md border border-maja-navy/10 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium text-maja-muted">Kontakt {idx + 1}</span>
                      <button
                        type="button"
                        onClick={() => removeK(k.key)}
                        aria-label="Kontakt entfernen"
                        className="rounded-md px-2 py-1 text-red-600 hover:bg-red-50"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <label className="label">Name *</label>
                        <input className="input" value={k.name}
                               onChange={(e) => updateK(k.key, { name: e.target.value })} />
                      </div>
                      <div>
                        <label className="label">Position / Rolle</label>
                        <input className="input" value={k.position}
                               onChange={(e) => updateK(k.key, { position: e.target.value })} />
                      </div>
                      <div>
                        <label className="label">Telefon</label>
                        <input className="input" type="tel" value={k.telefon}
                               onChange={(e) => updateK(k.key, { telefon: e.target.value })} />
                      </div>
                      <div>
                        <label className="label">E-Mail</label>
                        <input className="input" type="email" value={k.email}
                               onChange={(e) => updateK(k.key, { email: e.target.value })} />
                      </div>
                    </div>
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
