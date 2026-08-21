// Übersicht aller Briefe (Migration 091).
//
// Bewusst OHNE KPI-Karten und ohne Zahlungs-/Bezahlt-Status — ein Brief
// ist kein Beleg mit Betrag. Filter und Aufbau folgen der
// Rechnungsübersicht, damit die Bedienung vertraut bleibt.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { Spinner } from '../../../components/Spinner';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { formatDate } from '../../../lib/touren';
import { useTestGuard } from '../../../auth/TestModeContext';
import { RechnungenTabs } from '../rechnungen/RechnungenTabs';
import {
  BRIEF_STATUS_LABEL, empfaengerAnzeige, parseBriefAdresse, type Brief,
} from '../../../lib/briefe';

const STATUS_KLASSE: Record<string, string> = {
  entwurf: 'bg-maja-light text-maja-navy',
  final: 'bg-sky-100 text-sky-800 dark:!bg-sky-900 dark:!text-sky-100',
  versendet: 'bg-amber-100 text-amber-900 dark:!bg-amber-900 dark:!text-amber-100',
  unterschrieben: 'bg-emerald-100 text-emerald-800 dark:!bg-emerald-900 dark:!text-emerald-100',
};

export function BriefeListPage() {
  const navigate = useNavigate();
  const guard = useTestGuard();
  const [briefe, setBriefe] = useState<Brief[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [jahr, setJahr] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [suche, setSuche] = useState('');
  const [loeschId, setLoeschId] = useState<string | null>(null);

  const laden = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('briefe').select('*').order('datum', { ascending: false });
    if (error) setFehler(error.message);
    setBriefe((data as Brief[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => { void laden(); }, 0);
    return () => window.clearTimeout(t);
  }, [laden]);

  const jahre = useMemo(() => {
    const s = new Set(briefe.map((b) => b.datum.slice(0, 4)));
    s.add(String(new Date().getFullYear()));
    return [...s].sort().reverse();
  }, [briefe]);

  const gefiltert = useMemo(() => {
    const q = suche.trim().toLowerCase();
    return briefe.filter((b) => {
      if (jahr && !b.datum.startsWith(jahr)) return false;
      if (status && b.status !== status) return false;
      if (!q) return true;
      const empf = empfaengerAnzeige(parseBriefAdresse(b.adress_snapshot));
      return [b.brief_nr, b.betreff ?? '', empf]
        .join(' ').toLowerCase().includes(q);
    });
  }, [briefe, jahr, status, suche]);

  async function loeschen(id: string) {
    if (guard()) return;
    const { error } = await supabase.from('briefe').delete().eq('id', id);
    setLoeschId(null);
    if (error) { setFehler(error.message); return; }
    await laden();
  }

  if (loading) return <Spinner label="Briefe werden geladen …" />;

  return (
    <div className="space-y-4">
      <RechnungenTabs />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-maja-navy">Briefe</h1>
          <p className="text-sm text-maja-muted">
            Frei formulierte Briefe und Überlassungen — z.B. von Tankkarten.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => navigate('/briefe/neu')}>
          + Neuer Brief
        </button>
      </div>

      {fehler && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {fehler}
        </div>
      )}

      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label htmlFor="br-jahr" className="label">Jahr</label>
          <select id="br-jahr" className="input" value={jahr}
                  onChange={(e) => setJahr(e.target.value)}>
            <option value="">Alle</option>
            {jahre.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="br-status" className="label">Status</label>
          <select id="br-status" className="input" value={status}
                  onChange={(e) => setStatus(e.target.value)}>
            <option value="">Alle</option>
            {Object.entries(BRIEF_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[14rem] flex-1">
          <label htmlFor="br-suche" className="label">Suche</label>
          <input id="br-suche" className="input"
                 placeholder="Nummer, Betreff oder Empfänger …"
                 value={suche} onChange={(e) => setSuche(e.target.value)} />
        </div>
      </div>

      {gefiltert.length === 0 ? (
        <div className="card p-8 text-center text-sm text-maja-muted">
          Keine Briefe für diese Filter.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead className="border-b border-maja-navy/10 text-maja-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">Nummer</th>
                <th className="px-3 py-2 font-semibold">Datum</th>
                <th className="px-3 py-2 font-semibold">Empfänger</th>
                <th className="px-3 py-2 font-semibold">Betreff</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-maja-navy/10">
              {gefiltert.map((b) => {
                const a = parseBriefAdresse(b.adress_snapshot);
                return (
                  <tr key={b.id} className="hover:bg-maja-light/40">
                    <td className="px-3 py-2 font-medium text-maja-navy">
                      <Link to={`/briefe/${b.id}`} className="hover:underline">{b.brief_nr}</Link>
                    </td>
                    <td className="px-3 py-2">{formatDate(b.datum)}</td>
                    <td className="px-3 py-2">
                      {empfaengerAnzeige(a)}
                      {b.empfaenger_typ === 'fahrer' && (
                        <span className="ml-1 text-xs text-maja-muted">(Fahrer)</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{b.betreff ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                        STATUS_KLASSE[b.status] ?? 'bg-maja-light text-maja-navy'}`}
                      >
                        {BRIEF_STATUS_LABEL[b.status] ?? b.status}
                      </span>
                      {b.unterschrieben_am && (
                        <span className="ml-1 text-xs text-maja-muted">
                          {formatDate(b.unterschrieben_am)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <Link to={`/briefe/${b.id}`}
                              className="text-xs font-medium text-maja-accent hover:underline">
                          Öffnen
                        </Link>
                        <button
                          type="button"
                          className="text-xs font-medium text-red-600 hover:underline"
                          onClick={() => setLoeschId(b.id)}
                        >
                          Löschen
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {loeschId && (
        <ConfirmDialog
          title="Brief löschen?"
          message="Der Brief wird endgültig entfernt. Eine bereits erzeugte PDF bleibt in OneDrive liegen."
          confirmLabel="Löschen"
          onConfirm={async () => { await loeschen(loeschId); }}
          onClose={() => setLoeschId(null)}
        />
      )}
    </div>
  );
}
