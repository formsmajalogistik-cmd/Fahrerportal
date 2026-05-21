import { useMemo } from 'react';
import { filterAvailableZugaenge } from '../../lib/greimel';
import { XIcon } from '../../components/icons';
import type { FormularTemplate, GreimelZugang, ProtokollArt } from '../../types/db';

interface Props {
  protokollArt: ProtokollArt | null;
  schriftlichesProtokollId: string | null;
  greimelZugangId: string | null;
  /** Freitext-Notiz, die bei Protokoll-Art "App" angezeigt wird. */
  appNotiz: string;
  onChange: (patch: {
    protokoll_art?: ProtokollArt | null;
    schriftliches_protokoll_id?: string | null;
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

export function ProtokollSection({
  protokollArt, schriftlichesProtokollId, greimelZugangId, appNotiz,
  onChange, isGreimel, fahrerId, templates, zugaenge, externeApp,
}: Props) {
  const externeAppUrl = externeApp?.url?.trim() || null;
  const externeAppName = externeApp?.name?.trim() || 'externe App';
  const availableZugaenge = useMemo(
    () => filterAvailableZugaenge(zugaenge, fahrerId, greimelZugangId),
    [zugaenge, fahrerId, greimelZugangId],
  );

  const linkedTemplate = useMemo(
    () => templates.find((t) => t.id === schriftlichesProtokollId) ?? null,
    [templates, schriftlichesProtokollId],
  );

  const linkedZugang = useMemo(
    () => zugaenge.find((z) => z.id === greimelZugangId) ?? null,
    [zugaenge, greimelZugangId],
  );

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

      {/* Schriftlich-Bereich */}
      {protokollArt === 'schriftlich' && (
        <div className="space-y-2 rounded-md bg-maja-light/50 p-3">
          <div className="text-sm font-semibold text-maja-navy">Protokoll verknüpfen</div>
          <select
            className="input"
            value={schriftlichesProtokollId ?? ''}
            onChange={(e) => onChange({ schriftliches_protokoll_id: e.target.value || null })}
          >
            <option value="">— kein Protokoll verknüpft —</option>
            {(templates ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          {linkedTemplate ? (
            <p className="text-xs text-maja-muted">
              Verknüpft: <span className="font-medium text-maja-ink">{linkedTemplate.name}</span>
            </p>
          ) : (
            <p className="text-xs text-maja-muted">Noch kein Protokoll verknüpft.</p>
          )}
        </div>
      )}
    </div>
  );
}
