import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { XIcon } from '../../components/icons';
import type { Database } from '../../types/supabase';
import { gleicheAdresszeile, LAENDER, normLandCode, plzOrtZusammen, trennePlzOrt } from '../../lib/erechnung/stammdaten';
import { useERechnungSchema } from '../../lib/erechnung/useERechnungSchema';

type Rechnungsadresse = Database['public']['Tables']['rechnungsadressen']['Row'];
type RechnungsadresseInsert = Database['public']['Tables']['rechnungsadressen']['Insert'];

interface AdresseDraft {
  /** Existierender DB-Eintrag (id ≠ null) oder neuer Draft (id = null). */
  id: string | null;
  /** Stabiler React-Key, der bei Inserts erhalten bleibt. */
  key: string;
  firma: string;
  ansprechpartner: string;
  strasse: string;
  plz_ort: string;
  land: string;
  ist_standard: boolean;
  /** E-Rechnung (Migration 115): PLZ/Ort getrennt + ISO-Ländercode.
   *  Das PDF nutzt weiterhin plz_ort/land. */
  plz: string;
  ort: string;
  land_code: string;
}

function fromServer(r: Rechnungsadresse): AdresseDraft {
  return {
    id: r.id,
    key: r.id,
    firma: r.firma,
    ansprechpartner: r.ansprechpartner ?? '',
    strasse: r.strasse ?? '',
    plz_ort: r.plz_ort ?? '',
    land: r.land ?? '',
    ist_standard: r.ist_standard,
    plz: r.plz ?? '',
    ort: r.ort ?? '',
    land_code: r.land_code ?? '',
  };
}

function emptyDraft(): AdresseDraft {
  return {
    id: null,
    key: `new-${Math.random().toString(36).slice(2, 10)}`,
    firma: '', ansprechpartner: '', strasse: '', plz_ort: '', land: '',
    ist_standard: false,
    plz: '', ort: '', land_code: 'DE',
  };
}

interface Props {
  auftraggeberId: string | null;
  /** Wird nach jeder erfolgreichen Mutation aufgerufen — der Parent kann
   *  dann ggf. eine Toast-Meldung zeigen oder die Adressliste cachen. */
  onChanged?: () => void;
}

/**
 * Verwaltet die rechnungsadressen-Einträge eines Auftraggebers.
 * Speichert direkt in die DB (separater Lifecycle vom Auftraggeber-
 * Dialog), damit ist_standard atomar pro Adresse aktualisierbar.
 */
