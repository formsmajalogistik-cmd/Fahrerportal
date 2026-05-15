import { useMemo } from 'react';
import { displayName, fahrerName } from '../../lib/names';
import type { AppUser } from '../../types/db';

export interface FahrerOptionRaw {
  id: string;
  vorname: string | null;
  nachname: string | null;
  ist_unterkonto?: boolean;
  haupt_user_id?: string | null;
  user?: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null;
}

interface Group {
  haupt: FahrerOptionRaw;
  hauptLabel: string;
  unterkonten: Array<{ id: string; label: string }>;
}

/**
 * Baut die <optgroup>-Struktur für einen Fahrer-Dropdown:
 *
 *   ▸ Haupt-Konten zeigen ihren eigenen Namen
 *   ▸ Unterkonten erscheinen direkt unter ihrem Haupt-Konto als
 *     "Name (Unterkonto von Hauptkonto-Name)"
 *   ▸ Wenn Unterkonto und Haupt denselben Namen haben, wird das
 *     Unterkonto NICHT als Duplikat angezeigt — die Haupt-Option
 *     reicht.
 *
 * Akzeptiert eine bereits gefilterte Fahrer-Liste (z.B. nur aktive).
 * Funktioniert mit Haupt-Einträgen, Unterkonten oder Mischungen.
 */
export function buildFahrerGroups(list: FahrerOptionRaw[]): Group[] {
  const byId = new Map<string, FahrerOptionRaw>();
  for (const f of list) byId.set(f.id, f);

  const groups: Group[] = [];
  // 1. Echte Haupt-Konten in der Liste
  for (const f of list) {
    if (f.ist_unterkonto) continue;
    const hauptLabel = fahrerName(f, f.user ?? null) || displayName(f.user ?? null) || '—';
    groups.push({ haupt: f, hauptLabel, unterkonten: [] });
  }
  // 2. Unterkonten den passenden Haupt-Gruppen zuordnen. Wenn der Haupt-
  //    Eintrag NICHT in der Liste enthalten ist (z.B. weil nur eine
  //    Untermenge übergeben wurde), behandeln wir das Unterkonto als
  //    eigenständigen Top-Level-Eintrag.
  for (const f of list) {
    if (!f.ist_unterkonto) continue;
    const subLabel = fahrerName(f, f.user ?? null) || displayName(f.user ?? null) || '—';
    const hauptId = f.haupt_user_id ?? '';
    const group = groups.find((g) => g.haupt.id === hauptId);
    if (group) {
      // Duplikat-Check: gleicher Name wie das Haupt-Konto → überspringen.
      if (subLabel.trim().toLowerCase() === group.hauptLabel.trim().toLowerCase()) continue;
      group.unterkonten.push({
        id: f.id,
        label: `${subLabel} (Unterkonto von ${group.hauptLabel})`,
      });
    } else {
      // Verwaistes Unterkonto — als eigene Gruppe behandeln.
      groups.push({ haupt: f, hauptLabel: subLabel, unterkonten: [] });
    }
  }
  // Alphabetisch nach Haupt-Label sortieren.
  groups.sort((a, b) => a.hauptLabel.localeCompare(b.hauptLabel, 'de'));
  for (const g of groups) g.unterkonten.sort((a, b) => a.label.localeCompare(b.label, 'de'));
  return groups;
}

interface Props {
  id?: string;
  className?: string;
  value: string;
  onChange: (id: string) => void;
  fahrer: FahrerOptionRaw[];
  placeholder?: string;
  required?: boolean;
}

/**
 * Standard-<select>-Dropdown mit optgroup-Struktur für Haupt-/Unterkonten.
 */
export function FahrerSelect({
  id, className = 'input', value, onChange, fahrer, placeholder = '— kein Fahrer —', required,
}: Props) {
  const groups = useMemo(() => buildFahrerGroups(fahrer), [fahrer]);
  return (
    <select
      id={id}
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
    >
      <option value="">{placeholder}</option>
      {groups.map((g) => {
        // Wenn das Haupt-Konto KEINE Unterkonten hat, brauchen wir keine
        // Gruppen-Box — schlanker Direkteintrag.
        if (g.unterkonten.length === 0) {
          return (
            <option key={g.haupt.id} value={g.haupt.id}>{g.hauptLabel}</option>
          );
        }
        return (
          <optgroup key={g.haupt.id} label={g.hauptLabel}>
            <option value={g.haupt.id}>{g.hauptLabel}</option>
            {g.unterkonten.map((u) => (
              <option key={u.id} value={u.id}>{u.label}</option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

/**
 * Flache Liste von Optionen (label-only) für Multi-Select-Komponenten,
 * z.B. die Aufstellung. Reihenfolge: Haupt, dann Unterkonten in der
 * Anzeige der buildFahrerGroups-Struktur.
 */
export function flattenedFahrerOptions(list: FahrerOptionRaw[]): Array<{ id: string; label: string }> {
  const groups = buildFahrerGroups(list);
  const out: Array<{ id: string; label: string }> = [];
  for (const g of groups) {
    out.push({ id: g.haupt.id, label: g.hauptLabel });
    for (const u of g.unterkonten) out.push({ id: u.id, label: u.label });
  }
  return out;
}
