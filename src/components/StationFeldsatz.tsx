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
// Layout: Stadt schmal, Adresse breit, Zeit schmal — auf Desktop in
// einer Zeile, auf Tablet zweispaltig, auf Mobile einspaltig mit vollen
// Touch-Höhen. Kein Feld läuft dabei aus dem Container.

import { AnsprechpartnerFeldsatz } from './AnsprechpartnerFeldsatz';
import { TfBlock } from './TfBlock';
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
  /** Linker Farbakzent — unterscheidet Hin- von Rückfahrt-Blöcken. */
  akzent?: 'hin' | 'rueck';
}

export function StationFeldsatz({
  titel, idPrefix, stadtLabel, stadt, onStadt, stadtPflicht, stadtFehler,
  adresse, onAdresse, adressePflicht, adresseFehler,
  zeit, onZeit, kontakte, onKontakte, kontaktPflicht, kontaktFehler,
  children, akzent,
}: Props) {
  const cls = (fehler?: boolean) => (fehler ? 'tf-input border-red-500' : 'tf-input');
  return (
    <TfBlock titel={titel} akzent={akzent}>
      <div className="tf-grid">
        <div className="sm:col-span-2 lg:col-span-3">
          <label htmlFor={`${idPrefix}-stadt`} className="tf-label">
            {stadtLabel}{stadtPflicht ? ' *' : ''}
          </label>
          <input id={`${idPrefix}-stadt`} className={cls(stadtFehler)}
                 value={stadt} onChange={(e) => onStadt(e.target.value)} />
        </div>
        <div className="sm:col-span-3 lg:col-span-6">
          <label htmlFor={`${idPrefix}-adresse`} className="tf-label">
            Adresse (Straße, Nr., PLZ){adressePflicht ? ' *' : ''}
          </label>
          <input id={`${idPrefix}-adresse`} className={cls(adresseFehler)}
                 placeholder="Straße Nr, PLZ Stadt"
                 value={adresse} onChange={(e) => onAdresse(e.target.value)} />
        </div>
        <div className="sm:col-span-1 lg:col-span-3">
          <label htmlFor={`${idPrefix}-zeit`} className="tf-label">Zeit</label>
          <input id={`${idPrefix}-zeit`} className="tf-input"
                 placeholder={ZEIT_PLATZHALTER}
                 value={zeit} onChange={(e) => onZeit(e.target.value)} />
        </div>
      </div>
      {children}
      <div className="mt-2">
        <AnsprechpartnerFeldsatz
          titel="Ansprechpartner"
          pflicht={kontaktPflicht}
          idPrefix={`${idPrefix}-k`}
          liste={kontakte}
          fehlerAmErsten={kontaktFehler}
          onChange={onKontakte}
        />
      </div>
    </TfBlock>
  );
}
