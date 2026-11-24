// Dialog „Leerfahrt" mit Grund (Migration 120, nur Admin).
//
// Noch keine Leerfahrt: Grund wählen → „Als Leerfahrt markieren".
// Schon Leerfahrt: aktueller Grund vorausgewählt, änderbar, oder
// „Leerfahrt entfernen". Der Eintrag landet ausschließlich in der
// „Internen Info (nur Admin)" — das bisherige Infofeld bleibt unberührt.
import { useState } from 'react';
import { LEERFAHRT_GRUENDE, leerfahrtEingabeFehler, leerfahrtZeile } from '../../lib/leerfahrtGruende';
import {
  INFO_MANUELL_HINWEIS, leerfahrtEntfernenMitInfo, leerfahrtMitGrund, type LeerfahrtErgebnis,
} from '../../lib/interneInfo';

interface Props {
  tourId: string;
  tourNr?: string | null;
  /** Tour ist bereits als Leerfahrt markiert. */
  istLeerfahrt: boolean;
  /** Aktueller Grund (falls vorhanden). */
  grund?: string | null;
  text?: string | null;
  onAbbrechen: () => void;
  /** Nach erfolgreicher Änderung: Meldung für den Aufrufer. */
  onFertig: (meldung: { ok: boolean; text: string }) => void;
}

export function LeerfahrtDialog({ tourId, tourNr, istLeerfahrt, grund, text, onAbbrechen, onFertig }: Props) {
  const anfangsGrund = grund && LEERFAHRT_GRUENDE.some((g) => g.code === grund) ? grund : null;
  const sonstigesAnfang = anfangsGrund === 'sonstiges';
  const [code, setCode] = useState<string | null>(anfangsGrund);
  const [sonstiges, setSonstiges] = useState(sonstigesAnfang ? (text ?? '') : '');
  const [ergaenzung, setErgaenzung] = useState(!sonstigesAnfang ? (text ?? '') : '');
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [entfernenFrage, setEntfernenFrage] = useState(false);

  const istSonstiges = LEERFAHRT_GRUENDE.find((g) => g.code === code)?.textPflicht === true;
  const eigenerText = istSonstiges ? sonstiges : ergaenzung;
  const eingabeFehler = leerfahrtEingabeFehler(code, eigenerText);

  function meldung(r: LeerfahrtErgebnis, basis: string): { ok: boolean; text: string } {
    const teile = [basis];
    if (r.auslagen) teile.push(`„Keine Auslagen" für ${r.auslagen} Kennzeichen ${basis.startsWith('Leerfahrt entfernt') ? 'entfernt' : 'eingetragen'}.`);
    if (r.infoManuell) teile.push(INFO_MANUELL_HINWEIS);
    return { ok: !r.infoManuell, text: teile.join(' ') };
  }

  async function speichern() {
    if (eingabeFehler || !code) { setFehler(eingabeFehler); return; }
    setBusy(true); setFehler(null);
    try {
      const r = await leerfahrtMitGrund(tourId, code, eigenerText.trim() || null);
      onFertig(meldung(r, istLeerfahrt ? `Grund geändert: ${leerfahrtZeile(code, eigenerText)}.` : `Als Leerfahrt markiert: ${leerfahrtZeile(code, eigenerText)}.`));
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Speichern fehlgeschlagen');
      setBusy(false);
    }
  }

  async function entfernen() {
    setBusy(true); setFehler(null);
    try {
      const r = await leerfahrtEntfernenMitInfo(tourId);
      onFertig(meldung(r, 'Leerfahrt entfernt.'));
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Entfernen fehlgeschlagen');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center overflow-auto bg-maja-ink/40 px-4 py-6" onClick={() => !busy && onAbbrechen()}>
      <div role="dialog" aria-modal="true" aria-labelledby="leerfahrt-titel" data-testid="leerfahrt-dialog"
           className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h2 id="leerfahrt-titel" className="text-lg font-semibold text-maja-navy">
          Leerfahrt{tourNr ? <span className="ml-2 text-sm font-normal text-maja-muted">{tourNr}</span> : null}
        </h2>
        <fieldset className="mt-3" disabled={busy}>
          <legend className="tf-label mb-1">Grund</legend>
          <div className="space-y-1.5">
            {LEERFAHRT_GRUENDE.map((g) => (
              <label key={g.code} className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 text-sm text-maja-ink hover:bg-maja-light/60 dark:hover:!bg-slate-700/40">
                <input type="radio" name="leerfahrt-grund" value={g.code} className="mt-0.5 h-4 w-4"
                       checked={code === g.code} onChange={() => { setCode(g.code); setFehler(null); }} />
                <span className="flex-1">
                  {g.label}{g.textPflicht ? ':' : ''}
                  {g.textPflicht && code === g.code && (
                    <input id="leerfahrt-sonstiges" className="input mt-1 w-full" autoFocus value={sonstiges}
                           placeholder="Grund eintragen (Pflicht)" maxLength={200}
                           onChange={(e) => setSonstiges(e.target.value)} />
                  )}
                </span>
              </label>
            ))}
          </div>
          {!istSonstiges && (
            <div className="mt-3">
              <label htmlFor="leerfahrt-ergaenzung" className="tf-label">Ergänzung (optional)</label>
              <input id="leerfahrt-ergaenzung" className="input w-full" value={ergaenzung} maxLength={200}
                     placeholder="z.B. Bremse blockiert" onChange={(e) => setErgaenzung(e.target.value)} />
            </div>
          )}
        </fieldset>
        {code && !eingabeFehler && (
          <p className="mt-3 text-xs text-maja-muted">
            Eintrag in „Interne Info (nur Admin)": <span className="font-medium text-maja-ink">{leerfahrtZeile(code, eigenerText)}</span>
          </p>
        )}
        {fehler && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:!bg-red-950/40 dark:!text-red-200">{fehler}</p>}

        {entfernenFrage ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:!border-red-500/40 dark:!bg-red-950/40 dark:!text-red-100">
            <p>Leerfahrt entfernen? Die automatisch gesetzten „Keine Auslagen" und die Zeile in der internen Info werden ebenfalls entfernt.</p>
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <button type="button" className="btn-secondary px-3 py-1.5 text-sm" disabled={busy} onClick={() => setEntfernenFrage(false)}>Zurück</button>
              <button type="button" disabled={busy} onClick={() => void entfernen()}
                      className="inline-flex items-center justify-center rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                {busy ? '…' : 'Ja, Leerfahrt entfernen'}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <div>
              {istLeerfahrt && (
                <button type="button" className="text-sm font-medium text-red-700 hover:underline dark:!text-red-300" disabled={busy}
                        onClick={() => setEntfernenFrage(true)}>
                  Leerfahrt entfernen
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" disabled={busy} onClick={onAbbrechen}>Abbrechen</button>
              <button type="button" className="btn-primary" disabled={busy || !!eingabeFehler} onClick={() => void speichern()}
                      title={eingabeFehler ?? undefined}>
                {busy ? '…' : istLeerfahrt ? 'Grund speichern' : 'Als Leerfahrt markieren'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
