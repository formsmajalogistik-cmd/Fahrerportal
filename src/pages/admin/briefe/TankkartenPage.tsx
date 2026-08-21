// Tankkarten-Verwaltung (Migration 091).
//
// Kartennummern sind sensibel und ausschließlich für Admins sichtbar —
// die Tabelle ist per RLS admin-only. Fahrer bekommen ihre Nummer nur
// im Überlassungsbrief zu sehen, es gibt für sie keine Kartenübersicht.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { Spinner } from '../../../components/Spinner';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { formatDate } from '../../../lib/touren';
import { useTestGuard } from '../../../auth/TestModeContext';
import { RechnungenTabs } from '../rechnungen/RechnungenTabs';
import { TANKKARTEN_STATUS_LABEL, type Tankkarte } from '../../../lib/briefe';

interface FahrerOption { id: string; vorname: string | null; nachname: string | null }

const STATUS_KLASSE: Record<string, string> = {
  aktiv: 'bg-emerald-100 text-emerald-800 dark:!bg-emerald-900 dark:!text-emerald-100',
  zurueckgegeben: 'bg-maja-light text-maja-navy',
  gesperrt: 'bg-red-100 text-red-800 dark:!bg-red-900 dark:!text-red-100',
};

export function TankkartenPage() {
  const guard = useTestGuard();
  const navigate = useNavigate();
  const [karten, setKarten] = useState<Tankkarte[]>([]);
  const [fahrer, setFahrer] = useState<FahrerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterFahrer, setFilterFahrer] = useState('');
  const [filterAnbieter, setFilterAnbieter] = useState('');
  const [suche, setSuche] = useState('');
  const [formOffen, setFormOffen] = useState(false);
  const [neuAnbieter, setNeuAnbieter] = useState('');
  const [neuNummer, setNeuNummer] = useState('');
  const [neuNotiz, setNeuNotiz] = useState('');
  const [zuweisen, setZuweisen] = useState<Tankkarte | null>(null);
  const [zielFahrer, setZielFahrer] = useState('');
  const [briefErzeugen, setBriefErzeugen] = useState(true);
  const [sperrId, setSperrId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const laden = useCallback(async () => {
    setLoading(true);
    const [kRes, fRes] = await Promise.all([
      supabase.from('tankkarten').select('*').order('created_at', { ascending: false }),
      supabase.from('fahrer').select('id, vorname, nachname')
        .eq('aktiv', true).eq('ist_unterkonto', false),
    ]);
    setKarten((kRes.data as Tankkarte[]) ?? []);
    setFahrer((fRes.data as FahrerOption[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => { void laden(); }, 0);
    return () => window.clearTimeout(t);
  }, [laden]);

  const fahrerName = (id: string | null) => {
    const f = fahrer.find((x) => x.id === id);
    if (!f) return null;
    return [f.vorname, f.nachname].filter(Boolean).join(' ').trim() || 'Ohne Namen';
  };

  const anbieterListe = useMemo(
    () => [...new Set(karten.map((k) => k.anbieter).filter(Boolean))] as string[],
    [karten],
  );

  const gefiltert = useMemo(() => {
    const q = suche.trim().toLowerCase();
    return karten.filter((k) => {
      if (filterStatus && k.status !== filterStatus) return false;
      if (filterFahrer && k.fahrer_id !== filterFahrer) return false;
      if (filterAnbieter && k.anbieter !== filterAnbieter) return false;
      if (q && !k.kartennummer.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [karten, filterStatus, filterFahrer, filterAnbieter, suche]);

  /** Karten je Fahrer — beantwortet "welche Karten hat er aktuell?". */
  const proFahrer = useMemo(() => {
    const map = new Map<string, Tankkarte[]>();
    for (const k of karten) {
      if (k.status !== 'aktiv' || !k.fahrer_id) continue;
      const list = map.get(k.fahrer_id);
      if (list) list.push(k); else map.set(k.fahrer_id, [k]);
    }
    return [...map.entries()];
  }, [karten]);

  async function anlegen() {
    if (!neuNummer.trim()) { setFehler('Bitte eine Kartennummer angeben.'); return; }
    if (guard()) return;
    setBusy(true);
    const { error } = await supabase.from('tankkarten').insert({
      anbieter: neuAnbieter.trim() || null,
      kartennummer: neuNummer.trim(),
      notiz: neuNotiz.trim() || null,
    });
    setBusy(false);
    if (error) { setFehler(error.message); return; }
    setNeuAnbieter(''); setNeuNummer(''); setNeuNotiz(''); setFormOffen(false);
    setFehler(null);
    await laden();
  }

  /**
   * Karte zuweisen. Auf Wunsch direkt einen Überlassungsbrief aus der
   * Tankkarten-Vorlage anlegen — der Brief-Editor öffnet sich mit
   * vorbefüllten Kartendaten.
   */
  async function zuweisenAusfuehren() {
    if (!zuweisen || !zielFahrer) return;
    if (guard()) return;
    setBusy(true);
    const { error } = await supabase.from('tankkarten').update({
      fahrer_id: zielFahrer,
      ausgegeben_am: new Date().toISOString().slice(0, 10),
      zurueck_am: null,
      status: 'aktiv',
    }).eq('id', zuweisen.id);
    setBusy(false);
    if (error) { setFehler(error.message); return; }
    const karteId = zuweisen.id;
    setZuweisen(null); setZielFahrer('');
    await laden();
    if (briefErzeugen) {
      navigate(`/briefe/neu?tankkarte=${karteId}&fahrer=${zielFahrer}`);
    }
  }

  async function rueckgabe(k: Tankkarte) {
    if (guard()) return;
    const { error } = await supabase.from('tankkarten').update({
      zurueck_am: new Date().toISOString().slice(0, 10),
      status: 'zurueckgegeben',
      fahrer_id: null,
    }).eq('id', k.id);
    if (error) { setFehler(error.message); return; }
    await laden();
  }

  async function sperren(id: string) {
    if (guard()) return;
    const { error } = await supabase.from('tankkarten')
      .update({ status: 'gesperrt' }).eq('id', id);
    setSperrId(null);
    if (error) { setFehler(error.message); return; }
    await laden();
  }

  if (loading) return <Spinner label="Tankkarten werden geladen …" />;

  return (
    <div className="space-y-4">
      <RechnungenTabs />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-maja-navy">Tankkarten</h1>
          <p className="text-sm text-maja-muted">
            Bestand, Zuweisung und Rückgabe. Kartennummern sind nur hier
            sichtbar — Fahrer sehen ihre Nummer ausschließlich im
            Überlassungsbrief.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setFormOffen((o) => !o)}>
          + Karte anlegen
        </button>
      </div>

      {fehler && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</div>
      )}

      {formOffen && (
        <div className="card grid gap-3 p-4 sm:grid-cols-3">
          <div>
            <label htmlFor="tk-anb" className="label">Anbieter</label>
            <input id="tk-anb" className="input" placeholder="z.B. Aral Routex"
                   value={neuAnbieter} onChange={(e) => setNeuAnbieter(e.target.value)} />
          </div>
          <div>
            <label htmlFor="tk-nr" className="label">Kartennummer</label>
            <input id="tk-nr" className="input" value={neuNummer}
                   onChange={(e) => setNeuNummer(e.target.value)} />
          </div>
          <div>
            <label htmlFor="tk-notiz" className="label">Notiz</label>
            <input id="tk-notiz" className="input" value={neuNotiz}
                   onChange={(e) => setNeuNotiz(e.target.value)} />
          </div>
          <div className="sm:col-span-3 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setFormOffen(false)}>
              Abbrechen
            </button>
            <button type="button" className="btn-primary" disabled={busy}
                    onClick={() => void anlegen()}>
              Anlegen
            </button>
          </div>
        </div>
      )}

      {proFahrer.length > 0 && (
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold text-maja-navy">Aktuell im Umlauf</h2>
          <ul className="flex flex-wrap gap-2">
            {proFahrer.map(([fid, ks]) => (
              <li key={fid} className="rounded-lg bg-maja-light px-3 py-1.5 text-sm text-maja-navy">
                <span className="font-medium">{fahrerName(fid) ?? 'Unbekannt'}</span>
                <span className="ml-1 text-xs text-maja-muted">
                  {ks.length} {ks.length === 1 ? 'Karte' : 'Karten'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label htmlFor="tk-fs" className="label">Status</label>
          <select id="tk-fs" className="input" value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">Alle</option>
            {Object.entries(TANKKARTEN_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="tk-ff" className="label">Fahrer</label>
          <select id="tk-ff" className="input" value={filterFahrer}
                  onChange={(e) => setFilterFahrer(e.target.value)}>
            <option value="">Alle</option>
            {fahrer.map((f) => (
              <option key={f.id} value={f.id}>{fahrerName(f.id)}</option>
            ))}
          </select>
        </div>
        {anbieterListe.length > 0 && (
          <div>
            <label htmlFor="tk-fa" className="label">Anbieter</label>
            <select id="tk-fa" className="input" value={filterAnbieter}
                    onChange={(e) => setFilterAnbieter(e.target.value)}>
              <option value="">Alle</option>
              {anbieterListe.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        )}
        <div className="min-w-[12rem] flex-1">
          <label htmlFor="tk-suche" className="label">Suche</label>
          <input id="tk-suche" className="input" placeholder="Kartennummer …"
                 value={suche} onChange={(e) => setSuche(e.target.value)} />
        </div>
      </div>

      {gefiltert.length === 0 ? (
        <div className="card p-8 text-center text-sm text-maja-muted">
          Keine Karten für diese Filter.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead className="border-b border-maja-navy/10 text-maja-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">Anbieter</th>
                <th className="px-3 py-2 font-semibold">Kartennummer</th>
                <th className="px-3 py-2 font-semibold">Fahrer</th>
                <th className="px-3 py-2 font-semibold">Ausgegeben</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Brief</th>
                <th className="px-3 py-2 font-semibold">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-maja-navy/10">
              {gefiltert.map((k) => (
                <tr key={k.id} className="hover:bg-maja-light/40">
                  <td className="px-3 py-2">{k.anbieter ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-maja-navy">{k.kartennummer}</td>
                  <td className="px-3 py-2">{fahrerName(k.fahrer_id) ?? '—'}</td>
                  <td className="px-3 py-2">
                    {k.ausgegeben_am ? formatDate(k.ausgegeben_am) : '—'}
                    {k.zurueck_am && (
                      <span className="block text-xs text-maja-muted">
                        zurück {formatDate(k.zurueck_am)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                      STATUS_KLASSE[k.status] ?? 'bg-maja-light text-maja-navy'}`}
                    >
                      {TANKKARTEN_STATUS_LABEL[k.status] ?? k.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {k.brief_id ? (
                      <Link to={`/briefe/${k.brief_id}`}
                            className="text-xs font-medium text-maja-accent hover:underline">
                        Brief öffnen
                      </Link>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      {k.status !== 'gesperrt' && (
                        <button type="button"
                                className="text-xs font-medium text-maja-accent hover:underline"
                                onClick={() => { setZuweisen(k); setZielFahrer(k.fahrer_id ?? ''); }}>
                          Zuweisen
                        </button>
                      )}
                      {k.status === 'aktiv' && k.fahrer_id && (
                        <button type="button"
                                className="text-xs font-medium text-maja-accent hover:underline"
                                onClick={() => void rueckgabe(k)}>
                          Rückgabe
                        </button>
                      )}
                      {k.status !== 'gesperrt' && (
                        <button type="button"
                                className="text-xs font-medium text-red-600 hover:underline"
                                onClick={() => setSperrId(k.id)}>
                          Sperren
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {zuweisen && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8">
          <div className="card w-full max-w-md space-y-4 p-5">
            <h2 className="text-lg font-semibold text-maja-navy">Karte zuweisen</h2>
            <p className="text-sm text-maja-muted">
              {zuweisen.anbieter ? `${zuweisen.anbieter} · ` : ''}
              <span className="font-mono">{zuweisen.kartennummer}</span>
            </p>
            <div>
              <label htmlFor="tk-ziel" className="label">Fahrer</label>
              <select id="tk-ziel" className="input" value={zielFahrer}
                      onChange={(e) => setZielFahrer(e.target.value)}>
                <option value="">— wählen —</option>
                {fahrer.map((f) => (
                  <option key={f.id} value={f.id}>{fahrerName(f.id)}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-maja-ink">
              <input type="checkbox" className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                     checked={briefErzeugen}
                     onChange={(e) => setBriefErzeugen(e.target.checked)} />
              Überlassungsbrief aus der Tankkarten-Vorlage erzeugen
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary"
                      onClick={() => { setZuweisen(null); setZielFahrer(''); }}>
                Abbrechen
              </button>
              <button type="button" className="btn-primary"
                      disabled={busy || !zielFahrer}
                      onClick={() => void zuweisenAusfuehren()}>
                Zuweisen
              </button>
            </div>
          </div>
        </div>
      )}

      {sperrId && (
        <ConfirmDialog
          title="Karte sperren?"
          message="Die Karte wird als gesperrt markiert — z.B. bei Verlust. Die Zuweisung bleibt zur Nachvollziehbarkeit erhalten."
          confirmLabel="Sperren"
          onConfirm={async () => { await sperren(sperrId); }}
          onClose={() => setSperrId(null)}
        />
      )}
    </div>
  );
}
