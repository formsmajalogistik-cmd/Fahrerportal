// Ein Stations-Block einer Tour: Adresse, Stadt, Zeitangabe und die
// Ansprechpartner gehören fachlich zusammen und stehen deshalb auch
// zusammen in einem Rahmen.
//
// Adresse (Migration 086): strukturiert in Straße, Hausnummer und PLZ.
// Die STADT ist kein eigenes Adressfeld — es ist dieselbe Tour-Stadt,
// die in der Tourenliste als Route erscheint. Sie wird hier und im
// Route-Block auf denselben State gebunden, ist also an beiden Stellen
// bearbeitbar und kann gar nicht auseinanderlaufen.
//
// Die Zeitangabe ist bewusst ein reines TEXTFELD (Migration 081): so
// sind "08:00", "vormittags" und "nach Absprache" gleichermaßen
// möglich, und es braucht kein zweites Hinweis-Feld daneben.
//
// Layout: Straße breit, Nr./PLZ schmal, Stadt und Zeit mittel — auf
// Desktop stehen die Adressfelder in einer Zeile (5/2/2/3 von 12), die
// Zeit darunter. Auf Tablet bekommt jedes Feld mindestens eine halbe
// Zeile, auf Mobile ist alles einspaltig mit vollen Touch-Höhen.

import { AnsprechpartnerFeldsatz } from './AnsprechpartnerFeldsatz';
import { TfBlock } from './TfBlock';
import { altAdresseHinweis } from '../lib/adresse';
import type { KontaktEntwurf } from '../lib/tourAnsprechpartner';

export const ZEIT_PLATZHALTER = 'z.B. 08:00 oder vormittags';

/** Tooltip am Stadt-Feld — macht die Kopplung an die Route sichtbar. */
export const STADT_HINWEIS =
  'Dieselbe Stadt, die in der Tourenliste als Route erscheint — hier und '
  + 'im Route-Block ist es dasselbe Feld.';

interface Props {
  /** Überschrift des Blocks, z.B. "Abholort" oder "Zielort". */
  titel: string;
  idPrefix: string;
  stadtLabel: string;
  stadt: string;
  onStadt: (v: string) => void;
  stadtPflicht?: boolean;
  stadtFehler?: boolean;
  strasse: string;
  onStrasse: (v: string) => void;
  hausnummer: string;
  onHausnummer: (v: string) => void;
  plz: string;
  onPlz: (v: string) => void;
  adressePflicht?: boolean;
  adresseFehler?: boolean;
  /**
   * Bisheriger Adress-Freitext der Tour. Wird nur angezeigt, solange
   * keine Einzelteile gepflegt sind (Bestandstour) — bewusst ohne
   * automatisches Zerlegen.
   */
  adresseFreitext?: string | null;
  /** Freitext-Zeitangabe der Station. */
  zeit: string;
  onZeit: (v: string) => void;
  /** Beschriftung des Zeitfelds, z.B. "Zeit Abholung". */
  zeitLabel: string;
  kontakte: KontaktEntwurf[];
  onKontakte: (next: KontaktEntwurf[]) => void;
  kontaktPflicht?: boolean;
  kontaktFehler?: boolean;
  /** Optionaler Zusatz unter den Feldern (z.B. "Entfernung berechnen"). */
  children?: React.ReactNode;
  /** Linker Farbakzent — unterscheidet Hin- von Rückfahrt-Blöcken. */
  akzent?: 'hin' | 'rueck';
  /** Optionale Aktion rechts in der Überschrift. */
  aktion?: React.ReactNode;
}

export function StationFeldsatz({
  titel, idPrefix, stadtLabel, stadt, onStadt, stadtPflicht, stadtFehler,
  strasse, onStrasse, hausnummer, onHausnummer, plz, onPlz,
  adressePflicht, adresseFehler, adresseFreitext,
  zeit, onZeit, zeitLabel, kontakte, onKontakte, kontaktPflicht, kontaktFehler,
  children, akzent, aktion,
}: Props) {
  const cls = (fehler?: boolean) => (fehler ? 'tf-input border-red-500' : 'tf-input');
  const altAdresse = altAdresseHinweis({ strasse, hausnummer, plz }, adresseFreitext);
  return (
    <TfBlock titel={titel} akzent={akzent} aktion={aktion}>
      <div className="tf-grid">
        <div className="sm:col-span-4 lg:col-span-5">
          <label htmlFor={`${idPrefix}-strasse`} className="tf-label">
            Straße{adressePflicht ? ' *' : ''}
          </label>
          <input id={`${idPrefix}-strasse`} className={cls(adresseFehler)}
                 placeholder="z.B. Musterstraße"
                 value={strasse} onChange={(e) => onStrasse(e.target.value)} />
        </div>
        <div className="sm:col-span-2 lg:col-span-2">
          <label htmlFor={`${idPrefix}-nr`} className="tf-label">Straße Nr.</label>
          <input id={`${idPrefix}-nr`} className="tf-input" placeholder="1a"
                 value={hausnummer} onChange={(e) => onHausnummer(e.target.value)} />
        </div>
        <div className="sm:col-span-2 lg:col-span-2">
          <label htmlFor={`${idPrefix}-plz`} className="tf-label">PLZ</label>
          <input id={`${idPrefix}-plz`} className="tf-input" inputMode="numeric"
                 placeholder="28195"
                 value={plz} onChange={(e) => onPlz(e.target.value)} />
        </div>
        <div className="sm:col-span-4 lg:col-span-3">
          <label htmlFor={`${idPrefix}-stadt`} className="tf-label">
            {stadtLabel}{stadtPflicht ? ' *' : ''}
          </label>
          <input id={`${idPrefix}-stadt`} className={cls(stadtFehler)}
                 title={STADT_HINWEIS}
                 value={stadt} onChange={(e) => onStadt(e.target.value)} />
        </div>
        <div className="sm:col-span-3 lg:col-span-3">
          <label htmlFor={`${idPrefix}-zeit`} className="tf-label">{zeitLabel}</label>
          <input id={`${idPrefix}-zeit`} className="tf-input"
                 placeholder={ZEIT_PLATZHALTER}
                 value={zeit} onChange={(e) => onZeit(e.target.value)} />
        </div>
      </div>
      {altAdresse && (
        <p className="tf-hint">
          Bisher erfasst: <span className="font-medium text-maja-ink">{altAdresse}</span>
          {' '}— bitte bei Gelegenheit in Straße / Nr. / PLZ übertragen.
        </p>
      )}
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
