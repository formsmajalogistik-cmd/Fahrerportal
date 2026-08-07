// Ansprechpartner-Block einer Station (Migration 080).
//
// Standardansicht bleibt exakt wie bisher: EIN Kontakt mit Name /
// Telefon / E-Mail — kein zusätzlicher Platzbedarf im Normalfall.
// Darunter ein dezenter Button "+ Weiterer Ansprechpartner"; erst bei
// Klick erscheint ein weiterer Block. Sind bereits weitere Kontakte
// gespeichert, werden sie eingeklappt als "Weitere Ansprechpartner (N)"
// angeboten statt dauerhaft ausgeklappt.
//
// Die Keys kommen aus KontaktEntwurf.key (DB-UUID bzw. generierter Key)
// — bewusst NICHT der Array-Index, sonst entstehen dieselben Eingabe-
// und Sortier-Bugs wie seinerzeit bei den Rechnungspositionen.

import { useState } from 'react';
import { XIcon } from './icons';
import {
  leererKontakt, type KontaktEntwurf,
} from '../lib/tourAnsprechpartner';

interface Props {
  titel: string;
  /** Pflicht-Markierung am ersten Block (nur Optik). */
  pflicht?: boolean;
  /** id-Präfix, damit Labels in mehreren Instanzen eindeutig bleiben. */
  idPrefix: string;
  liste: KontaktEntwurf[];
  onChange: (next: KontaktEntwurf[]) => void;
  disabled?: boolean;
  /** Rote Umrandung am ersten Namensfeld (Pflichtfeld-Validierung). */
  fehlerAmErsten?: boolean;
}

export function AnsprechpartnerFeldsatz({
  titel, pflicht, idPrefix, liste, onChange, disabled, fehlerAmErsten,
}: Props) {
  // Erster Block ist immer sichtbar; alles darüber hinaus steckt hinter
  // dem Aufklapper, damit die Maske im Normalfall unverändert aussieht.
  const [offen, setOffen] = useState(false);
  const eintraege = liste.length > 0 ? liste : [leererKontakt()];
  const erster = eintraege[0];
  const weitere = eintraege.slice(1);

  function patch(key: string, p: Partial<KontaktEntwurf>) {
    onChange(eintraege.map((k) => (k.key === key ? { ...k, ...p } : k)));
  }

  function hinzufuegen() {
    setOffen(true);
    onChange([...eintraege, leererKontakt()]);
  }

  function entfernen(key: string) {
    const next = eintraege.filter((k) => k.key !== key);
    onChange(next.length > 0 ? next : [leererKontakt()]);
  }

  return (
    <fieldset className="rounded-md border border-maja-navy/15 px-2.5 py-2">
      <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-maja-muted">
        {titel}{pflicht ? ' *' : ''}
      </legend>

      <KontaktZeile
        idPrefix={`${idPrefix}-1`}
        titel={titel}
        kontakt={erster}
        disabled={disabled}
        fehler={fehlerAmErsten}
        onChange={(p) => patch(erster.key, p)}
      />

      {weitere.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setOffen((o) => !o)}
            className="text-[11px] font-medium text-maja-accent hover:underline"
            aria-expanded={offen}
          >
            Weitere Ansprechpartner ({weitere.length}) {offen ? '▴' : '▾'}
          </button>
          {offen && (
            <div className="mt-2 space-y-2">
              {weitere.map((k, i) => (
                <div key={k.key} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <KontaktZeile
                      idPrefix={`${idPrefix}-${i + 2}`}
                      titel={`${titel} ${i + 2}`}
                      kontakt={k}
                      disabled={disabled}
                      onChange={(p) => patch(k.key, p)}
                    />
                  </div>
                  {!disabled && (
                    <button
                      type="button"
                      onClick={() => entfernen(k.key)}
                      className="mt-1 shrink-0 rounded p-1 text-red-600 hover:bg-red-50"
                      aria-label={`${titel} ${i + 2} entfernen`}
                      title="Entfernen"
                    >
                      <XIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!disabled && (
        <button
          type="button"
          onClick={hinzufuegen}
          className="mt-1.5 text-[11px] font-medium text-maja-accent hover:underline"
        >
          + Weiterer Ansprechpartner
        </button>
      )}
    </fieldset>
  );
}

function KontaktZeile({
  idPrefix, titel, kontakt, onChange, disabled, fehler,
}: {
  idPrefix: string;
  titel: string;
  kontakt: KontaktEntwurf;
  onChange: (p: Partial<KontaktEntwurf>) => void;
  disabled?: boolean;
  fehler?: boolean;
}) {
  return (
    <div className="grid min-w-0 gap-2 sm:grid-cols-3">
      <input
        id={`${idPrefix}-name`}
        aria-label={`Name ${titel}`}
        className={`min-w-0 ${fehler ? 'tf-input border-red-500' : 'tf-input'}`}
        placeholder="Name"
        value={kontakt.name}
        disabled={disabled}
        onChange={(e) => onChange({ name: e.target.value })}
      />
      <input
        id={`${idPrefix}-tel`}
        aria-label={`Telefon ${titel}`}
        className="tf-input min-w-0"
        placeholder="Telefon"
        value={kontakt.telefon}
        disabled={disabled}
        onChange={(e) => onChange({ telefon: e.target.value })}
      />
      <input
        id={`${idPrefix}-mail`}
        aria-label={`E-Mail ${titel}`}
        className="tf-input min-w-0"
        placeholder="E-Mail"
        value={kontakt.email}
        disabled={disabled}
        onChange={(e) => onChange({ email: e.target.value })}
      />
    </div>
  );
}
