// Verwaltung der gemerkten manuellen Empfänger (Migration 088).
//
// Diese Empfänger sind KEINE Auftraggeber und liegen bewusst in einer
// eigenen Tabelle — sie erscheinen in keiner Auftraggeber-Liste, keinem
// Auftraggeber-Filter und keinem Tour-Dropdown.
//
// Löschen ist unkritisch: Rechnungen und Gutschriften tragen ihren
// Adress-Snapshot selbst, ein gelöschter Eintrag verändert also kein
// ausgestelltes Dokument.

import { useCallback, useEffect, useState } from 'react';
import { Spinner } from '../../components/Spinner';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useTestGuard } from '../../auth/TestModeContext';
import {
  aktualisiereEmpfaenger, anzeigeName, entwurfAusGespeichertem,
  ladeManuelleEmpfaenger, leererEmpfaenger, loescheEmpfaenger, merkeEmpfaenger,
  nameZeile, plzOrt,
  type ManuellerEmpfaenger, type ManuellerEmpfaengerEntwurf,
} from '../../lib/manuelleEmpfaenger';

export function ManuelleEmpfaengerPage() {
  const guard = useTestGuard();
  const [liste, setListe] = useState<ManuellerEmpfaenger[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  /** null = Formular zu, '' = neuer Eintrag, sonst die bearbeitete Id. */
  const [bearbeiteId, setBearbeiteId] = useState<string | null>(null);
  const [entwurf, setEntwurf] = useState<ManuellerEmpfaengerEntwurf>(leererEmpfaenger());
  const [busy, setBusy] = useState(false);
  const [loeschId, setLoeschId] = useState<string | null>(null);

  const laden = useCallback(async () => {
    setLoading(true);
    setListe(await ladeManuelleEmpfaenger());
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => { void laden(); }, 0);
    return () => window.clearTimeout(t);
  }, [laden]);

  function neu() {
    setEntwurf(leererEmpfaenger());
    setBearbeiteId('');
    setFehler(null);
  }

  function bearbeiten(m: ManuellerEmpfaenger) {
    setEntwurf(entwurfAusGespeichertem(m));
    setBearbeiteId(m.id);
    setFehler(null);
  }

  async function speichern() {
    if (!entwurf.firma.trim() && !entwurf.nachname.trim()) {
      setFehler('Bitte eine Firma oder einen Nachnamen angeben.');
      return;
    }
    if (guard()) return;
    setBusy(true);
    const res = bearbeiteId
      ? await aktualisiereEmpfaenger(bearbeiteId, entwurf)
      : await merkeEmpfaenger(entwurf);
    setBusy(false);
    if (!res.ok) { setFehler(res.fehler ?? 'Speichern fehlgeschlagen.'); return; }
    setBearbeiteId(null);
    await laden();
  }

  async function loeschen(id: string) {
    if (guard()) return;
    setBusy(true);
    const res = await loescheEmpfaenger(id);
    setBusy(false);
    setLoeschId(null);
    if (!res.ok) { setFehler(res.fehler ?? 'Löschen fehlgeschlagen.'); return; }
    await laden();
  }

  const feld = (
    key: keyof ManuellerEmpfaengerEntwurf, label: string, extra?: string,
  ) => (
    <div>
      <label htmlFor={`me-${key}`} className="label">{label}</label>
      <input
        id={`me-${key}`}
        className="input"
        value={entwurf[key]}
        onChange={(e) => setEntwurf({ ...entwurf, [key]: e.target.value })}
      />
      {extra && <p className="mt-1 text-xs text-maja-muted">{extra}</p>}
    </div>
  );

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-maja-navy">Manuelle Empfänger</h2>
          <p className="text-sm text-maja-muted">
            Empfänger für Rechnungen und Gutschriften ohne Auftraggeber —
            z.B. Subunternehmer oder Privatpersonen. Sie erscheinen bewusst
            in keiner Auftraggeber-Liste und in keinem Tour-Filter.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={neu}>
          + Neuer Empfänger
        </button>
      </div>

      {fehler && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {fehler}
        </div>
      )}

      {bearbeiteId !== null && (
        <section className="card space-y-3 p-5">
          <h3 className="text-base font-semibold text-maja-navy">
            {bearbeiteId ? 'Empfänger bearbeiten' : 'Neuer Empfänger'}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              {feld('firma', 'Firma', 'Bei Privatpersonen leer lassen.')}
            </div>
            <div>
              <label htmlFor="me-anrede" className="label">Anrede</label>
              <select
                id="me-anrede"
                className="input"
                value={entwurf.anrede}
                onChange={(e) => setEntwurf({ ...entwurf, anrede: e.target.value })}
              >
                <option value="">—</option>
                <option value="Herr">Herr</option>
                <option value="Frau">Frau</option>
              </select>
            </div>
            <div />
            {feld('vorname', 'Vorname')}
            {feld('nachname', 'Nachname')}
            <div className="sm:col-span-2">{feld('strasse', 'Straße')}</div>
            {feld('plz', 'PLZ')}
            {feld('ort', 'Ort')}
            {feld('land', 'Land')}
            {feld('email', 'E-Mail')}
            {feld('ustId', 'USt-IdNr. / Steuernummer')}
            {feld('kundennummer', 'Kundennummer')}
          </div>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button
              type="button" className="btn-secondary" disabled={busy}
              onClick={() => { setBearbeiteId(null); setFehler(null); }}
            >
              Abbrechen
            </button>
            <button
              type="button" className="btn-primary" disabled={busy}
              onClick={() => void speichern()}
            >
              {busy ? 'Speichern …' : 'Speichern'}
            </button>
          </div>
        </section>
      )}

      {liste.length === 0 ? (
        <div className="card p-8 text-center text-sm text-maja-muted">
          Noch keine Empfänger gemerkt. Beim Anlegen einer manuellen Rechnung
          lässt sich der Empfänger direkt dort merken.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-maja-navy/10">
            {liste.map((m) => {
              const e = entwurfAusGespeichertem(m);
              const ort = plzOrt(e);
              return (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-maja-ink">{anzeigeName(e)}</div>
                    <div className="text-xs text-maja-muted">
                      {[nameZeile(e), e.strasse, ort, e.land, e.email]
                        .filter((x) => x && x.trim())
                        .join(' · ') || 'Keine weiteren Angaben'}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      className="btn-secondary px-3 py-1.5 text-sm"
                      onClick={() => bearbeiten(m)}
                    >
                      Bearbeiten
                    </button>
                    <button
                      type="button"
                      className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                      onClick={() => setLoeschId(m.id)}
                    >
                      Löschen
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {loeschId && (
        <ConfirmDialog
          title="Empfänger löschen?"
          message={
            'Der Eintrag wird nur aus dieser Merkliste entfernt. Bereits '
            + 'ausgestellte Rechnungen und Gutschriften behalten ihre '
            + 'Empfängerdaten unverändert.'
          }
          confirmLabel="Löschen"
          onConfirm={async () => { await loeschen(loeschId); }}
          onClose={() => setLoeschId(null)}
        />
      )}
    </div>
  );
}
