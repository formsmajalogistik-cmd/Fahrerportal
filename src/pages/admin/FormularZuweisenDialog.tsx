// Eingänge (Admin): begonnenes Formular einem anderen Fahrer zuweisen.
//
// Zeigt, wie aktuell der Server-Stand ist (nur der liegt bei Fahrer B an),
// lässt Fahrer/Unterkonto wählen, optional die Tour mitnehmen und eine
// Notiz an B mitgeben. Ausgeführt wird atomar in der Datenbankfunktion
// formular_zuweisen (Migration 108): Snapshot, Bearbeiter → B, Kennung +1,
// Tour (optional), Protokoll. Fotos bleiben im Formular-Ordner.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { XIcon } from '../../components/icons';
import { FahrerSelect, type FahrerOptionRaw } from '../touren/FahrerSelect';
import { felderAnzahl } from '../../lib/entwurfStand';
import { kennzeichenAusDaten } from '../../lib/onedrivePaths';
import { geraetKurz, speicherungVeraltet } from '../../lib/formularZuweisung';
import { formatDate, formatDateTime } from '../../lib/touren';
import { diagnose } from '../../lib/diagnose';
import type { FormSchema } from '../../types/db';

interface Props {
  formular: {
    id: string;
    created_at: string;
    daten: Record<string, unknown>;
    templateName: string;
    schema: FormSchema;
    fahrerName: string;
  };
  onClose: () => void;
  onDone: (text: string) => void;
}

interface Stand {
  fahrer_id: string;
  daten_geaendert_am: string | null;
  daten_app_modus: string | null;
  daten: Record<string, unknown>;
}
interface TourKurz { id: string; tour_id: string | null; fahrer_id: string | null; start_stadt: string; ziel_stadt: string; rueckfuehrung_stadt: string | null }

function fotoAnzahl(d: Record<string, unknown>): number {
  return (JSON.stringify(d).match(/"storage_path"/g) ?? []).length;
}

