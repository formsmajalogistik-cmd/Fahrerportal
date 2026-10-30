// Versand-Abschnitt in der Rechnungs-/Gutschrift-Detailansicht: aktueller
// Status, „Als versendet markieren", Verlauf aller Versände und
// Markierungen (auch zurückgenommene), „Markierung entfernen" nur für
// aktive manuelle Markierungen — App-Versände bleiben stehen.

import { useCallback, useEffect, useState } from 'react';
import {
  alsVersendetMarkieren, eintragBeschreibung, ladeVersand, markierungEntfernen, versandRelevant, versandStatus,
  type BelegTyp, type VersandEintrag, type VersandStatus,
} from '../../lib/belegVersand';
import { formatDateTime } from '../../lib/touren';
import { VersandBadge } from './VersandBadge';
import { VersendetMarkierenDialog } from './VersendetMarkierenDialog';
import { ConfirmDialog } from '../ConfirmDialog';

export function VersandAbschnitt({
  typ, belegId, belegStatus, stand, onStatus,
}: {
  typ: BelegTyp;
  belegId: string;
  belegStatus: string;
  /** Ändert sich nach einem App-Versand → neu laden. */
  stand?: string | null;
  onStatus?: (s: VersandStatus) => void;
}) {
  const [eintraege, setEintraege] = useState<VersandEintrag[] | null>(null);
  const [fehlt, setFehlt] = useState(false);
  const [markieren, setMarkieren] = useState(false);
  const [entfernen, setEntfernen] = useState<VersandEintrag | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  const laden = useCallback(async () => {
    try {
      const r = await ladeVersand(typ, [belegId]);
      setFehlt(r.fehlt);
      setEintraege(r.map.get(belegId) ?? []);
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Versandstatus konnte nicht geladen werden.');
    }
  }, [typ, belegId]);

  useEffect(() => { void laden(); }, [laden, stand]);

  const status = eintraege ? versandStatus(typ, belegStatus, eintraege) : null;
  useEffect(() => { if (status) onStatus?.(status); }, [status?.art, status?.letzter?.id, eintraege]); // eslint-disable-line react-hooks/exhaustive-deps

  if (fehlt) return null; // Migration 111 noch nicht eingespielt
  const darfMarkieren = versandRelevant(typ, belegStatus);

  return (
    <section className="card space-y-3 p-5" aria-labelledby="versand-titel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 id="versand-titel" className="text-base font-semibold text-maja-navy">Versand</h2>
          {status && <VersandBadge status={status} />}
        </div>
        {darfMarkieren && (
          <button type="button" className="btn-secondary text-sm" onClick={() => setMarkieren(true)}>
            Als versendet markieren
          </button>
        )}
      </div>
      {fehler && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</div>}
      {status && status.verlauf.length === 0 && (
        <p className="text-sm text-maja-muted">
          {darfMarkieren ? 'Noch kein Versand bekannt.' : 'Entwurf — kein Versand erwartet.'}
        </p>
      )}
      {status && status.verlauf.length > 0 && (
        <ul className="divide-y divide-maja-navy/10 text-sm">
          {status.verlauf.map((e) => (
            <li key={e.id} className={`flex flex-wrap items-start justify-between gap-2 py-2 ${e.entfernt_am ? 'opacity-60' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className={e.entfernt_am ? 'line-through' : ''}>{eintragBeschreibung(e)}</div>
                <div className="text-xs text-maja-muted">
                  eingetragen {formatDateTime(e.created_at)}{e.erstellt_von_name ? ` von ${e.erstellt_von_name}` : ''}
                  {e.entfernt_am && <> · Markierung entfernt {formatDateTime(e.entfernt_am)}{e.entfernt_von_name ? ` von ${e.entfernt_von_name}` : ''}</>}
                </div>
              </div>
              {e.art === 'manuell' && !e.entfernt_am && (
                <button type="button" className="text-xs font-semibold text-maja-navy underline" onClick={() => setEntfernen(e)}>
                  Markierung entfernen
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {markieren && (
        <VersendetMarkierenDialog
          titel="Als versendet markieren"
          onCancel={() => setMarkieren(false)}
          onConfirm={async (weg, datum, notiz) => {
            await alsVersendetMarkieren(typ, [belegId], weg, datum, notiz);
            setMarkieren(false);
            await laden();
          }}
        />
      )}
      {entfernen && (
        <ConfirmDialog
          title="Markierung entfernen?"
          message={<>„{eintragBeschreibung(entfernen)}" wird zurückgenommen. Der Eintrag bleibt im Verlauf sichtbar.</>}
          confirmLabel="Markierung entfernen"
          onConfirm={async () => { await markierungEntfernen(entfernen.id); setEntfernen(null); await laden(); }}
          onClose={() => setEntfernen(null)}
        />
      )}
    </section>
  );
}
