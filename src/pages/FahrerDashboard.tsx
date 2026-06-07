import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useFahrerContext } from '../auth/FahrerContext';
import { Spinner } from '../components/Spinner';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { summarizeEingang } from '../lib/eingangData';
import { computeTourStatus, formatDate, tourTitel } from '../lib/touren';
import type {
  Auftraggeber, AusgefuelltesFormular, Fahrer, FormularTemplate, Tour,
} from '../types/db';
import type { Json } from '../types/supabase';

type AssignedTemplate = FormularTemplate;

interface DraftRow extends AusgefuelltesFormular {
  template?: Pick<FormularTemplate, 'id' | 'name'> | null;
}

interface TourProtokoll {
  tour: Pick<Tour,
    | 'id' | 'tour_id' | 'start_stadt' | 'ziel_stadt' | 'rueckfuehrung_stadt'
    | 'startdatum' | 'enddatum' | 'fahrer_id'
    | 'schriftliches_protokoll_id' | 'protokoll_art'>;
  template: Pick<FormularTemplate, 'id' | 'name'>;
  auftraggeber: Pick<Auftraggeber, 'name'> | null;
}

export function FahrerDashboard() {
  const { session, profile } = useAuth();
  const { activeFahrer } = useFahrerContext();
  const navigate = useNavigate();
  const [fahrer, setFahrer] = useState<Fahrer | null>(null);
  const [templates, setTemplates] = useState<AssignedTemplate[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [tourProtokolle, setTourProtokolle] = useState<TourProtokoll[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [deletingDraft, setDeletingDraft] = useState<DraftRow | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);

    // Aktiv gewähltes Konto bestimmt die Perspektive — fällt nichts gewählt
    // ist (kein Unterkonto-Modell), fallback auf den Haupt-Eintrag des Users.
    let fahrerRow: Fahrer | null = activeFahrer;
    if (!fahrerRow) {
      const { data, error: fahrerErr } = await supabase
        .from('fahrer')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('ist_unterkonto', false)
        .maybeSingle();
      if (fahrerErr) { setError(fahrerErr.message); setLoading(false); return; }
      fahrerRow = data;
    }
    setFahrer(fahrerRow);

    // Templates: Admin sieht alle (inkl. versteckte mit Badge),
    // Fahrer nur sichtbar=true. Tour-verknüpfte versteckte Templates
    // werden für Fahrer separat als Tour-Protokoll-Karte gerendert.
    const isAdminView = profile?.role === 'admin';
    // Egress: nur die Felder, die die Dashboard-Karten brauchen. Das
    // schema-/pdfs-/email_config-JSONB der Template-Definition kommt
    // erst, wenn das Formular tatsächlich geöffnet wird (FormularPage
    // lädt es separat).
    let tplQuery = supabase
      .from('formular_templates')
      .select('id, name, sichtbar');
    if (!isAdminView) tplQuery = tplQuery.eq('sichtbar', true);
    const tplPromise = tplQuery.order('name');

    // Drafts dieses Fahrers — wir laden bewusst `*`, weil
    //   (a) die Tabelle ausgefuellte_formulare hat KEINE updated_at-
    //       Spalte; eine selektive Liste mit "updated_at" wirft einen
    //       PostgREST-400, draftRes.data wird null und die Drafts
    //       erscheinen für den Fahrer "leer".
    //   (b) das daten-JSONB muss sowieso mitkommen — die Draft-Card
    //       zieht Kennzeichen + Übernahme-/Übergabe-Adresse daraus
    //       via summarizeEingang.
    // FormularPage lädt beim Öffnen ohnehin separat mit `*`.
    const draftPromise = fahrerRow
      ? supabase
          .from('ausgefuellte_formulare')
          .select('*, template:template_id (id, name)')
          .eq('fahrer_id', fahrerRow.id)
          .eq('status', 'draft')
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null } as { data: unknown[]; error: null });

    // Tour-Protokolle: schriftliche Protokolle aus Touren, die diesem Fahrer
    // zugewiesen sind und (computed) den Status geplant/aktiv haben.
    const tourPromise = fahrerRow
      ? supabase
          .from('touren')
          .select(`
            id, tour_id, start_stadt, ziel_stadt, rueckfuehrung_stadt,
            startdatum, enddatum, fahrer_id, protokoll_art,
            schriftliches_protokoll_id, vorgefuellte_daten,
            template:schriftliches_protokoll_id (id, name),
            auftraggeber:auftraggeber_id (name)
          `)
          .eq('fahrer_id', fahrerRow.id)
          .eq('protokoll_art', 'schriftlich')
          .not('schriftliches_protokoll_id', 'is', null)
      : Promise.resolve({ data: [], error: null } as { data: unknown[]; error: null });

    const [tplRes, draftRes, tourRes] = await Promise.all([tplPromise, draftPromise, tourPromise]);
    if (tplRes.error) setError(tplRes.error.message);
    if (draftRes.error) {
      // Vorher still geschluckt: ein PostgREST-400 (z.B. weil eine
      // selektive Spaltenliste eine nicht-existente Spalte fragte)
      // hätte den Fahrer mit leerer Entwurfs-Liste sitzen lassen, ohne
      // dass er den Fehler je gesehen hätte. Jetzt landet er sichtbar.
      console.warn('[FahrerDashboard] Drafts laden fehlgeschlagen', draftRes.error);
      setError((prev) => prev ?? draftRes.error?.message ?? 'Entwürfe konnten nicht geladen werden.');
    }
    setTemplates((Array.isArray(tplRes.data) ? tplRes.data : []) as unknown as AssignedTemplate[]);
    setDrafts((Array.isArray(draftRes.data) ? draftRes.data : []) as unknown as DraftRow[]);

    // Tour-Protokolle clientseitig auf Status filtern.
    type RawTour = {
      id: string; tour_id: string | null;
      start_stadt: string; ziel_stadt: string; rueckfuehrung_stadt: string | null;
      startdatum: string | null; enddatum: string | null;
      fahrer_id: string | null;
      protokoll_art: string | null;
      schriftliches_protokoll_id: string | null;
      vorgefuellte_daten: unknown;
      template: Pick<FormularTemplate, 'id' | 'name'> | null;
      auftraggeber: Pick<Auftraggeber, 'name'> | null;
    };
    const tourList: RawTour[] = (Array.isArray(tourRes.data) ? tourRes.data : []) as unknown as RawTour[];
    const filtered: TourProtokoll[] = [];
    for (const t of tourList) {
      if (!t.template || !t.schriftliches_protokoll_id) continue;
      const s = computeTourStatus(t.startdatum, t.enddatum);
      if (s !== 'geplant' && s !== 'aktiv') continue;
      filtered.push({
        tour: t as unknown as TourProtokoll['tour'],
        template: t.template,
        auftraggeber: t.auftraggeber,
      });
    }
    setTourProtokolle(filtered);

    setLoading(false);
  }, [session, profile?.role, activeFahrer]);

  useEffect(() => { void load(); }, [load]);

  /**
   * Legt für das gewählte Template IMMER eine neue Formular-Instanz an
   * und navigiert dorthin. Bestehende Entwürfe werden NICHT automatisch
   * wieder geöffnet — der Fahrer kann mehrere parallele Drafts desselben
   * Templates haben (z.B. zwei Übernahme-Protokolle am gleichen Tag).
   * Vorhandene Drafts werden weiterhin im "In Bearbeitung"-Bereich
   * separat aufgelistet.
   */
  async function openOrStart(
    templateId: string,
    busyKey: string,
    /** Optionale Tour-Quelle: Vorgaben werden in den Initial-State gemergt,
     *  die Tour-ID landet als `_tour_id` in daten, damit die FormularPage
     *  spätere Admin-Prefill-Updates nachziehen kann. */
    tourPrefill?: { tourId: string; vorgefuellteDaten: Record<string, unknown> | null } | null,
  ) {
    if (!fahrer) return;
    setOpening(busyKey);
    try {
      const prefill = (tourPrefill?.vorgefuellteDaten && typeof tourPrefill.vorgefuellteDaten === 'object')
        ? tourPrefill.vorgefuellteDaten
        : {};
      const initialDaten: Record<string, unknown> = { ...prefill };
      if (tourPrefill?.tourId) initialDaten._tour_id = tourPrefill.tourId;
      const { data, error: err } = await supabase
        .from('ausgefuellte_formulare')
        .insert({
          fahrer_id: fahrer.id,
          template_id: templateId,
          daten: initialDaten as Json,
        })
        .select('id')
        .single();
      if (err || !data) { setError(err?.message ?? 'Anlegen fehlgeschlagen'); return; }
      navigate(`/formular/${data.id}`);
    } finally {
      setOpening(null);
    }
  }

  async function handleDeleteDraft(r: DraftRow) {
    const { error: err } = await supabase
      .from('ausgefuellte_formulare').delete().eq('id', r.id);
    if (err) throw err;
    setDeletingDraft(null);
    void load();
  }

  if (loading) return <Spinner label="Formulare werden geladen …" />;
  if (error)  return <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>;

  if (!fahrer) {
    const isAdmin = profile?.role === 'admin';
    return (
      <div className="card p-6">
        <h2 className="mb-2 text-lg font-semibold text-maja-navy">
          Kein Form-Filler-Profil zugeordnet
        </h2>
        <p className="text-sm text-maja-muted">
          {isAdmin
            ? 'Damit auch Admins Formulare ausfüllen können, brauchst du ein eigenes Profil. Lege es unter „Einstellungen → Fahrer" an und ordne dort dein Admin-Konto zu — anschließend erscheinen hier die verfügbaren Vorlagen.'
            : 'Dein Account ist angemeldet, aber es ist noch kein Profil verknüpft. Bitte wende dich an die Administration.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-maja-navy">Formulare</h1>
        <p className="text-sm text-maja-muted">
          Begonnene Entwürfe, anstehende Tour-Protokolle und verfügbare Vorlagen.
        </p>
      </div>

      {/* Begonnene Formulare */}
      {drafts.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-maja-muted">
            In Bearbeitung
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {drafts.map((d) => (
              <DraftCard
                key={d.id}
                draft={d}
                opening={opening === `draft:${d.id}`}
                onOpen={() => navigate(`/formular/${d.id}`)}
                onDelete={() => setDeletingDraft(d)}
              />
            ))}
          </ul>
        </section>
      )}

      {/* Tour-Protokolle */}
      {tourProtokolle.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-maja-muted">
            Tour-Protokolle
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {tourProtokolle.map((tp) => (
              <TourProtokollCard
                key={tp.tour.id}
                item={tp}
                opening={opening === `tour:${tp.tour.id}`}
                onOpen={() => {
                  const raw = (tp.tour as unknown as { vorgefuellte_daten?: unknown }).vorgefuellte_daten;
                  const prefill = raw && typeof raw === 'object'
                    ? raw as Record<string, unknown>
                    : null;
                  void openOrStart(tp.template.id, `tour:${tp.tour.id}`, {
                    tourId: tp.tour.id,
                    vorgefuellteDaten: prefill,
                  });
                }}
              />
            ))}
          </ul>
        </section>
      )}

      {/* Verfügbare Vorlagen */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-maja-muted">
          Verfügbare Vorlagen
        </h2>
        {templates.length === 0 ? (
          <div className="card p-6 text-sm text-maja-muted">
            Es sind aktuell keine Formular-Vorlagen verfügbar.
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {templates.map((t) => (
              <AssignedCard
                key={t.id}
                template={t}
                opening={opening === `tpl:${t.id}`}
                onStart={() => void openOrStart(t.id, `tpl:${t.id}`)}
              />
            ))}
          </ul>
        )}
      </section>

      {deletingDraft && (
        <ConfirmDialog
          title="Entwurf löschen?"
          message={
            <>
              Möchten Sie diesen Entwurf wirklich löschen? Alle eingegebenen
              Daten gehen verloren.
              {deletingDraft.template?.name && (
                <div className="mt-2 text-xs text-maja-muted">
                  Template: {deletingDraft.template.name}
                </div>
              )}
            </>
          }
          confirmLabel="Löschen"
          destructive
          onConfirm={() => handleDeleteDraft(deletingDraft)}
          onClose={() => setDeletingDraft(null)}
        />
      )}
    </div>
  );
}

