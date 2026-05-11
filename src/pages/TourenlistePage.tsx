import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from '../components/Spinner';
import { TourCreateDialog } from './touren/TourCreateDialog';
import { TourDetailDialog } from './touren/TourDetailDialog';
import { TourImportDialog } from './touren/TourImportDialog';
import { displayName } from '../lib/names';
import {
  computeTourStatus, formatDate, formatEuro, formatKm, tourTitel,
} from '../lib/touren';
import type {
  AppUser, Auftraggeber, Fahrer, Tour, TourStatus,
} from '../types/db';

type FahrerWithUser = Fahrer & { user: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null };

interface TourRow extends Tour {
  auftraggeber: Pick<Auftraggeber, 'name' | 'kontakt'> | null;
  fahrer: FahrerWithUser | null;
  schriftliches_protokoll: { id: string; name: string } | null;
}

const PAGE_SIZE = 25;

type StatusFilter = 'alle' | TourStatus;

const STATUS_LABEL: Record<TourStatus, string> = {
  geplant: 'Geplant',
  aktiv: 'Aktiv',
  abgeschlossen: 'Abgeschlossen',
};

const STATUS_BADGE: Record<TourStatus, string> = {
  geplant:        'bg-blue-100 text-blue-700',
  aktiv:          'bg-emerald-100 text-emerald-700',
  abgeschlossen:  'bg-gray-100 text-gray-600',
};

