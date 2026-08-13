// Eingabeblock für einen manuellen Rechnungs-/Gutschrift-Empfänger
// (Migration 088) — jemand, der kein Auftraggeber ist: Subunternehmer,
// Fahrer, Privatperson.
//
// Wird von der Rechnungs- und der Gutschrift-Erstellung gemeinsam
// genutzt, damit beide exakt dieselben Felder und Regeln haben.
//
// Firma ist optional: eine Privatperson lässt sie leer, und der
// Adressblock auf dem PDF bekommt dadurch keine Leerzeile — der
// Renderer überspringt leere Felder.

import { useEffect, useState } from 'react';
import {
  anzeigeName, entwurfAusGespeichertem, ladeManuelleEmpfaenger,
  type ManuellerEmpfaenger, type ManuellerEmpfaengerEntwurf,
} from '../lib/manuelleEmpfaenger';

interface Props {
  wert: ManuellerEmpfaengerEntwurf;
  onChange: (next: ManuellerEmpfaengerEntwurf) => void;
  /** Checkbox "für spätere Rechnungen merken". */
  merken: boolean;
  onMerken: (v: boolean) => void;
  idPrefix: string;
}

export function ManuellerEmpfaengerFeldsatz({
  wert, onChange, merken, onMerken, idPrefix,
}: Props) {
  const [gemerkte, setGemerkte] = useState<ManuellerEmpfaenger[]>([]);
  const [geladen, setGeladen] = useState(false);

  useEffect(() => {
    let abgebrochen = false;
    void (async () => {
      const liste = await ladeManuelleEmpfaenger();
      if (abgebrochen) return;
      setGemerkte(liste);
      setGeladen(true);
    })();
    return () => { abgebrochen = true; };
  }, []);

  const patch = (p: Partial<ManuellerEmpfaengerEntwurf>) => onChange({ ...wert, ...p });

  return (
    <div className="space-y-3 rounded-lg border border-maja-navy/15 bg-maja-light/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-maja-navy">Empfänger (manuell)</h3>
        {geladen && gemerkte.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-maja-muted">
            <span>Gemerkten Empfänger übernehmen …</span>
            <select
              className="input py-1 text-xs"
              value=""
              onChange={(e) => {
                const m = gemerkte.find((g) => g.id === e.target.value);
                if (m) onChange(entwurfAusGespeichertem(m));
                e.currentTarget.selectedIndex = 0;
              }}
            >
              <option value="">— wählen —</option>
              {gemerkte.map((m) => (
                <option key={m.id} value={m.id}>{anzeigeName(entwurfAusGespeichertem(m))}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={`${idPrefix}-firma`} className="label">
            Firma <span className="font-normal text-maja-muted">(bei Privatpersonen leer lassen)</span>
          </label>
          <input id={`${idPrefix}-firma`} className="input"
                 value={wert.firma} onChange={(e) => patch({ firma: e.target.value })} />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-anrede`} className="label">Anrede</label>
          <select id={`${idPrefix}-anrede`} className="input"
                  value={wert.anrede} onChange={(e) => patch({ anrede: e.target.value })}>
            <option value="">—</option>
            <option value="Herr">Herr</option>
            <option value="Frau">Frau</option>
          </select>
          <p className="mt-1 text-xs text-maja-muted">
            Steuert die Brief-Anrede; das Anrede-Feld oben bleibt editierbar.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${idPrefix}-vorname`} className="label">Vorname</label>
            <input id={`${idPrefix}-vorname`} className="input"
                   value={wert.vorname} onChange={(e) => patch({ vorname: e.target.value })} />
          </div>
          <div>
            <label htmlFor={`${idPrefix}-nachname`} className="label">Nachname</label>
            <input id={`${idPrefix}-nachname`} className="input"
                   value={wert.nachname} onChange={(e) => patch({ nachname: e.target.value })} />
          </div>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${idPrefix}-strasse`} className="label">Straße</label>
          <input id={`${idPrefix}-strasse`} className="input"
                 placeholder="z.B. Heiligenroder Strasse 38e"
                 value={wert.strasse} onChange={(e) => patch({ strasse: e.target.value })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor={`${idPrefix}-plz`} className="label">PLZ</label>
            <input id={`${idPrefix}-plz`} className="input" inputMode="numeric"
                   value={wert.plz} onChange={(e) => patch({ plz: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${idPrefix}-ort`} className="label">Ort</label>
            <input id={`${idPrefix}-ort`} className="input"
                   value={wert.ort} onChange={(e) => patch({ ort: e.target.value })} />
          </div>
        </div>
        <div>
          <label htmlFor={`${idPrefix}-land`} className="label">Land</label>
          <input id={`${idPrefix}-land`} className="input"
                 placeholder="(leer = Deutschland)"
                 value={wert.land} onChange={(e) => patch({ land: e.target.value })} />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-email`} className="label">E-Mail</label>
          <input id={`${idPrefix}-email`} type="email" className="input"
                 value={wert.email} onChange={(e) => patch({ email: e.target.value })} />
          <p className="mt-1 text-xs text-maja-muted">Belegt den Versand-Dialog vor.</p>
        </div>
        <div>
          <label htmlFor={`${idPrefix}-ustid`} className="label">USt-IdNr. / Steuernummer</label>
          <input id={`${idPrefix}-ustid`} className="input"
                 value={wert.ustId} onChange={(e) => patch({ ustId: e.target.value })} />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-kdnr`} className="label">Kundennummer</label>
          <input id={`${idPrefix}-kdnr`} className="input"
                 value={wert.kundennummer}
                 onChange={(e) => patch({ kundennummer: e.target.value })} />
          <p className="mt-1 text-xs text-maja-muted">
            Frei wählbar — nicht aus der Auftraggeber-Nummerierung.
          </p>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-maja-ink">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy focus:ring-maja-accent"
          checked={merken}
          onChange={(e) => onMerken(e.target.checked)}
        />
        Empfänger für spätere Rechnungen merken
      </label>
    </div>
  );
}
