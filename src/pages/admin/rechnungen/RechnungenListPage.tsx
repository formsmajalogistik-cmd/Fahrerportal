import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { Spinner } from '../../../components/Spinner';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { formatDate, formatEuro } from '../../../lib/touren';
import { RechnungStatusBadge } from './RechnungStatusBadge';
import { RECHNUNG_STATUS_LABEL } from './rechnungLabels';
import type {
  Auftraggeber, AuftraggeberKontakt, Rechnung, RechnungStatus,
} from '../../../types/db';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

interface RechnungRow extends Rechnung {
  auftraggeber: Pick<Auftraggeber, 'id' | 'name'> | null;
  rechnungsempfaenger: Pick<AuftraggeberKontakt, 'id' | 'name'> | null;
  positionen_count: number;
}

const PAGE_SIZE = 25;
const STATUS_ORDER: Array<RechnungStatus | 'alle'> = [
  'alle', 'entwurf', 'offen', 'bezahlt',
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
  /** Optionaler Rechnungsempfänger-Filter, abhängig vom Auftraggeber-Filter:
   *  Auswahlmöglichkeiten kommen aus den Empfängern der Rechnungen des
   *  aktuell gefilterten Auftraggebers. Bei agFilter="" ist das Feld
   *  verborgen und der Filter wird ignoriert. */
  const [empfaengerFilter, setEmpfaengerFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<RechnungStatus | 'alle'>('alle');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Mehrfach-Auswahl für Sammelaktionen (als bezahlt / offen markieren).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<null | 'bezahlt' | 'offen'>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(t: string) {
    setToast(t);
    window.setTimeout(() => setToast((cur) => (cur === t ? null : cur)), 4000);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Beide Seiten parallel laden — Rechnungen + Auftraggeber-Optionen.
    const [rRes, aRes] = await Promise.all([
      supabase
        .from('rechnungen')
        // Egress-Optimierung: nur die Spalten, die die Listen-Ansicht
        // tatsächlich anzeigt + Filter braucht. Notizen, Adress-
        // Snapshot-Felder, anrede, sachbearbeiter, kundennummer,
        // ust_betrag, bezahlt_am, ust_satz, pdf_url, belege_pdf_url,
        // email_versendet_am sind nur im Detail relevant — Detail-
        // Page lädt sich ihre Zeile separat mit *.
        .select(`
          id, rechnungsnummer, auftraggeber_id, datum,
          leistungszeitraum_von, leistungszeitraum_bis,
          netto_summe, brutto_summe, status, ist_auslagen_rechnung,
          auftraggeber:auftraggeber_id (id, name),
          rechnungsempfaenger:rechnungsempfaenger_id (id, name),
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
      rechnungsempfaenger: { id: string; name: string } | null;
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
      if (agFilter && empfaengerFilter && r.rechnungsempfaenger?.id !== empfaengerFilter) return false;
      if (statusFilter !== 'alle' && r.status !== statusFilter) return false;
      if (q) {
        const hay = [
          r.rechnungsnummer,
          r.auftraggeber?.name ?? '',
          r.rechnungsempfaenger?.name ?? '',
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, yearFilter, agFilter, empfaengerFilter, statusFilter, search]);

  // Reset Pagination + Auswahl bei Filter-Änderungen — sonst könnten
  // nicht mehr sichtbare (ausgefilterte) Rechnungen in der Sammelaktion
  // landen, ohne dass man sie sieht.
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [yearFilter, agFilter, empfaengerFilter, statusFilter, search]);

  // Empfänger-Optionen aus den geladenen Rechnungen, sobald ein
  // Auftraggeber gefiltert wird — eine Map nach Id mit Name.
  const empfaengerOptions = useMemo(() => {
    if (!agFilter) return [] as Array<{ id: string; name: string }>;
    const map = new Map<string, string>();
    for (const r of rows) {
      if (r.auftraggeber_id !== agFilter) continue;
      const e = r.rechnungsempfaenger;
      if (e?.id && e.name) map.set(e.id, e.name);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
  }, [rows, agFilter]);

  // Auftraggeber-Wechsel räumt den Empfaenger-Filter direkt im
  // onChange-Handler des Dropdowns auf — siehe weiter unten —
  // damit der React-Linter (set-state-in-effect) zufrieden ist.

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

  // ---- Mehrfach-Auswahl ------------------------------------------------
  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // „Alle auswählen" bezieht sich auf die aktuell GEFILTERTEN Rechnungen
  // (über alle Seiten der Pagination hinweg — die Filter sind die
  // sichtbare Menge).
  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const someFilteredSelected = filtered.some((r) => selected.has(r.id));
  function toggleSelectAll() {
    setSelected(allFilteredSelected ? new Set() : new Set(filtered.map((r) => r.id)));
  }

  /**
   * Sammelaktion: setzt den Status der ausgewählten Rechnungen — mit
   * demselben Patch wie der Einzel-Flow in der Detail-Ansicht
   * (bezahlt → { status, bezahlt_am }; offen → { status, bezahlt_am: null }).
   * Umgestellt werden NUR Rechnungen, für die der Übergang im Einzel-Flow
   * existiert: offen → bezahlt bzw. bezahlt → offen. Entwürfe und bereits
   * im Zielstatus befindliche werden übersprungen.
   */
  async function runBulkStatus(target: 'bezahlt' | 'offen', bezahltAm?: string) {
    const eligible = rows.filter((r) =>
      selected.has(r.id)
      && (target === 'bezahlt' ? r.status === 'offen' : r.status === 'bezahlt'));
    const ids = eligible.map((r) => r.id);
    setBulkAction(null);
    if (ids.length === 0) {
      showToast(target === 'bezahlt'
        ? 'Keine offene Rechnung in der Auswahl — nichts umgestellt.'
        : 'Keine bezahlte Rechnung in der Auswahl — nichts umgestellt.');
      return;
    }
    setBulkBusy(true);
    const patch = target === 'bezahlt'
      ? { status: 'bezahlt' as const, bezahlt_am: bezahltAm ?? todayIso() }
      : { status: 'offen' as const, bezahlt_am: null };
    const { error: err } = await supabase
      .from('rechnungen')
      .update(patch)
      .in('id', ids);
    setBulkBusy(false);
    if (err) { setError(err.message); return; }
    setSelected(new Set());
    await load();
    const skipped = selected.size - ids.length;
    showToast(
      `${ids.length} Rechnung${ids.length === 1 ? '' : 'en'} als ${target === 'bezahlt' ? 'bezahlt' : 'offen'} markiert`
      + (skipped > 0 ? ` (${skipped} übersprungen)` : ''),
    );
  }

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

      {/* Auftraggeber + (optional) Rechnungsempfänger + Suche */}
      <div className={`grid gap-2 ${
        agFilter && empfaengerOptions.length > 0
          ? 'sm:grid-cols-[1fr_1fr_1fr]'
          : 'sm:grid-cols-[1fr_1fr]'
      }`}>
        <div>
          <label htmlFor="ag-filter" className="label">Auftraggeber</label>
          <select
            id="ag-filter"
            className="input"
            value={agFilter}
            onChange={(e) => { setAgFilter(e.target.value); setEmpfaengerFilter(''); }}
          >
            <option value="">Alle</option>
            {auftraggeber.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        {agFilter && empfaengerOptions.length > 0 && (
          <div>
            <label htmlFor="empf-filter" className="label">Rechnungsempfänger</label>
            <select
              id="empf-filter"
              className="input"
              value={empfaengerFilter}
              onChange={(e) => setEmpfaengerFilter(e.target.value)}
            >
              <option value="">Alle</option>
              {empfaengerOptions.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="search" className="label">Suche</label>
          <input
            id="search"
            className="input"
            placeholder="Rechnungsnummer, Auftraggeber, Empfänger …"
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

      {/* Aktionsleiste für die Mehrfach-Auswahl */}
      {selected.size > 0 && (
        <div className="card flex flex-wrap items-center gap-3 border border-maja-navy/15 p-3">
          <span className="text-sm font-medium text-maja-ink">
            {selected.size} ausgewählt
          </span>
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={bulkBusy}
            onClick={() => setBulkAction('bezahlt')}
          >
            {bulkBusy ? 'Wird umgestellt …' : 'Als bezahlt markieren'}
          </button>
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={bulkBusy}
            onClick={() => setBulkAction('offen')}
          >
            Als offen markieren
          </button>
          <button
            type="button"
            className="text-sm font-medium text-maja-muted hover:text-maja-navy hover:underline"
            disabled={bulkBusy}
            onClick={() => setSelected(new Set())}
          >
            Auswahl aufheben
          </button>
        </div>
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
                <th className="w-10 px-3 py-2">
                  <SelectAllCheckbox
                    checked={allFilteredSelected}
                    indeterminate={someFilteredSelected && !allFilteredSelected}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className="px-3 py-2 font-semibold">Rechnung</th>
                <th className="px-3 py-2 font-semibold">Datum</th>
                <th className="px-3 py-2 font-semibold">Auftraggeber</th>
                <th className="px-3 py-2 font-semibold">Zeitraum</th>
                <th className="px-3 py-2 text-right font-semibold">Pos.</th>
                <th className="px-3 py-2 text-right font-semibold">Netto</th>
                <th className="px-3 py-2 text-right font-semibold">Brutto</th>
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
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy focus:ring-maja-navy"
                      checked={selected.has(r.id)}
                      onChange={() => toggleSelected(r.id)}
                      aria-label={`Rechnung ${r.rechnungsnummer} auswählen`}
                    />
                  </td>
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
                  <td className="px-3 py-2 text-maja-ink">
                    {r.auftraggeber?.name ?? '—'}
                    {r.rechnungsempfaenger?.name && (
                      <div className="text-xs text-maja-muted">
                        z. Hd. {r.rechnungsempfaenger.name}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-maja-muted">
                    {formatDate(r.leistungszeitraum_von)} – {formatDate(r.leistungszeitraum_bis)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.positionen_count}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formatEuro(Number(r.netto_summe))}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-maja-navy">
                    {formatEuro(Number(r.brutto_summe))}
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

      {bulkAction === 'bezahlt' && (
        <BulkBezahltDialog
          count={selected.size}
          onCancel={() => setBulkAction(null)}
          onConfirm={(datum) => void runBulkStatus('bezahlt', datum)}
        />
      )}
      {bulkAction === 'offen' && (
        <ConfirmDialog
          title="Als offen markieren?"
          message={
            <>
              {selected.size} ausgewählte Rechnung{selected.size === 1 ? '' : 'en'} zurück
              auf <strong>offen</strong> setzen? Das Bezahlt-Datum wird entfernt.
              Nur bezahlte Rechnungen werden umgestellt.
            </>
          }
          confirmLabel="Als offen markieren"
          onConfirm={() => runBulkStatus('offen')}
          onClose={() => setBulkAction(null)}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-maja-navy px-4 py-2 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

/** Kopf-Checkbox mit indeterminate-Zustand (teilweise Auswahl). */
function SelectAllCheckbox({
  checked, indeterminate, onChange,
}: { checked: boolean; indeterminate: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy focus:ring-maja-navy"
      checked={checked}
      onChange={onChange}
      aria-label="Alle gefilterten Rechnungen auswählen"
    />
  );
}

/**
 * Bestätigung der Sammelaktion „Als bezahlt markieren" — mit demselben
 * „Bezahlt am"-Datum wie der Einzel-Flow (BezahltDialog in der
 * Detail-Ansicht). Default: heute.
 */
function BulkBezahltDialog({
  count, onCancel, onConfirm,
}: { count: number; onCancel: () => void; onConfirm: (datum: string) => void }) {
  const [d, setD] = useState(todayIso());
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-maja-ink/40 px-4">
      <div className="card w-full max-w-sm p-5">
        <h3 className="text-base font-semibold text-maja-navy">
          {count} Rechnung{count === 1 ? '' : 'en'} als bezahlt markieren?
        </h3>
        <p className="mt-1 text-xs text-maja-muted">
          Nur offene Rechnungen werden umgestellt — Entwürfe und bereits
          bezahlte bleiben unverändert.
        </p>
        <label htmlFor="bulk-bezahlt-am" className="label mt-3">Bezahlt am</label>
        <input
          id="bulk-bezahlt-am"
          type="date" className="input" value={d}
          onChange={(e) => setD(e.target.value)}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Abbrechen
          </button>
          <button
            type="button" className="btn-primary"
            disabled={!d}
            onClick={() => onConfirm(d)}
          >
            Als bezahlt markieren
          </button>
        </div>
      </div>
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
