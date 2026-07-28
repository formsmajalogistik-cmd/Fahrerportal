import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Spinner } from '../../components/Spinner';
import { computeTourStatus, formatDate, tourTitel } from '../../lib/touren';
import { asPdfPathList, downloadFormPdf, previewFormPdf } from '../../lib/pdfGenerate';
import { DownloadIcon, EyeIcon } from '../../components/icons';
import { AuftraggeberTourCreateDialog } from './AuftraggeberTourCreateDialog';
import { useTestMode } from '../../auth/TestModeContext';
import { useAuth } from '../../auth/AuthContext';
import type { KontaktVorOrt, TourKundensicht, TourStatus } from '../../types/db';

/**
 * Tourenliste für Auftraggeber-Profile.
 *
 * SICHERHEIT: Die Daten kommen ausschließlich aus der View
 * `touren_kundensicht` (security_invoker, Migration 056/057) — sie
 * enthält keine Preis-/Vergütungs- und keine Fahrer-Spalten. Die
 * Zeilen-Einschränkung (nur eigener Auftraggeber; bestätigte plus
 * selbst erstellte unbestätigte Touren) erzwingt die RLS-Policy
 * `touren_auftraggeber_read` auf der touren-Tabelle. Es gibt hier
 * bewusst keine KPI-Summen, keinen Fahrer-Filter und keinen Zugriff
 * auf das Admin-Tour-Detail.
 */

interface EingangLite {
  id: string;
  status: 'draft' | 'submitted';
  pdf_paths: unknown;
  template: { name: string } | null;
}

const STATUS_LABEL: Record<TourStatus, string> = {
  geplant: 'Geplant',
  aktiv: 'Aktiv',
  abgeschlossen: 'Abgeschlossen',
};

const STATUS_BADGE: Record<TourStatus, string> = {
  geplant:       'bg-blue-100 text-blue-700',
  aktiv:         'bg-emerald-100 text-emerald-700',
  abgeschlossen: 'bg-gray-100 text-gray-600',
};

type StatusFilter = 'alle' | TourStatus | 'pruefung';