export function FormularZuweisenDialog({ formular, onClose, onDone }: Props) {
  const [stand, setStand] = useState<Stand | null>(null);
  const [geraet, setGeraet] = useState<string | null>(null);
  const [fahrer, setFahrer] = useState<FahrerOptionRaw[]>([]);
  const [tour, setTour] = useState<TourKurz | null>(null);
  const [neu, setNeu] = useState('');
  const [tourMit, setTourMit] = useState(true);
  const [notiz, setNotiz] = useState('');
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const felderGesamt = useMemo(
    () => (formular.schema.sections ?? []).reduce((n, s) => n + (s.fields ?? []).length, 0),
    [formular.schema],
  );

  useEffect(() => {
    let weg = false;
    void (async () => {
      // Frisch vom Server — der Stand in der Liste kann älter sein.
      const [sRes, dRes, fRes] = await Promise.all([
        supabase.from('ausgefuellte_formulare')
          .select('fahrer_id, daten_geaendert_am, daten_app_modus, daten').eq('id', formular.id).maybeSingle(),
        supabase.from('diagnose_log').select('geraet, created_at')
          .eq('formular_id', formular.id).like('ereignis', 'entwurf_%')
          .order('created_at', { ascending: false }).limit(1),
        supabase.from('fahrer')
          .select('id, vorname, nachname, ist_unterkonto, haupt_user_id, user:user_id (email, vorname, nachname)')
          .eq('aktiv', true),
      ]);
      if (weg) return;
      if (sRes.error) setFehler(sRes.error.message);
      const s = (sRes.data as unknown as Stand | null) ?? null;
      setStand(s);
      setGeraet(geraetKurz(((dRes.data ?? [])[0] as { geraet: string | null } | undefined)?.geraet));
      setFahrer(((fRes.data as unknown as FahrerOptionRaw[]) ?? []).filter((x) => x.id !== s?.fahrer_id));
      const tourId = typeof s?.daten?._tour_id === 'string' ? s.daten._tour_id : null;
      if (tourId) {
        const { data: t } = await supabase.from('touren')
          .select('id, tour_id, fahrer_id, start_stadt, ziel_stadt, rueckfuehrung_stadt').eq('id', tourId).maybeSingle();
        if (!weg) setTour((t as TourKurz | null) ?? null);
      }
    })();
    return () => { weg = true; };
  }, [formular.id]);

  const daten = stand?.daten ?? formular.daten;
  const veraltet = speicherungVeraltet(stand?.daten_geaendert_am);
  const modus = stand?.daten_app_modus === 'app' ? 'installierte App' : stand?.daten_app_modus === 'browser' ? 'Browser' : null;

  async function zuweisen() {
    if (!neu || !stand) return;
    setBusy(true); setFehler(null);
    const { data, error } = await supabase.rpc('formular_zuweisen', {
      p_formular_id: formular.id, p_an_fahrer_id: neu,
      p_tour_mitnehmen: !!tour && tourMit, p_notiz: notiz.trim() || null,
    });
    setBusy(false);
    if (error) { setFehler(error.message); return; }
    const r = data as { von: string; an: string; felder: number; tour_mitgenommen: boolean };
    diagnose('formular_zugewiesen', {
      von: stand.fahrer_id, an: neu, felder: r.felder, tour_mitgenommen: r.tour_mitgenommen,
    }, 'zuweisung', formular.id);
    onDone(`Formular von ${r.von} an ${r.an} zugewiesen${r.tour_mitgenommen ? ' — die Tour ebenfalls' : ''}. ${r.an} sieht es jetzt in seiner Liste.`);
  }

  const kz = kennzeichenAusDaten(daten);
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8 dark:bg-black/60">
      <div role="dialog" aria-modal="true" aria-labelledby="zuweisen-titel" className="card w-full max-w-lg p-6">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id="zuweisen-titel" className="text-lg font-semibold text-maja-navy">Anderem Fahrer zuweisen</h2>
          <button type="button" onClick={onClose} aria-label="Schließen" className="rounded-md p-1 text-maja-muted hover:bg-maja-light">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <dl className="space-y-1 text-sm">
          <div><dt className="inline text-maja-muted">Formular: </dt>
            <dd className="inline text-maja-ink">{formular.templateName}{kz ? ` · ${kz}` : ''} · begonnen {formatDate(formular.created_at)} von {formular.fahrerName}</dd></div>
          <div><dt className="inline text-maja-muted">Letzte Speicherung auf dem Server: </dt>
            <dd className="inline text-maja-ink">
              {stand?.daten_geaendert_am ? formatDateTime(stand.daten_geaendert_am) : 'unbekannt'}
              {(geraet || modus) && ` (${geraet ?? modus})`}
            </dd></div>
          <div><dt className="inline text-maja-muted">Ausgefüllt: </dt>
            <dd className="inline text-maja-ink">{felderAnzahl(daten)} von {felderGesamt} Feldern · {fotoAnzahl(daten)} Fotos</dd></div>
        </dl>

        {stand && veraltet && (
          <div role="note" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {formular.fahrerName} hat möglicherweise noch nicht übertragene Änderungen auf seinem Gerät.
            Ggf. vorher {formular.fahrerName} bitten, die App mit Internet zu öffnen.
          </div>
        )}

        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor="zuweisen-fahrer" className="label">Neuer Fahrer</label>
            <FahrerSelect id="zuweisen-fahrer" value={neu} onChange={setNeu} fahrer={fahrer} placeholder="— Fahrer / Unterkonto wählen —" />
          </div>
          {tour && (
            <fieldset className="text-sm">
              <legend className="label">Tour {tour.tour_id ?? ''} ({tour.start_stadt} → {tour.ziel_stadt}{tour.rueckfuehrung_stadt ? ` → ${tour.rueckfuehrung_stadt}` : ''})</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="tour-option" checked={!tourMit} onChange={() => setTourMit(false)} />
                Fahrer der Tour unverändert lassen
              </label>
              <label className="mt-1 flex items-center gap-2">
                <input type="radio" name="tour-option" checked={tourMit} onChange={() => setTourMit(true)} />
                Tour ebenfalls dem neuen Fahrer zuweisen
              </label>
            </fieldset>
          )}
          <div>
            <label htmlFor="zuweisen-notiz" className="label">Notiz an den neuen Fahrer (optional)</label>
            <textarea id="zuweisen-notiz" className="input min-h-[4rem]" value={notiz} onChange={(e) => setNotiz(e.target.value)}
                      placeholder="z.B. Übergabe beim Kunden in Hamburg, Schlüssel liegt im Fahrzeug" />
          </div>
        </div>

        <p className="mt-3 text-xs text-maja-muted">
          Bereits ausgefüllte Teile (inkl. Unterschriften) bleiben unverändert. Fotos bleiben im Formular-Ordner.
          Der aktuelle Stand wird vorher als Version gesichert. Vergütung/Honorar werden nicht aufgeteilt.
        </p>

        {fehler && <div role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</div>}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Abbrechen</button>
          <button type="button" className="btn-primary" onClick={() => void zuweisen()} disabled={busy || !neu || !stand}>
            {busy ? 'Weist zu …' : 'Zuweisen'}
          </button>
        </div>
      </div>
    </div>
  );
}
