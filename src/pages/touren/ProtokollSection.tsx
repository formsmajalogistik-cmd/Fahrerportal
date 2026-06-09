import { useCallback, useEffect, useMemo, useState } from 'react';
import { filterAvailableZugaenge } from '../../lib/greimel';
import { supabase } from '../../lib/supabase';
import { XIcon } from '../../components/icons';
import { collectPrefillableFields, PrefillDialog } from './PrefillDialog';
import type {
  FormSchema, FormularTemplate, GreimelZugang, ProtokollArt,
} from '../../types/db';
import type { Json } from '../../types/supabase';

/** Eine konkrete Protokoll-Zuweisung auf einer Tour. */
export interface TourProtokollZuweisung {
  id: string;
  template_id: string;
  template_name: string;
  template_schema: FormSchema | null;
  vorgefuellte_daten: Record<string, unknown> | null;
  sort_order: number;
}

interface Props {
  /** ID der Tour — wird gebraucht, um Zuweisungen zu persistieren. */
  tourId: string | null;
  protokollArt: ProtokollArt | null;
  greimelZugangId: string | null;
  /** Freitext-Notiz, die bei Protokoll-Art "App" angezeigt wird. */
  appNotiz: string;
  onChange: (patch: {
    protokoll_art?: ProtokollArt | null;
    greimel_zugang_id?: string | null;
    app_notiz?: string;
  }) => void;
  /** Auftraggeber dieser Tour ist ein Greimel-Konto (case-insensitive Name-Match). */
  isGreimel: boolean;
  /** Aktuell gewählter Fahrer der Tour — bestimmt welche Greimel-Zugänge verfügbar sind. */
  fahrerId: string | null;
  templates: Array<Pick<FormularTemplate, 'id' | 'name'>>;
  zugaenge: GreimelZugang[];
  /** Optionale externe Protokoll-App des Auftraggebers — wenn gesetzt,
   *  erscheint bei Protokollart "App" ein Button, der die URL öffnet. */
  externeApp?: { name: string | null; url: string | null } | null;
}

/**
 * Liest alle Protokoll-Zuweisungen einer Tour samt Template-Name und
 * Schema. Wird auch von der ViewMode-Anzeige im TourDetailDialog
 * benutzt.
 */
// eslint-disable-next-line react-refresh/only-export-components
export async function loadTourProtokollZuweisungen(tourId: string): Promise<TourProtokollZuweisung[]> {
  const { data, error } = await supabase
    .from('tour_protokoll_zuweisungen')
    .select('id, template_id, vorgefuellte_daten, sort_order, template:template_id (id, name, schema)')
    .eq('tour_id', tourId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    console.warn('[loadTourProtokollZuweisungen]', error.message);
    return [];
  }
  type Row = {
    id: string;
    template_id: string;
    vorgefuellte_daten: Record<string, unknown> | null;
    sort_order: number;
    template: { id: string; name: string; schema: unknown } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    template_id: r.template_id,
    template_name: r.template?.name ?? '(unbekannt)',
    template_schema: r.template?.schema && typeof r.template.schema === 'object'
      && Array.isArray((r.template.schema as { sections?: unknown }).sections)
      ? r.template.schema as FormSchema
      : null,
    vorgefuellte_daten: r.vorgefuellte_daten,
    sort_order: r.sort_order,
  }));
}