export function AuftraggeberTourenPage() {
  // Test-User wählen den simulierten Auftraggeber im Banner. Für echte
  // Auftraggeber-Profile bleibt die View die einzige Datenquelle
  // (RLS liefert NUR den eigenen AG).
  const { isTestUser, effectiveAuftraggeberId } = useTestMode();
  const [rows, setRows] = useState<TourKundensicht[]>([]);
  const [eingaenge, setEingaenge] = useState<Map<string, EingangLite>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('alle');
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notizTourIds, setNotizTourIds] = useState<Set<string>>(new Set());

  /** "Verstanden": quittiert eine Ablehnung — die Tour verschwindet aus
   *  der Auftraggeber-Liste (bleibt in der DB und für Admins sichtbar).
   *  Läuft über eine SECURITY-DEFINER-RPC, weil Auftraggeber-Profile
   *  kein UPDATE-Recht auf touren haben (H-1). */
  const [ackBusy, setAckBusy] = useState<string | null>(null);
  async function handleAblehnungVerstanden(tourId: string) {
    setAckBusy(tourId);
    const { error: err } = await supabase.rpc('ag_ablehnung_bestaetigen', { p_tour_id: tourId });
    setAckBusy(null);
    if (err) { setError(err.message); return; }
    // Optimistisch aus der Liste nehmen; load() bestätigt es serverseitig.
    setRows((prev) => prev.filter((t) => t.id !== tourId));
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Test-User: direkt die touren-Tabelle abfragen, gefiltert auf den
    // im Banner gewählten Auftraggeber — die Auftraggeber-View liefert
    // ihnen sonst keine Zeilen (current_auftraggeber_id() ist NULL).
    // Wir holen exakt die Spalten, die die View auch hätte, damit die
    // UI-Komponenten unverändert weiterarbeiten.
    let data: TourKundensicht[] | null = null;
    let err: { message: string } | null = null;
    if (isTestUser) {
      if (!effectiveAuftraggeberId) {
        setRows([]);
        setEingaenge(new Map());
        setLoading(false);
        return;
      }
      const res = await supabase
        .from('touren')
        .select(`
          id, tour_id, start_stadt, ziel_stadt, rueckfuehrung_stadt,
          kundenname, auftraggeber_id, startdatum, enddatum, tourenart,
          kennzeichen, ist_e_fahrzeug, fin,
          adresse_start, adresse_ziel, adresse_rueckfuehrung,
          kontakt_start, kontakt_ziel, kontakt_rueckfuehrung,
          protokoll_art, info, bestaetigt, erstellt_von, created_at,
          abgelehnt, ablehnungsgrund, abgelehnt_am, ablehnung_bestaetigt_am,
          eingang_id, eingang_id_bc
        `)
        .eq('auftraggeber_id', effectiveAuftraggeberId)
        .order('startdatum', { ascending: false })
        .order('created_at', { ascending: false });
      data = (res.data as unknown as TourKundensicht[]) ?? null;
      err = res.error;
    } else {
      const res = await supabase
        .from('touren_kundensicht')
        .select('*')
        .order('startdatum', { ascending: false })
        .order('created_at', { ascending: false });
      data = (res.data as unknown as TourKundensicht[]) ?? null;
      err = res.error;
    }
    if (err) {
      setError(err.message);
      setRows([]);
      setLoading(false);
      return;
    }
    const list = data ?? [];
    setRows(list);

    // Verknüpfte eingereichte Protokolle nachladen (PDF-Downloads).
    // RLS auf ausgefuellte_formulare lässt nur Formulare eigener
    // Auftraggeber-Touren durch.
    const eingangIds = Array.from(new Set(
      list.flatMap((t) => [t.eingang_id, t.eingang_id_bc]).filter((x): x is string => !!x),
    ));
    if (eingangIds.length > 0) {
      const { data: efs } = await supabase
        .from('ausgefuellte_formulare')
        .select('id, status, pdf_paths, template:template_id (name)')
        .in('id', eingangIds)
        .eq('status', 'submitted');
      const m = new Map<string, EingangLite>();
      for (const e of (efs as unknown as EingangLite[]) ?? []) m.set(e.id, e);
      setEingaenge(m);
    } else {
      setEingaenge(new Map());
    }
    // Tour-IDs mit interner Notiz — für den Indikator in der Liste.
    // RLS liefert ausschließlich Notizen des eigenen Auftraggebers.
    try {
      const { data: notizen } = await supabase
        .from('tour_notizen_auftraggeber')
        .select('tour_id');
      const ids = new Set(((notizen ?? []) as Array<{ tour_id: string }>).map((n) => n.tour_id));
      setNotizTourIds(ids);
    } catch { /* Indikator ist optional */ }

    setLoading(false);
  }, [isTestUser, effectiveAuftraggeberId]);

  useEffect(() => {
    // Deferred, damit setLoading nicht synchron im Effect läuft
    // (react-hooks/set-state-in-effect).
    const t = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((t) => {
      if (statusFilter === 'pruefung') {
        if (t.bestaetigt) return false;
      } else if (statusFilter !== 'alle') {
        if (!t.bestaetigt) return false;
        if (computeTourStatus(t.startdatum, t.enddatum) !== statusFilter) return false;
      }
      if (!q) return true;
      const haystack = [
        t.tour_id ?? '', t.start_stadt, t.ziel_stadt, t.rueckfuehrung_stadt ?? '',
        t.kundenname ?? '', t.fin ?? '',
        ...(Array.isArray(t.kennzeichen) ? t.kennzeichen : []),
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, search, statusFilter]);

  if (loading) return <Spinner label="Touren werden geladen …" />;
  if (error) {
    return <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-maja-navy">Tourenliste</h1>
          <p className="text-sm text-maja-muted">
            Ihre Touren bei Maja-Logistik. Neue Touren werden nach Prüfung
            durch das Team bestätigt.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={() => void load()}>
            Aktualisieren
          </button>
          <button type="button" className="btn-primary" onClick={() => setShowCreate(true)}>
            + Neue Tour
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          className="input flex-1 min-w-[16rem]"
          placeholder="Tour-ID, Stadt, Kennzeichen, FIN ..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex flex-wrap gap-1">
          {(['alle', 'aktiv', 'geplant', 'abgeschlossen', 'pruefung'] as const).map((s) => {
            const active = statusFilter === s;
            const label = s === 'alle' ? 'Alle' : s === 'pruefung' ? 'In Prüfung' : STATUS_LABEL[s];
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

      {filtered.length === 0 ? (
        <div className="card p-8 text-center text-sm text-maja-muted">
          Keine Touren gefunden.
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((t) => (
            <KundenTourCard
              key={t.id}
              tour={t}
              eingaenge={eingaenge}
              expanded={expandedId === t.id}
              onToggle={() => setExpandedId((cur) => (cur === t.id ? null : t.id))}
              hatNotiz={notizTourIds.has(t.id)}
              ackBusy={ackBusy === t.id}
              onAblehnungVerstanden={() => void handleAblehnungVerstanden(t.id)}
            />
          ))}
        </ul>
      )}

      {showCreate && (
        <AuftraggeberTourCreateDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); void load(); }}
        />
      )}
    </div>
  );
}

function asKontakt(v: unknown): KontaktVorOrt | null {
  if (v && typeof v === 'object') return v as KontaktVorOrt;
  return null;
}

function KontaktZeile({ label, kontakt }: { label: string; kontakt: KontaktVorOrt | null }) {
  if (!kontakt || (!kontakt.name && !kontakt.telefon && !kontakt.email)) return null;
  return (
    <div>
      <span className="text-xs font-medium uppercase tracking-wide text-maja-muted">{label}</span>
      <div className="text-sm text-maja-ink">
        {kontakt.name}
        {kontakt.telefon && <span className="ml-2 text-maja-muted">{kontakt.telefon}</span>}
        {kontakt.email && <span className="ml-2 text-maja-muted">{kontakt.email}</span>}
      </div>
    </div>
  );
}

function KundenTourCard({
  tour, eingaenge, expanded, onToggle, ackBusy, onAblehnungVerstanden, hatNotiz,
}: {
  tour: TourKundensicht;
  eingaenge: Map<string, EingangLite>;
  expanded: boolean;
  onToggle: () => void;
  hatNotiz?: boolean;
  ackBusy?: boolean;
  onAblehnungVerstanden?: () => void;
}) {
  const computedStatus = computeTourStatus(tour.startdatum, tour.enddatum);
  const abgelehnt = !!tour.abgelehnt;
  const inPruefung = !tour.bestaetigt && !abgelehnt;
  const dateRange = tour.startdatum && tour.enddatum && tour.startdatum !== tour.enddatum
    ? `${formatDate(tour.startdatum)} – ${formatDate(tour.enddatum)}`
    : formatDate(tour.startdatum ?? tour.enddatum);
  const linkedEingaenge = [tour.eingang_id, tour.eingang_id_bc]
    .filter((x): x is string => !!x)
    .map((id) => eingaenge.get(id))
    .filter((e): e is EingangLite => !!e);

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className={`card w-full p-5 text-left transition hover:shadow-lg ${
          abgelehnt ? 'ring-1 ring-red-300' : inPruefung ? 'ring-1 ring-amber-400' : ''
        }`}
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
              {hatNotiz && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-maja-navy/10 px-2 py-0.5 text-[10px] font-semibold text-maja-navy"
                  title="Interne Notiz vorhanden — nur für Ihr Unternehmen sichtbar"
                >
                  ✎ Notiz
                </span>
              )}
            </div>
            <div className="mt-2 grid gap-1.5 text-sm text-maja-ink sm:grid-cols-2">
              <div>{dateRange}</div>
              {tour.tourenart && <div>Tourenart: {tour.tourenart}</div>}
              {(tour.kennzeichen ?? []).length > 0 && (
                <div>
                  {(tour.kennzeichen ?? []).join(', ')}
                  {tour.fin && <span className="ml-1 text-xs text-maja-muted">· FIN: {tour.fin}</span>}
                </div>
              )}
              {(tour.kennzeichen ?? []).length === 0 && tour.fin && (
                <div>FIN: {tour.fin}</div>
              )}
              {tour.kundenname && <div>{tour.kundenname}</div>}
            </div>

            {abgelehnt && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                <span className="font-semibold">Diese Tour wurde abgelehnt.</span>
                {tour.ablehnungsgrund && (
                  <span className="block mt-0.5">Grund: {tour.ablehnungsgrund}</span>
                )}
                {tour.abgelehnt_am && (
                  <span className="block mt-0.5 text-xs text-red-700">
                    am {formatDate(tour.abgelehnt_am)}
                  </span>
                )}
                {onAblehnungVerstanden && (
                  <button
                    type="button"
                    className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                    disabled={ackBusy}
                    onClick={(e) => { e.stopPropagation(); onAblehnungVerstanden(); }}
                    title="Hinweis zur Kenntnis nehmen — die Tour wird hier ausgeblendet"
                  >
                    {ackBusy ? 'Wird ausgeblendet …' : 'Verstanden — ausblenden'}
                  </button>
                )}
              </div>
            )}

            {linkedEingaenge.length > 0 && (
              <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                {linkedEingaenge.map((e) => (
                  <EingangPdfButtons key={e.id} eingang={e} />
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            {abgelehnt ? (
              <span
                className="inline-block rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700"
                title={tour.ablehnungsgrund ?? undefined}
              >
                Abgelehnt
              </span>
            ) : inPruefung ? (
              <span className="inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                In Prüfung
              </span>
            ) : (
              <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${STATUS_BADGE[computedStatus]}`}>
                {STATUS_LABEL[computedStatus]}
              </span>
            )}
            {tour.ist_e_fahrzeug && (
              <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                E-Fahrzeug
              </span>
            )}
          </div>
        </div>

        {expanded && (
          <div className="mt-4 grid gap-3 border-t border-maja-navy/10 pt-4 sm:grid-cols-2">
            <div className="space-y-2">
              {tour.adresse_start && (
                <div>
                  <span className="text-xs font-medium uppercase tracking-wide text-maja-muted">Adresse Start</span>
                  <div className="text-sm text-maja-ink">{tour.adresse_start}</div>
                </div>
              )}
              {tour.adresse_ziel && (
                <div>
                  <span className="text-xs font-medium uppercase tracking-wide text-maja-muted">Adresse Ziel</span>
                  <div className="text-sm text-maja-ink">{tour.adresse_ziel}</div>
                </div>
              )}
              {tour.adresse_rueckfuehrung && (
                <div>
                  <span className="text-xs font-medium uppercase tracking-wide text-maja-muted">Adresse Rückführung</span>
                  <div className="text-sm text-maja-ink">{tour.adresse_rueckfuehrung}</div>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <KontaktZeile label="Kontakt Start" kontakt={asKontakt(tour.kontakt_start)} />
              <KontaktZeile label="Kontakt Ziel" kontakt={asKontakt(tour.kontakt_ziel)} />
              <KontaktZeile label="Kontakt Rückführung" kontakt={asKontakt(tour.kontakt_rueckfuehrung)} />
              {tour.info && (
                <div>
                  <span className="text-xs font-medium uppercase tracking-wide text-maja-muted">Info</span>
                  <div className="text-sm text-maja-ink whitespace-pre-wrap">{tour.info}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </button>
      {/* Interne Notiz — nur in der Auftraggeber-Ansicht. Admin-, Fahrer-
          und Test-Konten laden diesen Bereich gar nicht erst (die Seite
          existiert für sie nicht) und hätten per RLS ohnehin keinen
          Zugriff auf die Tabelle. */}
      {expanded && <InterneNotiz tourId={tour.id} auftraggeberId={tour.auftraggeber_id} />}
    </li>
  );
}

/**
 * Interne Notiz des Auftraggebers zu einer Tour. Liegt in der separaten
 * Tabelle tour_notizen_auftraggeber, die per RLS ausschließlich Konten
 * desselben Auftraggebers lesen/schreiben dürfen (Migration 075).
 */
function InterneNotiz({
  tourId, auftraggeberId,
}: { tourId: string; auftraggeberId: string | null }) {
  const { profile } = useAuth();
  const [notiz, setNotiz] = useState('');
  const [geladen, setGeladen] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('tour_notizen_auftraggeber')
        .select('notiz')
        .eq('tour_id', tourId)
        .maybeSingle();
      if (cancelled) return;
      if (error) console.warn('[InterneNotiz] Laden fehlgeschlagen', error.message);
      const val = data?.notiz ?? '';
      setNotiz(val);
      setGeladen(val);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tourId]);

  async function speichern() {
    if (!auftraggeberId) return;
    setSaving(true); setErr(null); setMsg(null);
    // Upsert auf dem Unique-Key tour_id — eine Notiz pro Tour.
    const { error } = await supabase
      .from('tour_notizen_auftraggeber')
      .upsert({
        tour_id: tourId,
        auftraggeber_id: auftraggeberId,
        notiz: notiz.trim() || null,
        erstellt_von: profile?.id ?? null,
      }, { onConflict: 'tour_id' });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setGeladen(notiz);
    setMsg('Notiz gespeichert.');
    window.setTimeout(() => setMsg((m) => (m === 'Notiz gespeichert.' ? null : m)), 3000);
  }

  if (loading) return null;
  return (
    <div
      className="mt-2 rounded-xl border border-maja-navy/15 bg-maja-light/40 p-4"
      onClick={(e) => e.stopPropagation()}
    >
      <label htmlFor={`notiz-${tourId}`} className="label">Interne Notiz</label>
      <textarea
        id={`notiz-${tourId}`}
        className="input min-h-[4.5rem]"
        value={notiz}
        onChange={(e) => setNotiz(e.target.value)}
        placeholder="z.B. Ansprechpartner, interne Referenz, Besonderheiten …"
      />
      <p className="mt-1 text-xs text-maja-muted">
        Nur für Mitarbeiter Ihres Unternehmens sichtbar.
      </p>
      {err && <p role="alert" className="mt-1 text-xs text-red-600">{err}</p>}
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          className="btn-primary px-3 py-1.5 text-sm"
          disabled={saving || notiz === geladen}
          onClick={() => void speichern()}
        >
          {saving ? 'Speichert …' : 'Notiz speichern'}
        </button>
        {msg && <span className="text-xs text-emerald-700">{msg}</span>}
      </div>
    </div>
  );
}

function EingangPdfButtons({ eingang }: { eingang: EingangLite }) {
  const persisted = asPdfPathList(eingang.pdf_paths);
  if (persisted.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-maja-muted">Protokoll-PDFs:</span>
      {persisted.map((p) => (
        <KundenPdfButton
          key={p.pdf_id}
          label={p.pdf_name}
          filename={p.filename}
          path={p.onedrive_path}
          formularId={eingang.id}
        />
      ))}
    </div>
  );
}

function KundenPdfButton({
  label, filename, path, formularId,
}: { label: string; filename: string; path: string; formularId: string }) {
  const [busy, setBusy] = useState<'download' | 'preview' | null>(null);
  async function download() {
    setBusy('download');
    const ok = await downloadFormPdf(path, filename, formularId);
    setBusy(null);
    if (!ok) alert('PDF nicht erreichbar.');
  }
  async function preview() {
    setBusy('preview');
    const ok = await previewFormPdf(path, formularId);
    setBusy(null);
    if (!ok) alert('Vorschau fehlgeschlagen.');
  }
  return (
    <span className="inline-flex items-stretch overflow-hidden rounded-full border border-slate-300 bg-maja-light text-xs text-maja-navy">
      <button
        type="button"
        onClick={() => void preview()}
        disabled={busy !== null}
        className="flex items-center px-2 py-1 hover:bg-maja-accent/20"
        aria-label="Vorschau"
      >{busy === 'preview' ? <span>…</span> : <EyeIcon className="h-4 w-4" />}</button>
      <button
        type="button"
        onClick={() => void download()}
        disabled={busy !== null}
        className="flex items-center gap-1 border-l border-slate-300 px-2 py-1 hover:bg-maja-accent/20"
      >
        {busy === 'download' ? <span>…</span> : <DownloadIcon className="h-4 w-4" />}
        {label}
      </button>
    </span>
  );
}