// ---------- Cards ----------

function DraftCard({
  draft, opening, onOpen, onDelete,
}: {
  draft: DraftRow;
  opening: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const summary = useMemo(() => summarizeEingang(draft), [draft]);
  return (
    <li className="card flex flex-col p-5">
      <div className="flex items-start justify-between gap-2">
        <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800">
          In Bearbeitung
        </span>
        <span className="text-xs text-maja-muted">
          {formatDate(draft.created_at)}
        </span>
      </div>
      <h3 className="mt-2 text-base font-semibold text-maja-navy">
        {draft.template?.name ?? 'Formular'}
      </h3>
      {(summary.kennzeichen || summary.adresseUebernahme || summary.adresseUebergabe) && (
        <div className="mt-1 text-xs text-maja-muted space-y-0.5">
          {summary.kennzeichen && <div>Kennzeichen: {summary.kennzeichen}</div>}
          {summary.adresseUebernahme && <div>Übernahme: {summary.adresseUebernahme}</div>}
          {summary.adresseUebergabe && <div>Übergabe: {summary.adresseUebergabe}</div>}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button onClick={onOpen} disabled={opening} className="btn-primary flex-1">
          {opening ? 'Öffne …' : 'Fortsetzen'}
        </button>
        <button onClick={onDelete} className="text-sm font-medium text-red-600 hover:underline">
          Löschen
        </button>
      </div>
    </li>
  );
}

function TourProtokollCard({
  item, opening, onOpen,
}: { item: TourProtokoll; opening: boolean; onOpen: () => void }) {
  const titel = tourTitel({
    start_stadt: item.tour.start_stadt,
    ziel_stadt: item.tour.ziel_stadt,
    rueckfuehrung_stadt: item.tour.rueckfuehrung_stadt,
  });
  const dateRange = item.tour.startdatum || item.tour.enddatum
    ? `${formatDate(item.tour.startdatum)} – ${formatDate(item.tour.enddatum)}`
    : null;
  return (
    <li className="card flex flex-col p-5">
      <div className="flex items-start justify-between gap-2">
        <span className="inline-block rounded-full bg-maja-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-maja-accent">
          Tour-Protokoll
        </span>
        {item.tour.tour_id && (
          <span className="text-xs font-semibold text-maja-muted">{item.tour.tour_id}</span>
        )}
      </div>
      <h3 className="mt-2 text-base font-semibold text-maja-navy">
        {item.template.name}
      </h3>
      <div className="mt-1 text-xs text-maja-ink space-y-0.5">
        <div className="font-medium">{titel}</div>
        {item.auftraggeber && <div className="text-maja-muted">{item.auftraggeber.name}</div>}
        {dateRange && <div className="text-maja-muted">{dateRange}</div>}
      </div>
      <div className="mt-4">
        <button onClick={onOpen} disabled={opening} className="btn-primary w-full">
          {opening ? 'Öffne …' : 'Protokoll öffnen'}
        </button>
      </div>
    </li>
  );
}

function AssignedCard({
  template, opening, onStart,
}: { template: AssignedTemplate; opening: boolean; onStart: () => void }) {
  return (
    <li className={`card flex flex-col p-5 transition hover:shadow-lg ${template.sichtbar ? '' : 'opacity-60'}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold text-maja-navy">{template.name}</h3>
        {!template.sichtbar && (
          <span className="inline-block rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-700">
            Versteckt
          </span>
        )}
      </div>
      <div className="mt-1 text-xs text-maja-muted">
        {(template.schema?.sections ?? []).length} Sektionen
      </div>
      <div className="mt-4">
        <button onClick={onStart} disabled={opening} className="btn-primary w-full">
          {opening ? 'Wird angelegt …' : 'Protokoll starten'}
        </button>
      </div>
    </li>
  );
}
