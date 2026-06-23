import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { displayName } from '../../lib/names';
import { Spinner } from '../../components/Spinner';
import { useAuth } from '../../auth/AuthContext';
import { useTestMode } from '../../auth/TestModeContext';
import { useEingaengeNotifications } from '../../sync/EingaengeContext';
import {
  asPdfPathList, deleteFormPdf, downloadFormPdf, expectedOneDrivePath,
  generateAndUploadFormPdfs, generateAndUploadZwischenprotokoll,
  previewFormPdf, resolveFilename,
  type PdfPathEntry,
} from '../../lib/pdfGenerate';
import {
  DownloadIcon, EyeIcon, FileTextIcon, MailIcon, RefreshIcon, XIcon,
} from '../../components/icons';
import { formatGermanDate, summarizeEingang } from '../../lib/eingangData';
import { EingangLinkDialog } from './EingangLinkDialog';
import { EingangSendEmailDialog } from './EingangSendEmailDialog';
import { EingangFormularViewDialog } from './EingangFormularViewDialog';
import type {
  AppUser, AusgefuelltesFormular, EmailSendLogEntry,
  FormularTemplate, TemplatePdf,
} from '../../types/db';

interface Row extends AusgefuelltesFormular {
  fahrer?: {
    user_id: string;
    user?: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null;
  } | null;
  template?:
    & Pick<FormularTemplate, 'id' | 'name' | 'email_config'>
    & { pdfs: TemplatePdf[]; schema: unknown }
    | null;
  /** Verknüpfte Tour (oder null). */
  tour?: { id: string; tour_id: string | null } | null;
  zwischenprotokoll_url: string | null;
  zwischenprotokoll_erstellt_am: string | null;
}

// Performance: nicht alle Eingänge auf einmal laden. Initial nur eine
// Seite, ältere via "Mehr laden". Default-Zeitfenster begrenzt zusätzlich
// die Datenmenge. Filter (Status, Zeitraum) laufen server-seitig im Query.
const PAGE_SIZE = 25;
const DATE_WINDOW_DAYS = 90;

interface EingangCounts { alle: number; submitted: number; draft: number }

