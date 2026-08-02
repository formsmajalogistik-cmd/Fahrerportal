// Ein Stations-Block einer Tour: Stadt, Adresse, Zeitangabe und die
// Ansprechpartner gehören fachlich zusammen und stehen deshalb auch
// zusammen in einem Rahmen.
//
// Die Zeitangabe ist bewusst ein reines TEXTFELD (Migration 081): so
// sind "08:00", "vormittags" und "nach Absprache" gleichermaßen
// möglich, und es braucht kein zweites Hinweis-Feld daneben. Das
// frühere <input type="time"> neben dem Datum ist damit weg — es hat
// auf schmalen Breiten das Layout gesprengt.
//
// Alle Felder liegen in einem einspaltigen Grid und laufen dadurch auf
// keiner Breite aus dem Container.

import { AnsprechpartnerFeldsatz } from './AnsprechpartnerFeldsatz';
import type { KontaktEntwurf } from '../lib/tourAnsprechpartner';

export const ZEIT_PLATZHALTER = 'z.B. 08:00 oder vormittags';

interface Props {
  /** Überschrift des Blocks, z.B. "Start" oder "Ziel". */
  titel: string;
  idPrefix: string;
  stadtLabel: string;
  stadt: string;
  onStadt: (v: string) => void;
  stadtPflicht?: boolean;
  stadtFehler?: boolean;
  adresse: string;
  onAdresse: (v: string) => void;
  adressePflicht?: boolean;
  adresseFehler?: boolean;
  /** Freitext-Zeitangabe der Station. */
  zeit: string;
  onZeit: (v: string) => void;
  kontakte: KontaktEntwurf[];
  onKontakte: (next: KontaktEntwurf[]) => void;
  kontaktPflicht?: boolean;
  kontaktFehler?: boolean;
  /** Optionaler Zusatz unter der Adresse (z.B. "Entfernung berechnen"). */
  children?: React.ReactNode;
}

export function StationFeldsatz({
  titel, idPrefix, stadtLabel, stadt, onStadt, stadtPflicht, stadtFehler,
  adresse, onAdresse, adressePflicht, adresseFehler,
  zeit, onZeit, kontakte, onKontakte, kontaktPflicht, kontaktFehler,
  children,
}: Props) {
  const cls = (fehler?: boolean) => (fehler ? 'input border-red-500' : 'input');
  return (
    <section className="space-y-3 rounded-lg border border-maja-navy/15 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-maja-muted">
        {titel}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <label htmlFor={`${idPrefix}-stadt`} className="label">
            {stadtLabel}{stadtPflicht ? ' *' : ''}
          </label>
          <input id={`${idPrefix}-stadt`} className={cls(stadtFehler)}
                 value={stadt} onChange={(e) => onStadt(e.target.value)} />
        </div>
        <div className="min-w-0">
          <label htmlFor={`${idPrefix}-zeit`} className="label">Zeit (optional)</label>
          <input id={`${idPrefix}-zeit`} className="input"
                 placeholder={ZEIT_PLATZHALTER}
                 value={zeit} onChange={(e) => onZeit(e.target.value)} />
        </div>
      </div>
      <div className="min-w-0">
        <label htmlFor={`${idPrefix}-adresse`} className="label">
          Adresse{adressePflicht ? ' *' : ''}
        </label>
        <input id={`${idPrefix}-adresse`} className={cls(adresseFehler)}
               placeholder="Straße Nr, PLZ Stadt"
               value={adresse} onChange={(e) => onAdresse(e.target.value)} />
      </div>
      {children}
      <AnsprechpartnerFeldsatz
        titel="Ansprechpartner"
        pflicht={kontaktPflicht}
        idPrefix={`${idPrefix}-k`}
        liste={kontakte}
        fehlerAmErsten={kontaktFehler}
        onChange={onKontakte}
      />
    </section>
  );
}
