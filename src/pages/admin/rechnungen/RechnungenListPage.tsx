import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { Spinner } from '../../../components/Spinner';
import { formatDate, formatEuro } from '../../../lib/touren';
import { RechnungStatusBadge } from './RechnungStatusBadge';
import { RECHNUNG_STATUS_LABEL } from './rechnungLabels';
import type { Auftraggeber, Rechnung, RechnungStatus } from '../../../types/db';

interface RechnungRow extends Rechnung {
  auftraggeber: Pick<Auftraggeber, 'id' | 'name'> | null;
  positionen_count: number;
}

const PAGE_SIZE = 25;
const STATUS_ORDER: Array<RechnungStatus | 'alle'> = [
  'alle', 'entwurf', 'offen', 'bezahlt', 'storniert',
];

export function RechnungenListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<RechnungRow[]>([]);
  const [auftraggeber, setAuftraggeber] = useState<Pick<Auftraggeber, 'id' | 'name'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter
  const [yearFilter, setYearFilter] = useState<number | 'alle'>(new Date().getFullYear());
  const [agFilter, setAgFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<RechnungStatus | 'alle'>('alle');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Beide Seiten parallel laden — Rechnungen + Auftraggeber-Optionen.
    const [rRes, aRes] = await Promise.all([
      supabase
        .from('rechnungen')
        .select(`
          *,
          auftraggeber:auftraggeber_id (id, name),
          positionen:rechnungspositionen(count)
        `)
        .order('datum', { ascending: false })
        .order('rechnungsnummer', { ascending: false })
        .limit(500),
      supabase.from('auftraggeber').select('id, name').order('name'),
    ]);
    if (rRes.error) { setError(rRes.error.message); setLoading(false); return; }
    if (aRes.error) { setError(aRes.error.message); setLoading(false); return; }
    type RawRow = Rechnung & {
      auftraggeber: { id: string; name: string } | null;
      positionen: Array<{ count: number }>;
    };
    const list: RechnungRow[] = ((rRes.data as unknown as RawRow[]) ?? []).map((r) => ({
      ...r,
      positionen_count: r.positionen?.[0]?.count ?? 0,
    }));
    setRows(list);
    setAuftraggeber(aRes.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Jahres-Pills aus den vorhandenen Datumswerten ableiten + immer das aktuelle Jahr.
  const yearOptions = useMemo(() => {
    const set = new Set<number>([new Date().getFullYear()]);
    for (const r of rows) {
      const y = Number((r.datum ?? '').slice(0, 4));
      if (Number.isFinite(y) && y > 1990) set.add(y);
    }
    return Array.from(set).sort((a, b) => b - a);
  }, [rows]);

  const yearCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    let alle = 0;
    for (const r of rows) {
      alle += 1;
      const y = Number((r.datum ?? '').slice(0, 4));
      if (Number.isFinite(y)) counts[y] = (counts[y] ?? 0) + 1;
    }
    return { alle, byYear: counts };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (yearFilter !== 'alle') {
        const y = Number((r.datum ?? '').slice(0, 4));
        if (y !== yearFilter) return false;
      }
      if (agFilter && r.auftraggeber_id !== agFilter) return false;
      if (statusFilter !== 'alle' && r.status !== statusFilter) return false;
      if (q) {
        const hay = [r.rechnungsnummer, r.auftraggeber?.name ?? ''].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, yearFilter, agFilter, statusFilter, search]);

  // Reset Pagination bei Filter-Änderungen.
  useEffect(() => { setPage(1); }, [yearFilter, agFilter, statusFilter, search]);

  const pageRows = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  // KPI berechnen aus filtered (das ist der relevante Zeitraum/Filter).
  const kpi = useMemo(() => {
    const total = filtered.length;
    let offen = 0;
    let bezahlt = 0;
    let entwuerfe = 0;
    for (const r of filtered) {
      const n = Number(r.netto_summe) || 0;
      if (r.status === 'offen') offen += n;
      if (r.status === 'bezahlt') bezahlt += n;
      if (r.status === 'entwurf') entwuerfe += 1;
    }
    return { total, offen, bezahlt, entwuerfe };
  }, [filtered]);

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { alle: rows.length };
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-maja-navy">Rechnungen</h1>
          <p className="text-sm text-maja-muted">
            Alle Rechnungen pro Auftraggeber, Zeitraum und Status. Klick auf
            eine Zeile öffnet die Detail-Ansicht.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => navigate('/rechnungen/neu')}
        >
          + Neue Rechnung
        </button>
      </div>

      {/* Jahres-Pills */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-maja-muted">Jahr</span>
        <button
          type="button"
          onClick={() => setYearFilter('alle')}
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            yearFilter === 'alle' ? 'bg-maja-navy text-white' : 'bg-white text-maja-navy hover:bg-maja-light'
          }`}
        >
          Alle ({yearCounts.alle})
        </button>
        {yearOptions.map((y) => (
          <button
            key={y}
            type="button"
            onClick={() => setYearFilter(y)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              yearFilter === y ? 'bg-maja-navy text-white' : 'bg-white text-maja-navy hover:bg-maja-light'
            }`}
          >
            {y} ({yearCounts.byYear[y] ?? 0})
          </button>
        ))}
      </div>

      {/* Auftraggeber + Suche */}
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
        <div>
          <label htmlFor="ag-filter" className="label">Auftraggeber</label>
          <select
            id="ag-filter"
            className="input"
            value={agFilter}
            onChange={(e) => setAgFilter(e.target.value)}
          >
            <option value="">Alle</option>
            {auftraggeber.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="search" className="label">Suche</label>
          <input
            id="search"
            className="input"
            placeholder="Rechnungsnummer oder Auftraggeber …"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Status-Pills */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-maja-muted">Status</span>
        {STATUS_ORDER.map((s) => {
          const active = statusFilter === s;
          const label = s === 'alle' ? 'Alle' : RECHNUNG_STATUS_LABEL[s];
          const cnt = statusCounts[s] ?? 0;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                active ? 'bg-maja-navy text-white' : 'bg-white text-maja-navy hover:bg-maja-light'
              }`}
            >
              {label} ({cnt})
            </button>
          );
        })}
      </div>

      {/* KPI-Karten */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Rechnungen" value={String(kpi.total)} hint="im gewählten Filter" />
        <KpiCard title="Offen (Netto)" value={formatEuro(kpi.offen)} hint="Status offen" accent />
        <KpiCard title="Bezahlt (Netto)" value={formatEuro(kpi.bezahlt)} hint="Status bezahlt" />
        <KpiCard title="Entwürfe" value={String(kpi.entwuerfe)} hint="Status entwurf" />
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <Spinner label="Rechnungen werden geladen …" />
      ) : filtered.length === 0 ? (
        <div className="card p-6 text-sm text-maja-muted">
          Keine Rechnungen für den gewählten Filter.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-maja-light text-left text-maja-navy">
              <tr>
                <th className="px-3 py-2 font-semibold">Rechnung</th>
                <th className="px-3 py-2 font-semibold">Datum</th>
                <th className="px-3 py-2 font-semibold">Auftraggeber</th>
                <th className="px-3 py-2 font-semibold">Zeitraum</th>
                <th className="px-3 py-2 text-right font-semibold">Pos.</th>
                <th className="px-3 py-2 text-right font-semibold">Netto</th>
                <th className="px-3 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-maja-navy/10">
              {pageRows.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer hover:bg-maja-light/40"
                  onClick={() => navigate(`/rechnungen/${r.id}`)}
                >
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-maja-ink">{r.rechnungsnummer}</span>
                      {r.ist_auslagen_rechnung && (
                        <span className="inline-flex rounded-full bg-maja-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-maja-accent">
                          Auslagen
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-maja-ink">{formatDate(r.datum)}</td>
                  <td className="px-3 py-2 text-maja-ink">{r.auftraggeber?.name ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-maja-muted">
                    {formatDate(r.leistungszeitraum_von)} – {formatDate(r.leistungszeitraum_bis)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.positionen_count}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formatEuro(Number(r.netto_summe))}
                  </td>
                  <td className="px-3 py-2"><RechnungStatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button
            type="button"
            className="btn-secondary px-3 py-1"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >Zurück</button>
          <span className="text-maja-muted">Seite {page} / {pageCount}</span>
          <button
            type="button"
            className="btn-secondary px-3 py-1"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >Weiter</button>
        </div>
      )}
    </div>
  );
}

function KpiCard({ title, value, hint, accent }: { title: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-maja-muted">{title}</div>
      <div className={`mt-1 text-2xl font-semibold ${accent ? 'text-maja-accent' : 'text-maja-navy'}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-maja-muted">{hint}</div>}
    </div>
  );
}