export function RechnungsadressenEditor({ auftraggeberId, onChanged }: Props) {
  const [list, setList] = useState<AdresseDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const schemaOk = useERechnungSchema();

  useEffect(() => {
    if (!auftraggeberId) { setList([]); return; }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const { data, error: err } = await supabase
        .from('rechnungsadressen')
        .select('*')
        .eq('auftraggeber_id', auftraggeberId)
        .order('created_at', { ascending: true });
      if (cancelled) return;
      if (err) setError(err.message);
      else setList((data ?? []).map(fromServer));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [auftraggeberId]);

  function updateLocal(key: string, patch: Partial<AdresseDraft>) {
    setList((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  function addNew() {
    setList((prev) => [...prev, emptyDraft()]);
  }

  async function save(d: AdresseDraft) {
    if (!auftraggeberId) return;
    if (!d.firma.trim()) { setError('Firma ist Pflicht.'); return; }
    if (schemaOk && d.land_code.trim() && !normLandCode(d.land_code)) {
      setError('Ländercode: bitte zwei Buchstaben angeben (z.B. DE).');
      return;
    }
    setSaving(d.key);
    setError(null);
    const payload: RechnungsadresseInsert = {
      auftraggeber_id: auftraggeberId,
      firma: d.firma.trim(),
      ansprechpartner: d.ansprechpartner.trim() || null,
      strasse: d.strasse.trim() || null,
      plz_ort: d.plz_ort.trim() || null,
      land: d.land.trim() || null,
      ist_standard: d.ist_standard,
      ...(schemaOk ? {
        plz: d.plz.trim() || null,
        ort: d.ort.trim() || null,
        land_code: normLandCode(d.land_code),
      } : {}),
    };
    if (d.id) {
      const { error: err } = await supabase
        .from('rechnungsadressen')
        .update(payload).eq('id', d.id);
      if (err) { setError(err.message); setSaving(null); return; }
      if (d.ist_standard) await clearOtherStandards(d.id);
    } else {
      const { data: created, error: err } = await supabase
        .from('rechnungsadressen')
        .insert(payload)
        .select('*').single();
      if (err || !created) { setError(err?.message ?? 'Speichern fehlgeschlagen'); setSaving(null); return; }
      if (d.ist_standard) await clearOtherStandards(created.id);
      setList((prev) => prev.map((x) => (x.key === d.key ? fromServer(created) : x)));
    }
    setSaving(null);
    onChanged?.();
  }

  async function clearOtherStandards(keepId: string) {
    if (!auftraggeberId) return;
    await supabase
      .from('rechnungsadressen')
      .update({ ist_standard: false })
      .eq('auftraggeber_id', auftraggeberId)
      .neq('id', keepId);
    setList((prev) => prev.map((x) => x.id !== keepId ? { ...x, ist_standard: false } : x));
  }

  async function remove(d: AdresseDraft) {
    if (d.id) {
      const { error: err } = await supabase.from('rechnungsadressen').delete().eq('id', d.id);
      if (err) { setError(err.message); return; }
      onChanged?.();
    }
    setList((prev) => prev.filter((x) => x.key !== d.key));
  }

  if (!auftraggeberId) {
    return <p className="text-xs text-maja-muted">Speichere den Auftraggeber zuerst, um Rechnungsadressen zu hinterlegen.</p>;
  }

  return (
    <div className="space-y-3 rounded-lg border border-maja-navy/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-maja-navy">Rechnungsadressen</h3>
        <button type="button" className="btn-secondary px-3 py-1 text-sm" onClick={addNew}>
          + Adresse hinzufügen
        </button>
      </div>

      {loading && <p className="text-xs text-maja-muted">Lädt …</p>}
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {!loading && list.length === 0 ? (
        <p className="text-xs text-maja-muted">Noch keine Rechnungsadressen hinterlegt.</p>
      ) : (
        <ul className="space-y-3">
          {list.map((d) => (
            <li key={d.key} className="rounded-md border border-maja-navy/10 p-3">
              <div className="mb-2 flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="radio"
                    name={`std-${auftraggeberId}`}
                    checked={d.ist_standard}
                    onChange={() => {
                      setList((prev) => prev.map((x) =>
                        ({ ...x, ist_standard: x.key === d.key }),
                      ));
                    }}
                    className="h-4 w-4 border-maja-navy/30 text-maja-navy"
                  />
                  Standard-Rechnungsadresse
                </label>
                <button
                  type="button"
                  onClick={() => void remove(d)}
                  aria-label="Entfernen"
                  className="rounded-md px-2 py-1 text-red-600 hover:bg-red-50"
                ><XIcon className="h-4 w-4" /></button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="label">Firma *</label>
                  <input className="input" value={d.firma}
                         onChange={(e) => updateLocal(d.key, { firma: e.target.value })} />
                </div>
                <div>
                  <label className="label">Ansprechpartner</label>
                  <input className="input" value={d.ansprechpartner}
                         onChange={(e) => updateLocal(d.key, { ansprechpartner: e.target.value })} />
                </div>
                <div>
                  <label className="label">Straße</label>
                  <input className="input" value={d.strasse}
                         onChange={(e) => updateLocal(d.key, { strasse: e.target.value })} />
                </div>
                <div>
                  <label className="label">PLZ / Ort</label>
                  <input className="input" value={d.plz_ort}
                         onChange={(e) => updateLocal(d.key, { plz_ort: e.target.value })} />
                </div>
                <div>
                  <label className="label">Land</label>
                  <input className="input" value={d.land}
                         onChange={(e) => updateLocal(d.key, { land: e.target.value })} />
                </div>
              </div>
              {schemaOk && <ERechnungAdresse d={d} onPatch={(p) => updateLocal(d.key, p)} />}
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  className="btn-primary px-3 py-1 text-sm"
                  disabled={saving === d.key}
                  onClick={() => void save(d)}
                >
                  {saving === d.key ? 'Speichert …' : d.id ? 'Aktualisieren' : 'Speichern'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * PLZ, Ort und Ländercode getrennt — für die spätere E-Rechnung. Das
 * PDF verwendet weiterhin „PLZ / Ort" und „Land" von oben. Übernahme
 * aus dem kombinierten Feld nur auf Knopfdruck und nur, wenn die
 * Trennung eindeutig ist.
 */
function ERechnungAdresse({ d, onPatch }: { d: AdresseDraft; onPatch: (p: Partial<AdresseDraft>) => void }) {
  const vorschlag = trennePlzOrt(d.plz_ort, d.land);
  const getrennt = plzOrtZusammen(d.plz, d.ort);
  const abweichend = getrennt !== '' && d.plz_ort.trim() !== '' && !gleicheAdresszeile(getrennt, d.plz_ort);
  const kannUebernehmen = vorschlag.status === 'eindeutig'
    && (vorschlag.plz !== d.plz.trim() || vorschlag.ort !== d.ort.trim()
      || (!d.land_code.trim() && !!vorschlag.landCode));
  const id = `ra-${d.key}`;
  return (
    <div className="mt-3 rounded-md bg-maja-light/50 p-3" data-testid="ra-erechnung">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-maja-navy">Für die E-Rechnung (getrennt)</span>
        {kannUebernehmen && (
          <button type="button" className="btn-secondary px-2 py-1 text-xs"
                  onClick={() => onPatch({
                    plz: vorschlag.plz ?? '', ort: vorschlag.ort ?? '',
                    land_code: d.land_code.trim() || vorschlag.landCode || '',
                  })}>
            Aus „PLZ / Ort" übernehmen
          </button>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_2fr_1fr]">
        <div>
          <label htmlFor={`${id}-plz`} className="label">PLZ</label>
          <input id={`${id}-plz`} className="input" value={d.plz}
                 onChange={(e) => onPatch({ plz: e.target.value })} />
        </div>
        <div>
          <label htmlFor={`${id}-ort`} className="label">Ort</label>
          <input id={`${id}-ort`} className="input" value={d.ort}
                 onChange={(e) => onPatch({ ort: e.target.value })} />
        </div>
        <div>
          <label htmlFor={`${id}-land-code`} className="label">Ländercode</label>
          <input id={`${id}-land-code`} className="input uppercase" maxLength={2} placeholder="DE"
                 list={`${id}-laender`} value={d.land_code}
                 onChange={(e) => onPatch({ land_code: e.target.value.toUpperCase() })} />
          <datalist id={`${id}-laender`}>
            {LAENDER.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </datalist>
        </div>
      </div>
      {abweichend && (
        <p className="mt-1 text-xs text-amber-700 dark:!text-amber-300">
          Weicht von „PLZ / Ort" ({d.plz_ort.trim()}) ab — das PDF druckt weiterhin „PLZ / Ort".
        </p>
      )}
      {!getrennt && vorschlag.status === 'manuell' && d.plz_ort.trim() !== '' && (
        <p className="mt-1 text-xs text-maja-muted">
          Automatische Trennung nicht eindeutig ({vorschlag.hinweise.join('; ')}) — bitte von Hand eintragen.
        </p>
      )}
    </div>
  );
}