export function EingaengePage() {
  const { profile } = useAuth();
  const { isTestUser, effectiveRole, scopedFahrerIds: testScopedFahrerIds } = useTestMode();
  const isAdmin = profile?.role === 'admin';
  // Test+Fahrer-Sicht: zeigt nur Eingänge des im Banner gewählten Fahrers
  // (+ Unterkonten). RLS erlaubt Test alle Eingänge zu lesen; der
  // Filter macht die Sicht realistisch wie bei einem echten Fahrer.
  const testFahrerScope = isTestUser && effectiveRole === 'fahrer'
    ? testScopedFahrerIds : null;
  const { markEingangSeen } = useEingaengeNotifications();
  const [rows, setRows] = useState<Row[]>([]);
  const rowsRef = useRef<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [counts, setCounts] = useState<EingangCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [regen, setRegen] = useState<string | null>(null);
  const [linking, setLinking] = useState<Row | null>(null);
  const [resending, setResending] = useState<Row | null>(null);
  const [hideLinked, setHideLinked] = useState(true);
  const [linkToast, setLinkToast] = useState<string | null>(null);
  /** Status-Filter (Aufgabe 2B). Default "submitted" = wie bisher. */
  const [statusFilter, setStatusFilter] = useState<'submitted' | 'draft' | 'alle'>('submitted');
  /** Zeitfenster: standardmäßig die letzten 90 Tage; "all" = ohne Limit. */
  const [dateRange, setDateRange] = useState<'recent' | 'all'>('recent');
  /** Welcher Eingang/Entwurf ist im Read-Only-Viewer offen (Aufgabe 2A)? */
  const [viewing, setViewing] = useState<string | null>(null);
  /** Auswahl für Bulk-Löschen bei Entwürfen. */
  const [selectedDrafts, setSelectedDrafts] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState<null | { ids: string[]; mode: 'selected' | 'empty' }>(null);

  useEffect(() => { rowsRef.current = rows; }, [rows]);

  // Zeitfenster-Grenze als ISO (oder null für "alle"). Wird in Query +
  // Count-Query genutzt.
  const cutoffIso = useMemo(() => {
    if (dateRange === 'all') return null;
    const d = new Date();
    d.setDate(d.getDate() - DATE_WINDOW_DAYS);
    return d.toISOString();
  }, [dateRange]);

  /**
   * Lädt eine Seite Eingänge. `reset=true` ersetzt die Liste (erste Seite
   * / Filter-Wechsel), sonst werden ältere angehängt ("Mehr laden").
   * NUR die in der Übersicht benötigten Spalten werden selektiert; die
   * großen Bild-/Signatur-Inhalte in `daten` werden nur für die jeweils
   * sichtbare Seite (PAGE_SIZE) geladen, nicht für alle Eingänge.
   * Status + Zeitfenster filtern server-seitig.
   */
  const load = useCallback(async (reset: boolean) => {
    const offset = reset ? 0 : rowsRef.current.length;
    if (reset) setLoading(true); else setLoadingMore(true);
    setError(null);
    let q = supabase
      .from('ausgefuellte_formulare')
      .select(`
        id, fahrer_id, template_id, daten, status, created_at, gesehen_am,
        zwischenprotokoll_url, zwischenprotokoll_erstellt_am,
        pdf_paths, pdf_status, pdf_fehler, email_send_log,
        fahrer:fahrer_id (user_id, user:user_id (email, vorname, nachname)),
        template:template_id (id, name, pdfs, schema, email_config)
      `)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (statusFilter !== 'alle') q = q.eq('status', statusFilter);
    if (cutoffIso) q = q.gte('created_at', cutoffIso);
    if (testFahrerScope) {
      if (testFahrerScope.length === 0) {
        // Kein Fahrer gewählt → leere Liste statt aller Eingänge.
        setRows([]); setHasMore(false);
        if (reset) setLoading(false); else setLoadingMore(false);
        return;
      }
      q = q.in('fahrer_id', testFahrerScope);
    }
    const { data, error: err } = await q;
    if (err) {
      setError(err.message);
      if (reset) setLoading(false); else setLoadingMore(false);
      return;
    }
    const pageRows = (data as unknown as Row[]) ?? [];
    // Verknüpfte Touren je Eingang nachladen (nur für die geladene Seite).
    const ids = pageRows.map((r) => r.id);
    const tourMap = new Map<string, { id: string; tour_id: string | null }>();
    if (ids.length > 0) {
      const idList = ids.map((id) => `"${id}"`).join(',');
      const { data: tdata } = await supabase
        .from('touren')
        .select('id, tour_id, eingang_id, eingang_id_bc')
        .or(`eingang_id.in.(${idList}),eingang_id_bc.in.(${idList})`);
      for (const t of tdata ?? []) {
        if (t.eingang_id && ids.includes(t.eingang_id)) {
          tourMap.set(t.eingang_id, { id: t.id, tour_id: t.tour_id });
        }
        if (t.eingang_id_bc && ids.includes(t.eingang_id_bc)) {
          tourMap.set(t.eingang_id_bc, { id: t.id, tour_id: t.tour_id });
        }
      }
    }
    const withTours = pageRows.map((r) => ({ ...r, tour: tourMap.get(r.id) ?? null }));
    setRows((prev) => (reset ? withTours : [...prev, ...withTours]));
    setHasMore(pageRows.length === PAGE_SIZE);
    if (reset) setLoading(false); else setLoadingMore(false);
  }, [statusFilter, cutoffIso, testFahrerScope]);

  // Gesamtzahlen für die Tab-Badges — via COUNT (head), nicht durch
  // Laden aller Zeilen. Respektiert das Zeitfenster.
  const refreshCounts = useCallback(async () => {
    const mk = () => {
      let q = supabase
        .from('ausgefuellte_formulare')
        .select('id', { count: 'exact', head: true });
      if (cutoffIso) q = q.gte('created_at', cutoffIso);
      if (testFahrerScope) {
        if (testFahrerScope.length === 0) return null;
        q = q.in('fahrer_id', testFahrerScope);
      }
      return q;
    };
    try {
      const qa = mk(); const qs = mk()?.eq('status', 'submitted');
      const qd = mk()?.eq('status', 'draft');
      if (!qa || !qs || !qd) {
        setCounts({ alle: 0, submitted: 0, draft: 0 });
        return;
      }
      const [a, s, d] = await Promise.all([qa, qs, qd]);
      setCounts({ alle: a.count ?? 0, submitted: s.count ?? 0, draft: d.count ?? 0 });
    } catch { /* Count nicht kritisch */ }
  }, [cutoffIso, testFahrerScope]);

  /** Liste + Zähler frisch laden (nach Mutationen / Filter-Wechsel). */
  const reload = useCallback(() => {
    void load(true);
    void refreshCounts();
  }, [load, refreshCounts]);

  // Bei Filter-/Zeitraum-Wechsel neu von vorn laden.
  useEffect(() => { void load(true); }, [load]);
  // Counts deferred, damit setState nicht synchron im Effect läuft.
  useEffect(() => {
    const t = window.setTimeout(() => { void refreshCounts(); }, 0);
    return () => window.clearTimeout(t);
  }, [refreshCounts]);

  // Markiert den Eingang als gesehen (für Badge-Update) und patcht den
  // lokalen State, damit die Hervorhebung sofort verschwindet. Wird bei
  // jeder echten Admin-Interaktion (Klick aufs Eingangs-Detail, E-Mail
  // versenden, PDFs neu erzeugen, Tour verknüpfen, Zwischenprotokoll
  // erstellen) aufgerufen — NICHT beim bloßen Öffnen des Reiters.
  const handleSeen = useCallback(async (r: Row) => {
    if (!isAdmin) return;
    if (r.gesehen_am) return;
    await markEingangSeen(r.id);
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, gesehen_am: new Date().toISOString() } : x)));
  }, [isAdmin, markEingangSeen]);

  const visibleRows = useMemo(() => {
    return rows.filter((r) => {
      // Status-Filter: bei "submitted" weiterhin auch hideLinked.
      if (statusFilter !== 'alle' && r.status !== statusFilter) return false;
      if (statusFilter === 'submitted' && hideLinked && r.tour) return false;
      return true;
    });
  }, [rows, hideLinked, statusFilter]);

  const draftRows = useMemo(() => rows.filter((r) => r.status === 'draft'), [rows]);

  /**
   * "Leerer Entwurf": daten ist leer oder enthält nur leere/false-y
   * Werte. Wird für den "Alle leeren Entwürfe löschen"-Pfad genutzt
   * (Aufgabe 2B Massenauswahl).
   */
  function isEmptyDraft(r: Row): boolean {
    if (r.status !== 'draft') return false;
    const d = (r.daten ?? {}) as Record<string, unknown>;
    for (const v of Object.values(d)) {
      if (v == null) continue;
      if (typeof v === 'string' && v.trim() === '') continue;
      if (typeof v === 'boolean' && !v) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      if (typeof v === 'object' && v !== null && Object.keys(v as Record<string, unknown>).length === 0) continue;
      // Ein nicht-trivialer Wert → Entwurf nicht leer.
      return false;
    }
    return true;
  }

  function toggleDraftSelected(id: string) {
    setSelectedDrafts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function performBulkDelete(ids: string[]) {
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const { error: err } = await supabase
        .from('ausgefuellte_formulare')
        .delete()
        .in('id', ids);
      if (err) { setError(err.message); return; }
      setRows((prev) => prev.filter((r) => !ids.includes(r.id)));
      setSelectedDrafts((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      setLinkToast(`${ids.length} ${ids.length === 1 ? 'Entwurf' : 'Entwürfe'} gelöscht.`);
      window.setTimeout(() => setLinkToast(null), 4000);
      void refreshCounts();
    } finally {
      setBulkBusy(false);
      setBulkConfirm(null);
    }
  }

  async function regeneratePdfs(r: Row) {
    if (!r.template) return;
    setRegen(r.id);
    try {
      const tpl: FormularTemplate = {
        id: r.template_id,
        name: r.template.name ?? '',
        schema: (r.template.schema as FormularTemplate['schema']) ?? { sections: [] },
        pdfs: r.template.pdfs ?? [],
        email_config: null,
        sichtbar: true,
      };
      const generated = await generateAndUploadFormPdfs(tpl, r);
      // pdf_paths wurde von generateAndUploadFormPdfs persistiert — wir
      // patchen den lokalen State, damit die UI sofort die aktuelle
      // Liste zeigt (übersprungene PDFs sind weg).
      const paths: PdfPathEntry[] = generated.map((g) => ({
        pdf_id: g.pdf.id, pdf_name: g.pdf.name,
        filename: g.filename, onedrive_path: g.onedrive_path,
      }));
      // Manuelle Generierung war erfolgreich → eventuellen Fehlerstatus
      // der Auto-Generierung zurücksetzen.
      try {
        await supabase.from('ausgefuellte_formulare')
          .update({ pdf_status: 'ok', pdf_fehler: null })
          .eq('id', r.id);
      } catch { /* nicht kritisch */ }
      await patchRowInState(r.id, {
        pdf_paths: paths as unknown as AusgefuelltesFormular['pdf_paths'],
        pdf_status: 'ok',
        pdf_fehler: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF-Generierung fehlgeschlagen');
    } finally {
      setRegen(null);
    }
  }

  async function patchRowInState(id: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  if (loading) return <Spinner label="Eingänge werden geladen …" />;
  if (error) {
    return <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }

  const linkedCount = rows.filter((r) => !!r.tour).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-maja-navy">Eingänge</h1>
          <p className="text-sm text-maja-muted">
            {isAdmin
              ? 'Alle Protokolle. Mit Tour verknüpfen oder PDFs herunterladen.'
              : 'Deine Protokolle. PDFs als Vorschau öffnen oder herunterladen.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {statusFilter === 'submitted' && linkedCount > 0 && (
            <label className="flex items-center gap-2 text-sm text-maja-ink">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy focus:ring-maja-accent"
                checked={hideLinked}
                onChange={(e) => setHideLinked(e.target.checked)}
              />
              Verknüpfte ausblenden ({linkedCount})
            </label>
          )}
          <button
            type="button"
            onClick={reload}
            disabled={loading}
            className="btn-secondary inline-flex items-center gap-1.5 text-sm"
            title="Eingänge neu laden"
          >
            <RefreshIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Aktualisieren
          </button>
        </div>
      </div>

      {/* Zeitraum-Filter (server-seitig). Default: letzte 90 Tage. */}
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs font-medium uppercase tracking-wide text-maja-muted">
            Zeitraum
          </span>
          {([
            { id: 'recent' as const, label: `Letzte ${DATE_WINDOW_DAYS} Tage` },
            { id: 'all' as const, label: 'Alle' },
          ]).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setDateRange(opt.id)}
              className={`rounded-full px-3 py-1 text-sm font-medium transition ${
                dateRange === opt.id
                  ? 'bg-maja-navy text-white'
                  : 'bg-white text-maja-navy border border-maja-navy/15 hover:bg-maja-light'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Status-Filter (Aufgabe 2B) */}
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-1">
          {([
            { id: 'submitted' as const, label: 'Eingereicht', cnt: counts?.submitted },
            { id: 'draft' as const,     label: 'Entwürfe',    cnt: counts?.draft },
            { id: 'alle' as const,      label: 'Alle',        cnt: counts?.alle },
          ]).map((opt) => {
            const active = statusFilter === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setStatusFilter(opt.id);
                  setSelectedDrafts(new Set());
                }}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  active
                    ? 'bg-maja-navy text-white'
                    : 'bg-white text-maja-navy border border-maja-navy/15 hover:bg-maja-light'
                }`}
              >
                {opt.label}{opt.cnt != null ? ` (${opt.cnt})` : ''}
              </button>
            );
          })}
        </div>
      )}

      {/* Bulk-Aktionen für Entwürfe */}
      {isAdmin && statusFilter === 'draft' && draftRows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-maja-navy/10 bg-maja-light/40 px-3 py-2 text-sm">
          <span className="text-maja-muted">
            {selectedDrafts.size > 0
              ? `${selectedDrafts.size} ausgewählt`
              : `${draftRows.length} Entwurf${draftRows.length === 1 ? '' : 'e'} in der Liste`}
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={selectedDrafts.size === 0 || bulkBusy}
              onClick={() => setBulkConfirm({ ids: [...selectedDrafts], mode: 'selected' })}
              className="rounded-md border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Ausgewählte löschen
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => {
                const emptyIds = draftRows.filter(isEmptyDraft).map((r) => r.id);
                setBulkConfirm({ ids: emptyIds, mode: 'empty' });
              }}
              className="rounded-md border border-maja-navy/20 bg-white px-3 py-1 text-xs font-medium text-maja-navy hover:bg-maja-light disabled:cursor-not-allowed disabled:opacity-50"
            >
              Alle leeren Entwürfe löschen
            </button>
          </div>
        </div>
      )}

      {visibleRows.length === 0 ? (
        <div className="card p-6 text-sm text-maja-muted">
          {hideLinked && rows.length > 0
            ? 'Alle Eingänge sind bereits mit Touren verknüpft.'
            : 'Noch keine Formulare erfasst.'}
        </div>
      ) : (
        <ul className="space-y-3">
          {visibleRows.map((r) => (
            <EingangCard
              key={r.id}
              row={r}
              isAdmin={isAdmin}
              regenBusy={regen === r.id}
              selectable={statusFilter === 'draft' && r.status === 'draft'}
              selected={selectedDrafts.has(r.id)}
              onToggleSelected={() => toggleDraftSelected(r.id)}
              onSeen={() => void handleSeen(r)}
              onView={() => setViewing(r.id)}
              onRegenerate={() => { void handleSeen(r); void regeneratePdfs(r); }}
              onLink={() => { void handleSeen(r); setLinking(r); }}
              onResendEmail={() => { void handleSeen(r); setResending(r); }}
              onDelete={() => setBulkConfirm({ ids: [r.id], mode: 'selected' })}
              onZwischenChanged={(patch) => void patchRowInState(r.id, patch)}
            />
          ))}
        </ul>
      )}

      {hasMore && (
        <div className="flex justify-center pt-1">
          <button
            type="button"
            onClick={() => void load(false)}
            disabled={loadingMore}
            className="btn-secondary text-sm"
          >
            {loadingMore ? 'Lädt …' : 'Mehr laden'}
          </button>
        </div>
      )}

      {linking && isAdmin && (
        <EingangLinkDialog
          formular={linking}
          template={linking.template ? {
            id: linking.template.id,
            name: linking.template.name,
          } : null}
          onClose={() => setLinking(null)}
          onLinked={(filled) => {
            setLinking(null);
            reload();
            if (filled.length > 0) {
              setLinkToast(`${filled.join(' & ')} aus Protokoll übernommen.`);
            } else {
              setLinkToast('Tour verknüpft.');
            }
            window.setTimeout(() => setLinkToast(null), 4000);
          }}
        />
      )}

      {resending && isAdmin && resending.template && (() => {
        const t = resending.template;
        const tpl: FormularTemplate = {
          id: t.id,
          name: t.name ?? '',
          schema: (t.schema as FormularTemplate['schema']) ?? { sections: [] },
          pdfs: t.pdfs ?? [],
          email_config: t.email_config ?? null,
          sichtbar: true,
        };
        return (
          <EingangSendEmailDialog
            formular={resending}
            template={tpl}
            onClose={() => setResending(null)}
            onSent={() => {
              setResending(null);
              setLinkToast('E-Mail versendet.');
              window.setTimeout(() => setLinkToast(null), 4000);
            }}
          />
        );
      })()}

      {linkToast && (
        <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-maja-navy px-4 py-2 text-sm font-medium text-white shadow-lg">
          {linkToast}
        </div>
      )}

      {viewing && (
        <EingangFormularViewDialog
          formularId={viewing}
          onClose={() => setViewing(null)}
        />
      )}

      {bulkConfirm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-maja-ink/40 px-4">
          <div className="card w-full max-w-md p-5">
            <h3 className="text-base font-semibold text-maja-navy">
              {bulkConfirm.mode === 'empty'
                ? `${bulkConfirm.ids.length} leere Entwürfe löschen?`
                : `${bulkConfirm.ids.length === 1
                    ? 'Entwurf löschen?'
                    : `${bulkConfirm.ids.length} Entwürfe löschen?`}`}
            </h3>
            <p className="mt-2 text-sm text-maja-muted">
              {bulkConfirm.mode === 'empty' && bulkConfirm.ids.length === 0
                ? 'Keine leeren Entwürfe gefunden — nichts zu löschen.'
                : 'Dies kann nicht rückgängig gemacht werden. Die Datensätze werden aus der Datenbank entfernt.'}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-secondary"
                      onClick={() => setBulkConfirm(null)}
                      disabled={bulkBusy}>
                Abbrechen
              </button>
              <button type="button"
                      className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      onClick={() => void performBulkDelete(bulkConfirm.ids)}
                      disabled={bulkBusy || bulkConfirm.ids.length === 0}>
                {bulkBusy ? 'Löscht …' : 'Löschen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface CardProps {
  row: Row;
  isAdmin: boolean;
  regenBusy: boolean;
  /** Bulk-Select-Modus (nur Entwürfe): wenn !== null, ist die Card
   *  im Auswahl-Modus mit Checkbox; sonst klassisch. */
  selectable: boolean;
  selected: boolean;
  onToggleSelected: () => void;
  onSeen: () => void;
  onView: () => void;
  onRegenerate: () => void;
  onLink: () => void;
  onResendEmail: () => void;
  onDelete: () => void;
  onZwischenChanged: (patch: Partial<Row>) => void;
}

function EingangCard({
  row, isAdmin, regenBusy,
  selectable, selected, onToggleSelected,
  onSeen, onView, onRegenerate, onLink, onResendEmail, onDelete, onZwischenChanged,
}: CardProps) {
  const summary = useMemo(() => summarizeEingang(row), [row]);
  const fahrer = displayName(row.fahrer?.user ?? null) || summary.fahrername || '—';
  const tpl: FormularTemplate | null = row.template ? {
    id: row.template_id,
    name: row.template.name ?? '',
    schema: (row.template.schema as FormularTemplate['schema']) ?? { sections: [] },
    pdfs: row.template.pdfs ?? [],
    email_config: row.template.email_config ?? null,
    sichtbar: true,
  } : null;

  const ungesehen = isAdmin && !row.gesehen_am;
  return (
    <li
      className={
        'card p-4 transition ' +
        (ungesehen
          ? 'border-l-4 border-l-maja-accent bg-maja-light/40'
          : '')
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div
          role={ungesehen ? 'button' : undefined}
          tabIndex={ungesehen ? 0 : undefined}
          onClick={ungesehen ? onSeen : undefined}
          onKeyDown={ungesehen ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSeen(); }
          } : undefined}
          className={'min-w-0 flex-1 ' + (ungesehen ? 'cursor-pointer' : '')}
          aria-label={ungesehen ? 'Als gesehen markieren' : undefined}
        >
          <div className="flex flex-wrap items-center gap-2">
            {ungesehen && (
              <span
                className="inline-block h-2 w-2 rounded-full bg-maja-accent"
                aria-label="Neu"
                title="Neu — noch nicht gesehen"
              />
            )}
            <h3 className="text-base font-semibold text-maja-navy">
              {summary.kennzeichen ?? row.template?.name ?? 'Eingang'}
            </h3>
            <span className={
              'inline-flex rounded-full px-2 py-0.5 text-xs font-medium ' +
              (row.status === 'submitted'
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-amber-100 text-amber-800')
            }>
              {row.status === 'submitted' ? 'eingereicht' : 'Entwurf'}
            </span>
            {row.tour && (
              <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                Verknüpft{row.tour.tour_id ? ` · ${row.tour.tour_id}` : ''}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-maja-muted">
            {row.template?.name ?? '—'}
            {' · '}{formatGermanDate(summary.datum) || formatGermanDate(row.created_at)}
          </div>

          <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            <Detail label="Fahrer">{fahrer}</Detail>
            {summary.kundenname && <Detail label="Kunde">{summary.kundenname}</Detail>}
            {summary.fin && <Detail label="FIN" mono>{summary.fin}</Detail>}
            {summary.adresseUebernahme && (
              <Detail label="Übernahme" full>{summary.adresseUebernahme}</Detail>
            )}
            {summary.adresseUebergabe && (
              <Detail label="Übergabe" full>{summary.adresseUebergabe}</Detail>
            )}
          </dl>

          {isAdmin && row.pdf_status === 'fehlgeschlagen' && (
            <div role="alert" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <strong>PDFs konnten nicht automatisch generiert werden.</strong>{' '}
              Bitte unten „PDFs neu erzeugen" nutzen.
              {row.pdf_fehler && (
                <span className="mt-1 block text-[11px] text-amber-700">
                  Fehler: {row.pdf_fehler}
                </span>
              )}
            </div>
          )}

          {isAdmin && row.status === 'submitted' && (
            <EmailSendLog log={row.email_send_log as unknown as EmailSendLogEntry[] | null | undefined} />
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          {selectable && (
            <label className="flex items-center gap-2 text-xs text-maja-muted">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                checked={selected}
                onChange={onToggleSelected}
                aria-label="Entwurf auswählen"
              />
              Auswählen
            </label>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={onView}
              className="text-xs font-medium text-maja-accent hover:underline"
            >
              Formular ansehen
            </button>
          )}
          {isAdmin && row.status === 'draft' && (
            <button
              type="button"
              onClick={onDelete}
              className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
            >
              Entwurf löschen
            </button>
          )}
          {isAdmin && row.status === 'submitted' && !row.tour && (
            <button type="button" onClick={onLink} className="btn-primary text-sm">
              Mit Tour verknüpfen
            </button>
          )}
          {isAdmin && row.status === 'draft' && tpl && (
            <ZwischenprotokollSection
              template={tpl}
              formular={row}
              onChanged={onZwischenChanged}
              onCreate={onSeen}
            />
          )}
          {isAdmin && row.status === 'submitted' && tpl && (tpl.pdfs?.length ?? 0) > 0 && (
            <button
              type="button"
              onClick={onResendEmail}
              className="inline-flex items-center gap-1 rounded-full bg-maja-navy px-3 py-1 text-xs font-medium text-white hover:bg-maja-accent"
              title="E-Mail mit PDFs versenden"
            >
              <MailIcon className="h-3.5 w-3.5" /> E-Mail versenden
            </button>
          )}
          {isAdmin && row.status === 'submitted' && (row.template?.pdfs ?? []).some((p) => p.path) && (
            <button
              type="button"
              onClick={onRegenerate}
              disabled={regenBusy}
              className="text-xs font-medium text-maja-accent hover:underline"
            >
              {regenBusy ? 'Generiere …' : 'PDFs neu erzeugen'}
            </button>
          )}
        </div>
      </div>

      {/* Protokoll-PDFs in eigenem, voll-breitem Block UNTER den
          Fahrzeugdaten — sonst überlappen sie bei mehreren PDFs mit der
          FIN-Zeile der linken Spalte. Der Container wächst frei mit
          (umbrechende Buttons, keine feste Höhe). */}
      {row.status === 'submitted' && tpl && (
        <div className="mt-3 border-t border-maja-navy/10 pt-3">
          <PdfDownloads template={tpl} formular={row} />
        </div>
      )}
    </li>
  );
}

function Detail({
  label, children, mono, full,
}: { label: string; children: React.ReactNode; mono?: boolean; full?: boolean }) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <dt className="text-xs font-medium uppercase tracking-wide text-maja-muted">{label}</dt>
      <dd className={'text-sm text-maja-ink' + (mono ? ' font-mono' : '')}>{children}</dd>
    </div>
  );
}

/**
 * Liefert die Liste der tatsächlich vorhandenen PDFs für einen Eingang.
 * Bevorzugt das persistierte pdf_paths-Feld (neu seit Migration 037);
 * für Legacy-Eingänge ohne pdf_paths fallback auf alle Template-PDFs
 * (vorherige Logik). So bleiben alte Eingänge weiter downloadbar.
 */
function effectivePdfList(
  template: FormularTemplate, formular: Row,
): Array<{ id: string; name: string; filename: string; onedrive_path: string }> {
  const persisted = asPdfPathList((formular as unknown as { pdf_paths?: unknown }).pdf_paths);
  if (persisted.length > 0) {
    return persisted.map((p) => ({
      id: p.pdf_id, name: p.pdf_name, filename: p.filename, onedrive_path: p.onedrive_path,
    }));
  }
  return (template.pdfs ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    filename: resolveFilename(p.filename_pattern, formular.daten, p.id),
    onedrive_path: expectedOneDrivePath(template, formular, p),
  }));
}

function PdfDownloads({
  template, formular,
}: { template: FormularTemplate; formular: Row }) {
  const list = effectivePdfList(template, formular);
  if (list.length === 0) {
    return <span className="text-xs text-maja-muted">keine PDFs erzeugt</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-maja-muted">
        Protokoll-PDFs
      </span>
      {list.map((p) => (
        <PdfDownloadButton
          key={p.id}
          label={p.name}
          filename={p.filename}
          path={p.onedrive_path}
          formularId={formular.id}
        />
      ))}
    </div>
  );
}

function PdfDownloadButton({
  label, filename, path, formularId,
}: { label: string; filename: string; path: string; formularId: string }) {
  const [busy, setBusy] = useState<'download' | 'preview' | null>(null);
  async function download() {
    setBusy('download');
    const ok = await downloadFormPdf(path, filename, formularId);
    setBusy(null);
    if (!ok) alert('PDF noch nicht generiert oder nicht erreichbar. Beim Einreichen werden die PDFs automatisch erzeugt.');
  }
  async function preview() {
    setBusy('preview');
    const ok = await previewFormPdf(path, formularId);
    setBusy(null);
    if (!ok) alert('PDF konnte nicht geöffnet werden. Beim Einreichen werden die PDFs automatisch erzeugt.');
  }
  return (
    <span className="inline-flex items-stretch overflow-hidden rounded-full border border-slate-300 bg-maja-light text-xs text-maja-navy dark:border-slate-600 dark:bg-surface-700">
      <button
        type="button"
        onClick={preview}
        disabled={busy !== null}
        className="flex items-center px-2 py-1 hover:bg-maja-accent/20 dark:hover:bg-surface-600"
        title={`Vorschau: ${filename}`}
        aria-label="Vorschau"
      >
        {busy === 'preview' ? <span>…</span> : <EyeIcon className="h-4 w-4" />}
      </button>
      <button
        type="button"
        onClick={download}
        disabled={busy !== null}
        className="flex items-center gap-1 border-l border-slate-300 px-2 py-1 hover:bg-maja-accent/20 dark:border-slate-600 dark:hover:bg-surface-600"
        title={`Download: ${filename}\n${path}`}
      >
        {busy === 'download' ? <span>…</span> : <DownloadIcon className="h-4 w-4" />}
        {label}
      </button>
    </span>
  );
}

function ZwischenprotokollSection({
  template, formular, onChanged, onCreate,
}: {
  template: FormularTemplate;
  formular: Row;
  onChanged: (patch: Partial<Row>) => void;
  onCreate?: () => void;
}) {
  const [busy, setBusy] = useState<'create' | 'preview' | 'download' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const existing = formular.zwischenprotokoll_url;

  async function generate() {
    setBusy('create');
    setError(null);
    onCreate?.();
    try {
      const { path, erstellt_am } = await generateAndUploadZwischenprotokoll(template, formular);
      const { error: err } = await supabase
        .from('ausgefuellte_formulare')
        .update({ zwischenprotokoll_url: path, zwischenprotokoll_erstellt_am: erstellt_am })
        .eq('id', formular.id);
      if (err) throw err;
      onChanged({ zwischenprotokoll_url: path, zwischenprotokoll_erstellt_am: erstellt_am });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erzeugung fehlgeschlagen');
    } finally {
      setBusy(null);
    }
  }

  async function preview() {
    if (!existing) return;
    setBusy('preview');
    const ok = await previewFormPdf(existing, formular.id);
    setBusy(null);
    if (!ok) setError('Vorschau fehlgeschlagen.');
  }

  async function download() {
    if (!existing) return;
    setBusy('download');
    const ok = await downloadFormPdf(existing, 'zwischenprotokoll.pdf', formular.id);
    setBusy(null);
    if (!ok) setError('Download fehlgeschlagen.');
  }

  async function remove() {
    if (!existing) return;
    if (!confirm('Zwischenprotokoll wirklich löschen?')) return;
    setBusy('delete');
    setError(null);
    try {
      await deleteFormPdf(existing, formular.id);
      const { error: err } = await supabase
        .from('ausgefuellte_formulare')
        .update({ zwischenprotokoll_url: null, zwischenprotokoll_erstellt_am: null })
        .eq('id', formular.id);
      if (err) throw err;
      onChanged({ zwischenprotokoll_url: null, zwischenprotokoll_erstellt_am: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen');
    } finally {
      setBusy(null);
    }
  }

  const erstelltLabel = formular.zwischenprotokoll_erstellt_am
    ? new Date(formular.zwischenprotokoll_erstellt_am).toLocaleString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : null;

  return (
    <div className="flex flex-col items-end gap-1 text-xs">
      {!existing ? (
        <button
          type="button"
          onClick={generate}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-900 hover:bg-amber-200"
          title="PDF mit aktuellem Bearbeitungsstand erzeugen"
        >
          {busy === 'create' ? 'Erzeuge …' : (
            <>
              <FileTextIcon className="h-3.5 w-3.5" />
              Zwischenprotokoll erstellen
            </>
          )}
        </button>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-maja-muted">
            Zwischenprotokoll vom {erstelltLabel ?? '?'}
          </span>
          <span className="inline-flex items-stretch overflow-hidden rounded-full bg-amber-50 text-amber-900">
            <button
              type="button"
              onClick={preview}
              disabled={busy !== null}
              className="flex items-center px-2 py-1 hover:bg-amber-100"
              title="Vorschau"
              aria-label="Vorschau"
            >{busy === 'preview' ? <span>…</span> : <EyeIcon className="h-4 w-4" />}</button>
            <button
              type="button"
              onClick={download}
              disabled={busy !== null}
              className="flex items-center gap-1 border-l border-amber-200 px-2 py-1 hover:bg-amber-100"
            >
              {busy === 'download' ? <span>…</span> : <DownloadIcon className="h-4 w-4" />}
              Download
            </button>
            <button
              type="button"
              onClick={generate}
              disabled={busy !== null}
              className="flex items-center gap-1 border-l border-amber-200 px-2 py-1 hover:bg-amber-100"
              title="Mit aktuellem Stand neu erzeugen"
            >
              {busy === 'create' ? <span>…</span> : <RefreshIcon className="h-4 w-4" />}
              Neu
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy !== null}
              className="flex items-center px-2 py-1 text-red-700 hover:bg-red-50"
              aria-label="Löschen"
            >{busy === 'delete' ? <span>…</span> : <XIcon className="h-4 w-4" />}</button>
          </span>
        </div>
      )}
      {error && <span className="text-red-700">{error}</span>}
    </div>
  );
}

/**
 * Kompakte Anzeige des automatischen E-Mail-Versand-Logs nach Submit
 * (Bestätigung + Schieberegler). Pro Versuch eine Zeile mit Empfänger
 * und Status. Damit der Admin in Eingänge sieht, welche Mails rausgingen.
 */
function EmailSendLog({ log }: { log: EmailSendLogEntry[] | null | undefined }) {
  if (!Array.isArray(log) || log.length === 0) return null;
  return (
    <details className="mt-3 text-xs">
      <summary className="cursor-pointer text-maja-muted hover:text-maja-navy">
        Automatischer E-Mail-Versand ({log.length})
      </summary>
      <ul className="mt-1 space-y-1">
        {log.map((entry, i) => {
          const kind = entry.type === 'confirmation'
            ? 'Bestätigung'
            : `Schieberegler ${typeof entry.slider_index === 'number' ? entry.slider_index + 1 : '?'}`;
          return (
            <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className={entry.success ? 'text-emerald-700' : 'text-red-700'}>
                {entry.success ? 'OK' : 'FEHLER'}
              </span>
              <span className="font-medium text-maja-ink">{kind}</span>
              <span className="text-maja-muted">→ {entry.recipients.join(', ') || '—'}</span>
              {entry.error && (
                <span className="block w-full text-[11px] text-red-700">{entry.error}</span>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