export function TourenlistePage() {
  const { profile, session } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const navigate = useNavigate();
  const [openingProtokoll, setOpeningProtokoll] = useState<string | null>(null);

  /**
   * Öffnet das verknüpfte schriftliche Protokoll für den aktuellen Fahrer.
   * Sucht einen vorhandenen Draft (fahrer + template) — falls keiner existiert,
   * wird ein neuer angelegt. Anschließend Navigation auf /formular/<id>.
   */
  async function openSchriftlichesProtokoll(t: TourRow) {
    const tplId = t.schriftliches_protokoll?.id ?? t.schriftliches_protokoll_id;
    if (!tplId || !session) return;
    setOpeningProtokoll(t.id);
    try {
      const { data: fahrerRow } = await supabase
        .from('fahrer').select('id').eq('user_id', session.user.id).maybeSingle();
      if (!fahrerRow?.id) {
        // Kein Fahrer-Profil → fallback: nichts tun
        setOpeningProtokoll(null);
        return;
      }
      const { data: existing } = await supabase
        .from('ausgefuellte_formulare')
        .select('id')
        .eq('fahrer_id', fahrerRow.id)
        .eq('template_id', tplId)
        .eq('status', 'draft')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing?.id) {
        navigate(`/formular/${existing.id}`);
        return;
      }
      const { data: created, error } = await supabase
        .from('ausgefuellte_formulare')
        .insert({ fahrer_id: fahrerRow.id, template_id: tplId, daten: {} })
        .select('id').single();
      if (error || !created) {
        console.warn('Konnte Protokoll-Draft nicht anlegen', error);
        setOpeningProtokoll(null);
        return;
      }
      navigate(`/formular/${created.id}`);
    } finally {
      setOpeningProtokoll(null);
    }
  }

  const [rows, setRows] = useState<TourRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default-Filter: aktueller Monat (1. → letzter Tag).
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd   = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const ymd = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const [dateFrom, setDateFrom] = useState<string>(ymd(monthStart));
  const [dateTo, setDateTo]     = useState<string>(ymd(monthEnd));
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('alle');
  const [auftraggeberFilter, setAuftraggeberFilter] = useState<string>('');
  const [fahrerFilter, setFahrerFilter]             = useState<string>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [openTourId, setOpenTourId] = useState<string | null>(null);

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
        ),
        schriftliches_protokoll:schriftliches_protokoll_id (id, name)
      `)
      .order('startdatum', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (err) {
      setError(err.message);
      setRows([]);
    } else {
      // Defensive Normalisierung: Supabase kann je nach Schema-Cache-Zustand
      // text[]-Spalten als null oder ein vergessener Default-Wert liefern.
      // Wir stellen sicher, dass kennzeichen IMMER ein Array ist und auch
      // die joined Relationen kein "undefined" einschleusen.
      const list = Array.isArray(data) ? data : [];
      const normalized = list.map((r: unknown) => {
        const row = (r as Record<string, unknown>) ?? {};
        const kz = row.kennzeichen;
        return {
          ...row,
          kennzeichen: Array.isArray(kz) ? kz : [],
          auftraggeber: (row.auftraggeber as TourRow['auftraggeber']) ?? null,
          fahrer: (row.fahrer as TourRow['fahrer']) ?? null,
          schriftliches_protokoll: (row.schriftliches_protokoll as TourRow['schriftliches_protokoll']) ?? null,
        } as TourRow;
      });
      setRows(normalized);
    }
    if (silent) setRefreshing(false); else setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Reset Pagination wenn Filter sich ändern
  useEffect(() => { setPage(1); }, [dateFrom, dateTo, statusFilter, search, auftraggeberFilter, fahrerFilter]);

  // Lookup-Listen für die Filter-Dropdowns (eigene Queries, damit auch
  // Auftraggeber / Fahrer angezeigt werden, deren Touren noch nicht im
  // aktuellen Zeitraum liegen).
  const [auftraggeberOptions, setAuftraggeberOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [fahrerOptions, setFahrerOptions] = useState<Array<{ id: string; label: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [agRes, faRes] = await Promise.all([
        supabase.from('auftraggeber').select('id, name').order('name'),
        supabase
          .from('fahrer')
          .select('id, user:user_id (email, vorname, nachname)')
          .eq('aktiv', true),
      ]);
      if (cancelled) return;
      setAuftraggeberOptions(Array.isArray(agRes.data) ? agRes.data : []);
      const fa = (Array.isArray(faRes.data) ? faRes.data : [])
        .map((f) => {
          const user = (f as { user?: unknown }).user;
          const u = user && typeof user === 'object' ? user as { email?: unknown; vorname?: unknown; nachname?: unknown } : null;
          const safeUser = u ? {
            email:    typeof u.email === 'string' ? u.email : '',
            vorname:  typeof u.vorname === 'string' ? u.vorname : null,
            nachname: typeof u.nachname === 'string' ? u.nachname : null,
          } : null;
          return {
            id: (f as { id: string }).id,
            label: displayName(safeUser) || '—',
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label, 'de'));
      setFahrerOptions(fa);
    })();
    return () => { cancelled = true; };
  }, []);

  // ---- Touren im gewählten Datums-Bereich ----
  // Maßgeblich ist das ENDDATUM (Fallback auf startdatum, falls noch
  // kein Enddatum gesetzt ist) — eine Tour mit enddatum im Januar 2026
  // gehört damit zum Januar 2026.
  const rangeRows = useMemo(() => {
    const fromKey = dateFrom.replace(/-/g, '');
    const toKey   = dateTo.replace(/-/g, '');
    return (rows ?? []).filter((t) => {
      const ref = t?.enddatum ?? t?.startdatum;
      if (!ref) return false;
      const d = new Date(ref);
      if (isNaN(d.getTime())) return false;
      const pad = (n: number) => String(n).padStart(2, '0');
      const key = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
      return key >= fromKey && key <= toKey;
    });
  }, [rows, dateFrom, dateTo]);

  // ---- Gefilterte Touren (Status [computed] + Suche) ----
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rangeRows ?? []).filter((t) => {
      if (statusFilter !== 'alle' && computeTourStatus(t.startdatum, t.enddatum) !== statusFilter) return false;
      if (auftraggeberFilter && t.auftraggeber_id !== auftraggeberFilter) return false;
      if (fahrerFilter && t.fahrer_id !== fahrerFilter) return false;
      if (!q) return true;
      const fahrerName = displayName(t.fahrer?.user ?? null).toLowerCase();
      const haystack = [
        t.tour_id ?? '',
        t.start_stadt ?? '',
        t.ziel_stadt ?? '',
        t.rueckfuehrung_stadt ?? '',
        t.kundenname ?? '',
        t.fin ?? '',
        fahrerName,
        ...(Array.isArray(t.kennzeichen) ? t.kennzeichen : []),
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [rangeRows, statusFilter, search, auftraggeberFilter, fahrerFilter]);

  // ---- KPI-Daten ----
  // Alle KPIs respektieren Auftraggeber- und Fahrer-Filter (siehe Spec:
  // "wenn ich nach Auftraggeber filtere, zeigen die KPIs nur die Werte
  // des gefilterten Auftraggebers"). Aktiv/Geplant ignorieren bewusst
  // den Status-Filter, damit die Zahlen beim Wechsel der Status-Pills
  // stabil bleiben.
  const kpiRangeRows = useMemo(() => {
    return (rangeRows ?? []).filter((t) => {
      if (auftraggeberFilter && t.auftraggeber_id !== auftraggeberFilter) return false;
      if (fahrerFilter && t.fahrer_id !== fahrerFilter) return false;
      return true;
    });
  }, [rangeRows, auftraggeberFilter, fahrerFilter]);

  const kpi = useMemo(() => {
    const sum = (filteredRows ?? []).reduce((acc, t) => acc + Number(t.verguetung ?? 0), 0);
    let aktiv = 0;
    let geplant = 0;
    for (const t of kpiRangeRows) {
      const s = computeTourStatus(t.startdatum, t.enddatum);
      if (s === 'aktiv') aktiv += 1;
      if (s === 'geplant') geplant += 1;
    }
    return {
      total: kpiRangeRows.length,
      sum,
      sumCount: (filteredRows ?? []).length,
      aktiv, geplant,
    };
  }, [kpiRangeRows, filteredRows]);

  // ---- Pagination ----
  const totalPages = Math.max(1, Math.ceil((filteredRows ?? []).length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = (filteredRows ?? []).slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

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
            <>
              <button type="button" className="btn-secondary" onClick={() => setShowImport(true)}>
                Touren importieren
              </button>
              <button type="button" className="btn-primary" onClick={() => setShowCreate(true)}>
                + Neue Tour
              </button>
            </>
          )}
        </div>
      </div>

      {/* Datums-Filter */}
      <div className="card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="t-from" className="label">Startdatum</label>
            <input id="t-from" type="date" className="input"
                   value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label htmlFor="t-to" className="label">Enddatum</label>
            <input id="t-to" type="date" className="input"
                   value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <button
            type="button"
            className="btn-secondary px-3 py-2 text-sm"
            onClick={() => { setDateFrom(ymd(monthStart)); setDateTo(ymd(monthEnd)); }}
          >
            Aktueller Monat
          </button>
          <button
            type="button"
            className="btn-secondary px-3 py-2 text-sm"
            onClick={() => {
              const yStart = new Date(today.getFullYear(), 0, 1);
              const yEnd = new Date(today.getFullYear(), 11, 31);
              setDateFrom(ymd(yStart)); setDateTo(ymd(yEnd));
            }}
          >
            Aktuelles Jahr
          </button>
        </div>
      </div>

      {/* KPI-Karten — Summe Ansicht (Vergütung) nur für Admins */}
      <div className={`grid gap-3 sm:grid-cols-2 ${isAdmin ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        <KpiCard
          title="Touren im Zeitraum"
          value={String(kpi.total)}
          hint={`${dateFrom} – ${dateTo}`}
        />
        {isAdmin && (
          <KpiCard
            title="Summe Ansicht"
            value={formatEuro(kpi.sum)}
            hint={`${kpi.sumCount} ${kpi.sumCount === 1 ? 'Tour' : 'Touren'}`}
          />
        )}
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

      {/* Auftraggeber + Fahrer Filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-1 min-w-[12rem] flex-col">
          <label htmlFor="t-ag-filter" className="text-xs font-medium uppercase tracking-wide text-maja-muted">
            Auftraggeber
          </label>
          <select
            id="t-ag-filter"
            className="input"
            value={auftraggeberFilter}
            onChange={(e) => setAuftraggeberFilter(e.target.value)}
          >
            <option value="">Alle Auftraggeber</option>
            {auftraggeberOptions.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-1 min-w-[12rem] flex-col">
          <label htmlFor="t-fa-filter" className="text-xs font-medium uppercase tracking-wide text-maja-muted">
            Fahrer
          </label>
          <select
            id="t-fa-filter"
            className="input"
            value={fahrerFilter}
            onChange={(e) => setFahrerFilter(e.target.value)}
          >
            <option value="">Alle Fahrer</option>
            {fahrerOptions.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
        </div>
        {(auftraggeberFilter || fahrerFilter) && (
          <button
            type="button"
            className="btn-secondary self-end px-3 py-2 text-sm"
            onClick={() => { setAuftraggeberFilter(''); setFahrerFilter(''); }}
          >
            Filter zurücksetzen
          </button>
        )}
      </div>

      {/* Tourenliste */}
      {(pageRows ?? []).length === 0 ? (
        <div className="card p-8 text-center text-sm text-maja-muted">
          Keine Touren entsprechen den aktuellen Filtern.
        </div>
      ) : (
        <ul className="space-y-3">
          {(pageRows ?? []).map((t) => (
            <TourCard
              key={t.id}
              tour={t}
              onOpen={() => setOpenTourId(t.id)}
              onOpenProtokoll={() => void openSchriftlichesProtokoll(t)}
              opening={openingProtokoll === t.id}
              isAdmin={isAdmin}
            />
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

      {showImport && isAdmin && (
        <TourImportDialog
          onClose={() => setShowImport(false)}
          onImported={() => { void load(); }}
        />
      )}

      {openTourId && (
        <TourDetailDialog
          tourId={openTourId}
          onClose={() => setOpenTourId(null)}
          onChanged={() => void load(true)}
          onDeleted={() => { setOpenTourId(null); void load(); }}
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

interface CardProps {
  tour: TourRow;
  onOpen: () => void;
  onOpenProtokoll: () => void;
  opening: boolean;
  isAdmin: boolean;
}
function TourCard({ tour, onOpen, onOpenProtokoll, opening, isAdmin }: CardProps) {
  const protokollName = tour.schriftliches_protokoll?.name ?? null;
  const hasSchriftlich = tour.protokoll_art === 'schriftlich' && !!tour.schriftliches_protokoll_id;
  const fahrerName = displayName(tour.fahrer?.user ?? null) || '— kein Fahrer —';
  const computedStatus = computeTourStatus(tour.startdatum, tour.enddatum);
  const dateRange = (() => {
    if (!tour.startdatum && !tour.enddatum) return null;
    if (tour.startdatum && tour.enddatum) {
      return `${formatDate(tour.startdatum)} – ${formatDate(tour.enddatum)}`;
    }
    return formatDate(tour.startdatum ?? tour.enddatum);
  })();

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
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
                {tourTitel(tour)}
              </h3>
            </div>

            <div className="mt-3 grid gap-2 text-sm text-maja-ink sm:grid-cols-2">
              <Meta icon={<IconUser />}>{fahrerName}</Meta>
              {isAdmin && <Meta icon={<IconPin />}>{formatKm(tour.km_gesamt)}</Meta>}
              {dateRange && <Meta icon={<IconCalendar />}>{dateRange}</Meta>}
              {((tour.kennzeichen ?? []).length > 0) && (
                <Meta icon={<IconCar />}>
                  {(tour.kennzeichen ?? []).join(', ')}
                  {tour.fin && (
                    <span className="ml-1 text-xs text-maja-muted">· FIN: {tour.fin}</span>
                  )}
                </Meta>
              )}
              {((tour.kennzeichen ?? []).length === 0) && tour.fin && (
                <Meta icon={<IconCar />}>FIN: {tour.fin}</Meta>
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

            {/* Schriftliches Protokoll: für Fahrer als Direkt-Link öffnen */}
            {hasSchriftlich && (
              isAdmin ? (
                <div className="mt-3 inline-flex items-center gap-1 rounded-full bg-maja-light px-3 py-1 text-xs font-medium text-maja-navy">
                  <IconClipboard /> Protokoll: {protokollName ?? 'verknüpft'}
                </div>
              ) : (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); onOpenProtokoll(); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onOpenProtokoll(); }
                  }}
                  className="mt-3 inline-flex cursor-pointer items-center gap-1 rounded-full bg-maja-navy px-3 py-1 text-xs font-medium text-white transition hover:bg-maja-accent"
                >
                  <IconClipboard />
                  {opening ? 'Öffne …' : `Protokoll öffnen${protokollName ? `: ${protokollName}` : ''}`}
                </div>
              )
            )}
          </div>

          <div className="flex flex-col items-end gap-2">
            <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
              STATUS_BADGE[computedStatus]
            }`}>
              {STATUS_LABEL[computedStatus]}
            </span>
            {tour.ist_e_fahrzeug && (
              <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                E-Fahrzeug
              </span>
            )}
            {isAdmin && (
              <div className="text-right">
                <div className="text-2xl font-bold text-maja-navy">
                  {formatEuro(tour.verguetung)}
                </div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-maja-muted">
                  Netto
                </div>
              </div>
            )}
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
function IconClipboard() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
      <path d="M7 2a2 2 0 00-2 2H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1a2 2 0 00-2-2H7zm0 2h6v2H7V4zm-1 5h8v1H6V9zm0 3h8v1H6v-1zm0 3h5v1H6v-1z" />
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
