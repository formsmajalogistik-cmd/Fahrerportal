// Auswahl des Standorts eines festen Auftraggebers (Hauptsitz oder eine
// aktive Niederlassung) — z.B. für Auftraggeber-Konten beim Anlegen einer
// Tour. Ohne Niederlassungen wird nichts angezeigt.
import { hauptsitzBezeichnung, type Standorte } from '../lib/niederlassungen';

interface Props {
  id: string;
  standorte: Standorte | null;
  auftraggeberId: string | null;
  /** null = Hauptsitz */
  wert: string | null;
  onChange: (niederlassungId: string | null) => void;
  disabled?: boolean;
  labelClassName?: string;
  selectClassName?: string;
  hinweis?: string | null;
}

export function NiederlassungAuswahl({ id, standorte, auftraggeberId, wert, onChange, disabled, labelClassName = 'label', selectClassName = 'input', hinweis }: Props) {
  if (!standorte || !auftraggeberId) return null;
  const nls = standorte.jeAuftraggeber.get(auftraggeberId) ?? [];
  if (nls.length === 0) return null;
  const ag = standorte.auftraggeber.find((a) => a.id === auftraggeberId);
  const sichtbar = nls.filter((n) => n.aktiv || n.id === wert);
  return (
    <div>
      <label htmlFor={id} className={labelClassName}>Niederlassung</label>
      <select id={id} className={selectClassName} value={wert ?? ''} disabled={disabled}
              onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{hauptsitzBezeichnung(ag)} (Hauptsitz)</option>
        {sichtbar.map((n) => (
          <option key={n.id} value={n.id}>{n.bezeichnung}{[n.plz, n.ort].filter(Boolean).length ? ` — ${[n.plz, n.ort].filter(Boolean).join(' ')}` : ''}{n.aktiv ? '' : ' (inaktiv)'}</option>
        ))}
      </select>
      {hinweis && <p className="mt-1 text-xs text-maja-muted">{hinweis}</p>}
    </div>
  );
}