export function ProtokollSection({
  tourId, protokollArt, greimelZugangId, appNotiz,
  onChange, isGreimel, fahrerId, templates, zugaenge, externeApp,
}: Props) {
  const externeAppUrl = externeApp?.url?.trim() || null;
  const externeAppName = externeApp?.name?.trim() || 'externe App';
  const availableZugaenge = useMemo(
    () => filterAvailableZugaenge(zugaenge, fahrerId, greimelZugangId),
    [zugaenge, fahrerId, greimelZugangId],
  );

  const linkedZugang = useMemo(
    () => zugaenge.find((z) => z.id === greimelZugangId) ?? null,
    [zugaenge, greimelZugangId],
  );

  // Zuweisungen aus der neuen Verknüpfungstabelle.
  const [assignments, setAssignments] = useState<TourProtokollZuweisung[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [addPick, setAddPick] = useState<string>('');
  const [busy, setBusy] = useState(false);
  // Nach dem Hinzufügen eines Templates mit Prefill-Feldern öffnet sich
  // der Dialog automatisch — wir merken uns die zuletzt geöffnete
  // assignment.id, damit das nur einmal pro Insert passiert.
  const [autoOpenedFor, setAutoOpenedFor] = useState<string | null>(null);
  const [prefillEditing, setPrefillEditing] = useState<TourProtokollZuweisung | null>(null);

  const reload = useCallback(async () => {
    if (!tourId) { setAssignments([]); return; }
    setAssignmentsLoading(true);
    try {
      const list = await loadTourProtokollZuweisungen(tourId);
      setAssignments(list);
    } finally {
      setAssignmentsLoading(false);
    }
  }, [tourId]);

  useEffect(() => {
    void Promise.resolve().then(() => { void reload(); });
  }, [reload]);

  /** Bereits zugewiesene template_ids — die filtern wir aus der
   *  Auswahl-Liste raus, damit dasselbe Template nicht doppelt landet. */
  const assignedTemplateIds = useMemo(
    () => new Set(assignments.map((a) => a.template_id)),
    [assignments],
  );
  const selectableTemplates = useMemo(
    () => (templates ?? []).filter((t) => !assignedTemplateIds.has(t.id)),
    [templates, assignedTemplateIds],
  );

  async function handleAdd() {
    if (!tourId || !addPick) return;
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from('tour_protokoll_zuweisungen')
        .insert({
          tour_id: tourId,
          template_id: addPick,
          sort_order: assignments.length,
        })
        .select('id')
        .single();
      if (error) throw error;
      setAddPick('');
      await reload();
      // Wenn das Template vorausfüllbare Felder hat, direkt den
      // Prefill-Dialog für genau diese neue Zuweisung öffnen.
      const tpl = templates.find((t) => t.id === addPick);
      if (tpl && data?.id) {
        const fresh = await loadTourProtokollZuweisungen(tourId);
        const created = fresh.find((a) => a.id === data.id) ?? null;
        if (created && created.template_schema
            && collectPrefillableFields(created.template_schema).length > 0
            && autoOpenedFor !== created.id) {
          setPrefillEditing(created);
          setAutoOpenedFor(created.id);
        }
      }
    } catch (err) {
      console.warn('[ProtokollSection.add]', err);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(assignmentId: string) {
    setBusy(true);
    try {
      const { error } = await supabase
        .from('tour_protokoll_zuweisungen')
        .delete()
        .eq('id', assignmentId);
      if (error) throw error;
      await reload();
    } catch (err) {
      console.warn('[ProtokollSection.remove]', err);
    } finally {
      setBusy(false);
    }
  }

  async function handlePrefillSaved(assignmentId: string, next: Record<string, unknown> | null) {
    setBusy(true);
    try {
      const { error } = await supabase
        .from('tour_protokoll_zuweisungen')
        .update({ vorgefuellte_daten: (next ?? null) as Json | null })
        .eq('id', assignmentId);
      if (error) throw error;
      await reload();
    } catch (err) {
      console.warn('[ProtokollSection.prefill]', err);
    } finally {
      setBusy(false);
      setPrefillEditing(null);
    }
  }

  function selectArt(art: ProtokollArt) {
    onChange({ protokoll_art: art });
  }

  return (
    <div className="space-y-3 rounded-lg border border-maja-navy/10 p-4">
      <h3 className="text-sm font-semibold text-maja-navy">Protokoll</h3>

      {/* Segmented Auswahl */}
      <div className="inline-flex rounded-lg border border-maja-navy/15 bg-white p-0.5">
        {(['app', 'schriftlich'] as ProtokollArt[]).map((art) => {
          const active = protokollArt === art;
          return (
            <button
              key={art}
              type="button"
              onClick={() => selectArt(art)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                active ? 'bg-maja-navy text-white' : 'text-maja-navy hover:bg-maja-light'
              }`}
            >
              {art === 'app' ? 'App' : 'Schriftlich'}
            </button>
          );
        })}
      </div>

      {/* App-Bereich */}
      {protokollArt === 'app' && (
        <div className="space-y-3">
          {externeAppUrl && (
            <a
              href={externeAppUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-maja-accent px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-maja-navy"
            >
              {externeAppName} öffnen
              <span aria-hidden="true">↗</span>
            </a>
          )}
          <div>
            <label className="label" htmlFor="t-app-notiz">Notiz</label>
            <textarea
              id="t-app-notiz"
              className="input min-h-[3.5rem]"
              placeholder="Freitext zur App-Protokollierung (optional)"
              value={appNotiz}
              onChange={(e) => onChange({ app_notiz: e.target.value })}
            />
          </div>

          {isGreimel && (
            <div className="space-y-2 rounded-md bg-maja-light/50 p-3">
              <div className="text-sm font-semibold text-maja-navy">Greimel Zugang zuweisen</div>
              {linkedZugang ? (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex-1 text-sm">
                    <div className="font-medium text-maja-ink">{linkedZugang.titel}</div>
                    <div className="text-xs text-maja-muted">{linkedZugang.benutzername}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onChange({ greimel_zugang_id: null })}
                    aria-label="Zugang entfernen"
                    title="Zugang entfernen"
                    className="rounded-md px-2 py-1 text-red-600 hover:bg-red-50"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                  <select
                    className="input flex-1 min-w-[10rem]"
                    value={greimelZugangId ?? ''}
                    onChange={(e) => onChange({ greimel_zugang_id: e.target.value || null })}
                  >
                    <option value="">— Zugang ändern —</option>
                    {availableZugaenge.map((z) => (
                      <option key={z.id} value={z.id}>{z.titel}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <select
                  className="input"
                  value={greimelZugangId ?? ''}
                  onChange={(e) => onChange({ greimel_zugang_id: e.target.value || null })}
                >
                  <option value="">— Zugang auswählen —</option>
                  {availableZugaenge.map((z) => (
                    <option key={z.id} value={z.id}>{z.titel} · {z.benutzername}</option>
                  ))}
                </select>
              )}
              {availableZugaenge.length === 0 && (
                <p className="text-xs text-maja-muted">
                  Keine Greimel-Zugänge verfügbar (ggf. alle bereits anderen Fahrern zugewiesen).
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Schriftlich-Bereich — eine Liste statt einem Dropdown. */}
      {protokollArt === 'schriftlich' && (
        <div className="space-y-3 rounded-md bg-maja-light/50 p-3">
          <div className="text-sm font-semibold text-maja-navy">Protokolle</div>

          {tourId == null ? (
            <p className="text-xs text-maja-muted">
              Bitte zuerst die Tour speichern — Protokolle werden anschließend zuweisbar.
            </p>
          ) : assignmentsLoading ? (
            <p className="text-xs text-maja-muted">Lade …</p>
          ) : assignments.length === 0 ? (
            <p className="text-xs text-maja-muted">Noch kein Protokoll verknüpft.</p>
          ) : (
            <ul className="space-y-1">
              {assignments.map((a) => (
                <AssignmentRow
                  key={a.id}
                  assignment={a}
                  busy={busy}
                  onRemove={() => handleRemove(a.id)}
                  onEditPrefill={() => setPrefillEditing(a)}
                />
              ))}
            </ul>
          )}

          {tourId != null && (
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="input flex-1 min-w-[12rem]"
                value={addPick}
                onChange={(e) => setAddPick(e.target.value)}
                disabled={busy || selectableTemplates.length === 0}
              >
                <option value="">
                  {selectableTemplates.length === 0
                    ? '— Alle Templates bereits zugewiesen —'
                    : '— Template wählen —'}
                </option>
                {selectableTemplates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <button
                type="button"
                className="btn-secondary text-sm"
                disabled={busy || !addPick}
                onClick={() => void handleAdd()}
              >
                + Protokoll zuweisen
              </button>
            </div>
          )}
        </div>
      )}

      {prefillEditing && tourId && (
        <PrefillDialog
          tourId={tourId}
          assignmentId={prefillEditing.id}
          template={{
            id: prefillEditing.template_id,
            name: prefillEditing.template_name,
            schema: prefillEditing.template_schema ?? { sections: [] },
          }}
          initial={prefillEditing.vorgefuellte_daten ?? {}}
          onClose={() => setPrefillEditing(null)}
          onSaved={(next) => void handlePrefillSaved(prefillEditing.id, Object.keys(next).length === 0 ? null : next)}
        />
      )}
    </div>
  );
}

function AssignmentRow({
  assignment, busy, onRemove, onEditPrefill,
}: {
  assignment: TourProtokollZuweisung;
  busy: boolean;
  onRemove: () => void;
  onEditPrefill: () => void;
}) {
  const prefillCount = assignment.vorgefuellte_daten
    ? Object.keys(assignment.vorgefuellte_daten).length
    : 0;
  const hasPrefillable = assignment.template_schema
    && collectPrefillableFields(assignment.template_schema).length > 0;
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-maja-navy/15 bg-white px-2 py-1.5 text-sm">
      <span className="min-w-0 flex-1 truncate font-medium text-maja-ink">
        {assignment.template_name}
      </span>
      {hasPrefillable && (
        <button
          type="button"
          onClick={onEditPrefill}
          className="rounded-md border border-maja-navy/20 bg-white px-2 py-0.5 text-xs font-medium text-maja-navy hover:bg-maja-light"
        >
          {prefillCount > 0
            ? `Vorgaben bearbeiten (${prefillCount})`
            : 'Vorgaben eintragen'}
        </button>
      )}
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        aria-label="Protokoll entfernen"
        title="Protokoll entfernen"
        className="rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-40"
      >
        <XIcon className="h-4 w-4" />
      </button>
    </li>
  );
}
