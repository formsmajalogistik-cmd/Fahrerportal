// Hinweiszeile unter der Zusatz-Erfassung: woher der Preis kommt, wie
// gerechnet wurde, ob er von Hand geändert ist — oder warum keiner
// eingesetzt wurde. Nur in Admin-Ansichten eingebunden.

import { formatAnzahl, formatEuro } from '../lib/touren';
import { ABRECHNUNG_LABEL, PREISLISTEN_KATEGORIEN, kategorieSchluessel } from '../lib/auslagenPreis';
import type { AuslagenAutomatik } from '../lib/useAuslagenAutomatik';

const HINWEIS = 'text-xs text-maja-muted';
const WARNUNG = 'text-xs text-amber-800 dark:!text-amber-300';

function zahl(t: string): number | null {
  const s = t.trim();
  if (!s) return null;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : null;
}

export function AuslagenHinweis({
  automatik: a, kategorie, auftraggeberId, auftraggeberName, sondervereinbarung, rechnungen,
}: {
  automatik: AuslagenAutomatik;
  kategorie: string;
  auftraggeberId: string | null | undefined;
  auftraggeberName: string | null | undefined;
  sondervereinbarung?: boolean;
  /** Rechnungsnummern, auf denen die Tour schon steht. */
  rechnungen?: string[];
}) {
  if (!kategorie) return null;
  const agName = auftraggeberName || 'dieser Auftraggeber';
  const erwartet = PREISLISTEN_KATEGORIEN.some((k) => kategorieSchluessel(k) === kategorieSchluessel(kategorie));
  const rechnungsHinweis = rechnungen && rechnungen.length > 0 && (
    <p className={WARNUNG}>
      Tour steht bereits auf {rechnungen.length > 1 ? 'den Rechnungen' : 'Rechnung'} {rechnungen.join(', ')} — die Rechnung wird nicht automatisch angepasst.
    </p>
  );

  if (!auftraggeberId) {
    return erwartet
      ? <div className="space-y-0.5" data-testid="auslagen-hinweis"><p className={HINWEIS}>Tour ohne Auftraggeber — keine automatische Preisübernahme.</p>{rechnungsHinweis}</div>
      : null;
  }
  if (!a.geladen) return null;

  if (!a.regel) {
    if (!erwartet && !a.fehlendeAbrechnung) return rechnungsHinweis ? <div data-testid="auslagen-hinweis">{rechnungsHinweis}</div> : null;
    return (
      <div className="space-y-0.5" data-testid="auslagen-hinweis">
        <p className={WARNUNG}>
          {a.fehlendeAbrechnung
            ? <>Für {agName} ist bei „{kategorie}" keine Abrechnungsart hinterlegt — Preis bitte von Hand eintragen.</>
            : <>Für {agName} ist kein Preis für {kategorie} hinterlegt.</>}
          {' '}
          <a href={`/einstellungen/preislisten?ag=${encodeURIComponent(auftraggeberId)}`} target="_blank" rel="noopener noreferrer"
             className="font-semibold underline">
            In der Preisliste hinterlegen
          </a>
        </p>
        {rechnungsHinweis}
      </div>
    );
  }

  const r = a.regel;
  const listenpreis = formatEuro(r.preis);
  const regelText = `${listenpreis} ${ABRECHNUNG_LABEL[r.abrechnung]}${r.freiminuten > 0 ? `, ${r.freiminuten} Min frei` : ''}`;
  const betrag = zahl(a.betrag);
  const e = a.ergebnis;

  return (
    <div className="space-y-0.5" data-testid="auslagen-hinweis">
      {a.manuell ? (
        <p className={WARNUNG}>
          manuell geändert (Preisliste: {listenpreis})
          {' '}
          <button type="button" className="font-semibold underline" onClick={a.preislisteUebernehmen}>
            Preisliste übernehmen
          </button>
        </p>
      ) : sondervereinbarung ? (
        <p className={WARNUNG}>
          Vorschlag aus Preisliste {agName} ({regelText}) — die Tour hat eine Sondervereinbarung, bitte prüfen.
        </p>
      ) : (
        <p className={HINWEIS}>aus Preisliste {agName} ({regelText})</p>
      )}
      {e && (e.ok ? (
        <p className={HINWEIS}>
          {a.manuell
            ? <>{formatAnzahl(e.anzahl)} × {betrag != null ? formatEuro(betrag) : '—'}</>
            : e.erklaerung}
          {e.anzahl > 0 && betrag != null && <> = <strong>{formatEuro(Math.round(e.anzahl * betrag * 100) / 100)}</strong></>}
        </p>
      ) : (
        a.zeitbasiert && <p className={WARNUNG}>{e.text}</p>
      ))}
      {rechnungsHinweis}
    </div>
  );
}
