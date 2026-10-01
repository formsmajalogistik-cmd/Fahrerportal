// Einstellungen → Diagnose: die letzten technischen Ereignisse von den
// Geräten der Fahrer (Migration 100). Gedacht für die Frage „was ist bei
// Fahrer X im Formular Y eigentlich passiert?".

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fahrerName } from '../../lib/names';
import { formatDateTime } from '../../lib/touren';
import { FahrerSelect, type FahrerOptionRaw } from '../touren/FahrerSelect';

interface LogZeile {
  id: number;
  created_at: string;
  fahrer_id: string | null;
  formular_id: string | null;
  bereich: string;
  ereignis: string;
  geraet: string | null;
  details: Record<string, unknown> | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMIT = 300;

/** Ereignisse, die auf ein Problem hindeuten — rot markiert. */
function istAuffaellig(ereignis: string): boolean {
  return /fehler|verworfen|nicht_gefunden|kein_|abgelaufen|timeout/i.test(ereignis);
}

function detailsText(d: Record<string, unknown> | null): string {
  if (!d) return '';
  return Object.entries(d)
    .filter(([k]) => k !== 'zeit_geraet')
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' · ');
}

export function DiagnoseLogPage() {
  const [fahrer, setFahrer] = useState<FahrerOptionRaw[]>([]);
  const [fahrerId, setFahrerId] = useState('');
  const [formularId, setFormularId] = useState('');
  const [ereignisFilter, setEreignisFilter] = useState('');
  const [nurAuffaellig, setNurAuffaellig] = useState(false);
  const [zeilen, setZeilen] = useState<LogZeile[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [neuLaden, setNeuLaden] = useState(0);

  useEffect(() => {
    void supabase
      .from('fahrer')
      .select('id, vorname, nachname, ist_unterkonto, haupt_user_id, user:user_id (email, vorname, nachname)')
      .then(({ data }) => setFahrer((data as unknown as FahrerOptionRaw[]) ?? []));
  }, []);

  const formularGueltig = formularId.trim() === '' || UUID.test(formularId.trim());

  useEffect(() => {
    if (!formularGueltig) return;
    let abgebrochen = false;
    void (async () => {
      setLoading(true);
      setFehler(null);
      let q = supabase
        .from('diagnose_log')
        .select('id, created_at, fahrer_id, formular_id, bereich, ereignis, geraet, details')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(LIMIT);
      if (fahrerId) q = q.eq('fahrer_id', fahrerId);
      if (formularId.trim()) q = q.eq('formular_id', formularId.trim());
      const { data, error } = await q;
      if (abgebrochen) return;
      if (error) {
        setFehler(error.code === '42P01' || error.code === 'PGRST205'
          ? 'Die Tabelle diagnose_log fehlt — bitte Migration 100 einspielen.'
          : error.message);
        setZeilen([]);
      } else {
        setZeilen((data as unknown as LogZeile[]) ?? []);
      }
      setLoading(false);
    })();
    return () => { abgebrochen = true; };
  }, [fahrerId, formularId, formularGueltig, neuLaden]);

  const fahrerNamen = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of fahrer) m.set(f.id, fahrerName(f, f.user ?? null) || f.user?.email || f.id.slice(0, 8));
    return m;
  }, [fahrer]);

  const ereignisse = useMemo(
    () => Array.from(new Set(zeilen.map((z) => z.ereignis))).sort(),
    [zeilen],
  );

  const sichtbar = zeilen.filter((z) =>
    (!ereignisFilter || z.ereignis === ereignisFilter)
    && (!nurAuffaellig || istAuffaellig(z.ereignis)));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-maja-navy">Diagnose</h2>
        <p className="text-sm text-maja-muted">
          Technische Ereignisse von den Geräten der Fahrer, derzeit aus der
          Schadensaufnahme (Skizze und Fotos). Keine Formularinhalte, keine
          Bilder. Einträge werden nach 30 Tagen automatisch gelöscht.
        </p>
      </div>

      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[14rem] flex-1">
          <label className="label" htmlFor="diag-fahrer">Fahrer</label>
          <FahrerSelect
            id="diag-fahrer"
            value={fahrerId}
            onChange={setFahrerId}
            fahrer={fahrer}
            placeholder="— alle Fahrer —"
          />
        </div>
        <div className="min-w-[16rem] flex-1">
          <label className="label" htmlFor="diag-formular">Formular-ID</label>
          <input
            id="diag-formular"
            className="input font-mono text-xs"
            placeholder="z.B. 3bff0413-4fb3-…"
            value={formularId}
            onChange={(e) => setFormularId(e.target.value)}
          />
          {!formularGueltig && (
            <p className="mt-1 text-xs text-red-700">Bitte die vollständige Formular-ID eingeben.</p>
          )}
        </div>
        <div className="min-w-[12rem]">
          <label className="label" htmlFor="diag-ereignis">Ereignis</label>
          <select id="diag-ereignis" className="input" value={ereignisFilter}
                  onChange={(e) => setEreignisFilter(e.target.value)}>
            <option value="">— alle —</option>
            {ereignisse.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-maja-ink">
          <input type="checkbox" checked={nurAuffaellig}
                 onChange={(e) => setNurAuffaellig(e.target.checked)}
                 className="h-4 w-4 rounded border-maja-navy/30" />
          nur Auffälliges
        </label>
        <button type="button" className="btn-secondary" onClick={() => setNeuLaden((n) => n + 1)}>
          Aktualisieren
        </button>
      </div>

      {fehler && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</div>
      )}

      <div className="card overflow-hidden">
        <div className="max-h-[70vh] overflow-auto">
          {loading ? (
            <p className="p-4 text-sm text-maja-muted">Lade …</p>
          ) : sichtbar.length === 0 ? (
            <p className="p-4 text-sm text-maja-muted">Keine Einträge.</p>
          ) : (
            <table className="w-full min-w-[48rem] text-sm">
              <thead className="sticky top-0 z-10 bg-white dark:bg-surface-800">
                <tr className="border-b border-maja-navy/10 text-left text-xs uppercase tracking-wide text-maja-muted">
                  <th className="w-36 px-3 py-2">Zeit</th>
                  <th className="w-40 px-3 py-2">Fahrer</th>
                  <th className="w-48 px-3 py-2">Ereignis</th>
                  <th className="px-3 py-2">Details</th>
                  <th className="w-28 px-3 py-2">Formular</th>
                </tr>
              </thead>
              <tbody>
                {sichtbar.map((z) => (
                  <tr key={z.id} className="border-b border-maja-navy/5 align-top last:border-b-0">
                    <td className="px-3 py-2 text-xs text-maja-muted">{formatDateTime(z.created_at)}</td>
                    <td className="px-3 py-2 text-xs">
                      {z.fahrer_id ? (
                        <button type="button" className="text-left text-maja-accent hover:underline"
                                onClick={() => setFahrerId(z.fahrer_id!)}>
                          {fahrerNamen.get(z.fahrer_id) ?? z.fahrer_id.slice(0, 8)}
                        </button>
                      ) : '—'}
                    </td>
                    <td className={`px-3 py-2 font-mono text-xs ${istAuffaellig(z.ereignis) ? 'font-semibold text-red-700' : 'text-maja-ink'}`}>
                      {z.ereignis}
                    </td>
                    <td className="px-3 py-2 text-xs text-maja-ink">
                      <div className="break-words">{detailsText(z.details)}</div>
                      {z.geraet && (
                        <div className="mt-0.5 truncate text-[11px] text-maja-muted" title={z.geraet}>
                          {z.geraet}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {z.formular_id ? (
                        <button type="button" className="font-mono text-maja-accent hover:underline"
                                title={z.formular_id}
                                onClick={() => setFormularId(z.formular_id!)}>
                          {z.formular_id.slice(0, 8)}…
                        </button>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {!loading && zeilen.length >= LIMIT && (
          <p className="border-t border-maja-navy/10 px-3 py-2 text-xs text-maja-muted">
            Es werden die letzten {LIMIT} Einträge gezeigt — für ältere bitte nach Fahrer oder Formular filtern.
          </p>
        )}
      </div>
    </div>
  );
}
