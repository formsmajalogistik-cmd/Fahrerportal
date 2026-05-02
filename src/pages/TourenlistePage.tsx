import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from '../components/Spinner';
import { TourCreateDialog } from './touren/TourCreateDialog';
import { displayName } from '../lib/names';
import {
  formatDateTime, formatEuro, formatKm, tourTitel,
} from '../lib/touren';
import type {
  AppUser, Auftraggeber, Fahrer, Tour, TourStatus, Zwischenstopp,
} from '../types/db';

type FahrerWithUser = Fahrer & { user: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null };

interface TourRow extends Tour {
  auftraggeber: Pick<Auftraggeber, 'name' | 'kontakt'> | null;
  fahrer: FahrerWithUser | null;
}

const PAGE_SIZE = 25;

type StatusFilter = 'alle' | TourStatus;

const STATUS_LABEL: Record<TourStatus, string> = {
  geplant: 'Geplant',
  aktiv: 'Aktiv',
  abgeschlossen: 'Abgeschlossen',
};

const STATUS_BADGE: Record<TourStatus, string> = {
  geplant:        'bg-gray-100 text-gray-700',
  aktiv:          'bg-maja-accent/15 text-maja-accent',
  abgeschlossen:  'bg-emerald-100 text-emerald-700',
};

export function TourenlistePage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [rows, setRows] = useState<TourRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('alle');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('touren')
      .select(`
        *,
        auftraggeber:auftraggeber_id (name, kontakt),
        fahrer:fahrer_id (
          id, user_id, aktiv,
          user:user_id (email, vorname, nachname)
        )
      `)
      .order('startdatum', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (err) setError(err.message);
    else setRows((data as unknown as TourRow[]) ?? []);
    if (silent) setRefreshing(false); else setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Reset Pagination wenn Filter sich ändern
  useEffect(() => { setPage(1); }, [year, statusFilter, search]);

  // ---- Jahres-Optionen + Counts ----
  const yearCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const t of rows) {
      const ref = t.startdatum ?? t.created_at;
      const y = new Date(ref).getFullYear();
      if (!Number.isFinite(y)) continue;
      m.set(y, (m.get(y) ?? 0) + 1);
    }
    if (!m.has(currentYear)) m.set(currentYear, 0);
    return [...m.entries()].sort((a, b) => b[0] - a[0]);
  }, [rows, currentYear]);

  // ---- Touren des gewählten Jahres ----
  const yearRows = useMemo(() => rows.filter((t) => {
    const ref = t.startdatum ?? t.created_at;
    return new Date(ref).getFullYear() === year;
  }), [rows, year]);

  // ---- Gefilterte Touren (Status + Suche) ----
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return yearRows.filter((t) => {
      if (statusFilter !== 'alle' && t.status !== statusFilter) return false;
      if (!q) return true;
      const fahrerName = displayName(t.fahrer?.user ?? null).toLowerCase();
      const haystack = [
        t.tour_id ?? '',
        t.start_stadt,
        t.ziel_stadt,
        ...(t.zwischenstopps?.map((z) => z.stadt) ?? []),
        fahrerName,
        ...(t.kennzeichen ?? []),
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [yearRows, statusFilter, search]);

  // ---- KPI-Daten ----
  const kpi = useMemo(() => {
    const sum = filteredRows.reduce((acc, t) => acc + Number(t.verguetung ?? 0), 0);
    const aktiv = yearRows.filter((t) => t.status === 'aktiv').length;
    const geplant = yearRows.filter((t) => t.status === 'geplant').length;
    return { jahr: yearRows.length, sum, sumCount: filteredRows.length, aktiv, geplant };
  }, [yearRows, filteredRows]);

  // ---- Pagination ----
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  if (loading) return <Spinner label="Touren werden geladen …" />;
  if (error)   return <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-maja-navy">Tourenliste</h1>
          <p className="text-sm text-maja-muted">
            Übersicht und Verwaltung aller Touren.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void load(true)}
            disabled={refreshing}
          >
            {refreshing ? 'Lädt …' : 'Aktualisieren'}
          </button>
          {isAdmin && (
            <button type="button" className="btn-primary" onClick={() => setShowCreate(true)}>
              + Neue Tour
            </button>
          )}
        </div>
      </div>

      {/* Jahres-Filter */}
      <div className="flex flex-wrap gap-2">
        {yearCounts.map(([y, count]) => {
          const active = y === year;
          return (
            <button
              key={y}
              type="button"
              onClick={() => setYear(y)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition ${
                active ? 'bg-maja-navy text-white' : 'bg-white text-maja-navy hover:bg-maja-light border border-maja-navy/15'
              }`}
            >
              {y}
              <span className={`inline-flex min-w-[1.5rem] justify-center rounded-full px-1.5 text-xs font-semibold ${
                active ? 'bg-white/20 text-white' : 'bg-maja-light text-maja-navy'
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* KPI-Karten */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title={`Touren ${year}`}
          value={String(kpi.jahr)}
          hint="in diesem Jahr"
        />
        <KpiCard
          title="Summe Ansicht"
          value={formatEuro(kpi.sum)}
          hint={`${kpi.sumCount} ${kpi.sumCount === 1 ? 'Tour' : 'Touren'}`}
        />
        <KpiCard
          title="Aktiv"
          value={String(kpi.aktiv)}
          hint="läuft gerade"
          accent
        />
        <KpiCard
          title="Geplant"
          value={String(kpi.geplant)}
          hint="nächste Tage"
        />
      </div>

      {/* Suche + Status-Filter */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          className="input flex-1 min-w-[16rem]"
          placeholder="Tour-ID, Stadt, Fahrer, Kennzeichen ..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex flex-wrap gap-1">
          {(['alle', 'aktiv', 'geplant', 'abgeschlossen'] as const).map((s) => {
            const active = statusFilter === s;
            const label = s === 'alle' ? 'Alle' : STATUS_LABEL[s];
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`inline-block rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  active ? 'bg-maja-navy text-white' : 'bg-white text-maja-navy hover:bg-maja-light border border-maja-navy/15'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tourenliste */}
      {pageRows.length === 0 ? (
        <div className="card p-8 text-center text-sm text-maja-muted">
          Keine Touren entsprechen den aktuellen Filtern.
        </div>
      ) : (
        <ul className="space-y-3">
          {pageRows.map((t) => (
            <TourCard key={t.id} tour={t} />
          ))}
        </ul>
      )}

      {/* Pagination */}
      {filteredRows.length > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-maja-muted">
            Seite {safePage} von {totalPages} · {filteredRows.length} Touren
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary px-3 py-1.5 text-sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
            >
              Zurück
            </button>
            <button
              type="button"
              className="btn-secondary px-3 py-1.5 text-sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
            >
              Weiter
            </button>
          </div>
        </div>
      )}

      {showCreate && isAdmin && (
        <TourCreateDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); void load(); }}
        />
      )}
    </div>
  );
}

interface KpiProps { title: string; value: string; hint?: string; accent?: boolean }
function KpiCard({ title, value, hint, accent }: KpiProps) {
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

interface CardProps { tour: TourRow }
function TourCard({ tour }: CardProps) {
  const fahrerName = displayName(tour.fahrer?.user ?? null) || '— kein Fahrer —';
  const dateRange = (() => {
    if (!tour.startdatum && !tour.enddatum) return null;
    if (tour.startdatum && tour.enddatum) {
      return `${formatDateTime(tour.startdatum)} – ${formatDateTime(tour.enddatum)}`;
    }
    return formatDateTime(tour.startdatum ?? tour.enddatum);
  })();

  function handleClick() {
    // Detail-Panel kommt im nächsten Schritt.
    // eslint-disable-next-line no-console
    console.log('Tour Detail:', tour.id);
  }

  return (
    <li>
      <button
        type="button"
        onClick={handleClick}
        className="card w-full p-5 text-left transition hover:shadow-lg"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {tour.tour_id && (
                <span className="inline-block rounded-full bg-maja-light px-2 py-0.5 text-xs font-semibold text-maja-navy">
                  {tour.tour_id}
                </span>
              )}
              <h3 className="text-base font-semibold text-maja-navy break-words">
                {tourTitel({
                  start_stadt: tour.start_stadt,
                  ziel_stadt: tour.ziel_stadt,
                  zwischenstopps: tour.zwischenstopps as Zwischenstopp[],
                })}
              </h3>
            </div>

            <div className="mt-3 grid gap-2 text-sm text-maja-ink sm:grid-cols-2">
              <Meta icon={<IconUser />}>{fahrerName}</Meta>
              <Meta icon={<IconPin />}>{formatKm(tour.km_gesamt)}</Meta>
              {dateRange && <Meta icon={<IconCalendar />}>{dateRange}</Meta>}
              {(tour.kennzeichen?.length ?? 0) > 0 && (
                <Meta icon={<IconCar />}>{tour.kennzeichen.join(', ')}</Meta>
              )}
              {tour.auftraggeber && (
                <Meta icon={<IconBuilding />}>
                  <span className="block">{tour.auftraggeber.name}</span>
                  {tour.auftraggeber.kontakt && (
                    <span className="block text-xs text-maja-muted">
                      {tour.auftraggeber.kontakt}
                    </span>
                  )}
                </Meta>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
              STATUS_BADGE[tour.status]
            }`}>
              {STATUS_LABEL[tour.status]}
            </span>
            <div className="text-right">
              <div className="text-2xl font-bold text-maja-navy">
                {formatEuro(tour.verguetung)}
              </div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-maja-muted">
                Netto
              </div>
            </div>
          </div>
        </div>
      </button>
    </li>
  );
}

function Meta({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-maja-accent">
        {icon}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// --- Inline-SVG-Icons (Heroicons mini, hand-trimmed) ---
function IconUser() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M10 9a3 3 0 100-6 3 3 0 000 6zM3 18a7 7 0 1114 0H3z" />
    </svg>
  );
}
function IconPin() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path fillRule="evenodd" d="M10 18s6-5.686 6-10A6 6 0 104 8c0 4.314 6 10 6 10zm0-8a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M5.75 2a.75.75 0 01.75.75V4h7V2.75a.75.75 0 011.5 0V4h.5A2.25 2.25 0 0118 6.25v9.5A2.25 2.25 0 0115.75 18H4.25A2.25 2.25 0 012 15.75v-9.5A2.25 2.25 0 014.25 4h.75V2.75A.75.75 0 015.75 2zM3.5 8v7.75c0 .414.336.75.75.75h11.5a.75.75 0 00.75-.75V8h-13z" />
    </svg>
  );
}
function IconCar() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M4.5 7l1.2-2.5A2 2 0 017.5 3.5h5a2 2 0 011.8 1L15.5 7H17a1 1 0 011 1v3a1 1 0 01-1 1h-.5v1a1.5 1.5 0 11-3 0v-1h-7v1a1.5 1.5 0 11-3 0v-1H3a1 1 0 01-1-1V8a1 1 0 011-1h1.5zM6 9a1 1 0 100 2 1 1 0 000-2zm8 0a1 1 0 100 2 1 1 0 000-2z" />
    </svg>
  );
}
function IconBuilding() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v13h1.25a.75.75 0 010 1.5H1.75a.75.75 0 010-1.5H3V4zm3 2v2h2V6H6zm4 0v2h2V6h-2zm-4 4v2h2v-2H6zm4 0v2h2v-2h-2zm-4 4v3h2v-3H6zm4 0v3h2v-3h-2z" />
    </svg>
  );
}
