// Pflege der Adress-Kombinationen (Migration 097).
//
// Die Zuordnung Straße → PLZ → Ort entsteht automatisch aus dem, was
// eingetragen wird. Damit sammeln sich hier dieselben Tippfehler an wie
// im Vorschlags-Pool — und sie wirken doppelt, weil eine Kombination
// beim Auswählen gleich drei Felder füllt. Deshalb dieselben
// Werkzeuge: suchen, bearbeiten, einzeln und gesammelt löschen.
//
// Sortiert wird alphabetisch nach Straße, aus demselben Grund wie beim
// Pool: nur so stehen ähnliche Schreibweisen untereinander. Das
// Eingabe-Dropdown bleibt bei „häufigste zuerst".

import { useCallback, useEffect, useMemo, useState } from 'react';
import { XIcon } from '../../components/icons';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useTestGuard } from '../../auth/TestModeContext';
import {
  aktualisiereKombination, ladeAlleKombinationen, loescheKombinationen,
  type AdressKombination,
} from '../../lib/adressKombinationen';
import { vergleichsSchluessel } from '../../lib/textNormalisierung';
import { formatDate } from '../../lib/touren';

const SICHTBAR_SCHRITT = 300;

interface Entwurf { strasse: string; plz: string; ort: string }

export function AdressKombinationenSektion() {
  const guard = useTestGuard();
  const [alle, setAlle] = useState<AdressKombination[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [suche, setSuche] = useState('');
  const [nurMehrdeutige, setNurMehrdeutige] = useState(false);
  const [gewaehlt, setGewaehlt] = useState<Set<string>>(new Set());
  const [sammelLoeschen, setSammelLoeschen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [sichtbar, setSichtbar] = useState(SICHTBAR_SCHRITT);
  const [bearbeiteId, setBearbeiteId] = useState<string | null>(null);
  const [entwurf, setEntwurf] = useState<Entwurf>({ strasse: '', plz: '', ort: '' });

  const laden = useCallback(async () => {
    try {
      setAlle(await ladeAlleKombinationen());
      setFehler(null);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => { void laden(); }, 0);
    return () => window.clearTimeout(t);
  }, [laden]);

  /** Straßen, zu denen es mehr als eine Kombination gibt. */
  const mehrdeutig = useMemo(() => {
    const zaehler = new Map<string, number>();
    for (const k of alle) {
      const key = vergleichsSchluessel(k.strasse);
      zaehler.set(key, (zaehler.get(key) ?? 0) + 1);
    }
    return zaehler;
  }, [alle]);

  const gefiltert = useMemo(() => {
    const q = suche.trim().toLowerCase();
    const liste = alle.filter((k) => {
      if (nurMehrdeutige && (mehrdeutig.get(vergleichsSchluessel(k.strasse)) ?? 0) < 2) {
        return false;
      }
      if (!q) return true;
      return `${k.strasse} ${k.plz ?? ''} ${k.ort ?? ''}`.toLowerCase().includes(q);
    });
    return [...liste].sort((a, b) =>
      a.strasse.localeCompare(b.strasse, 'de', { sensitivity: 'base' })
      || (a.plz ?? '').localeCompare(b.plz ?? ''));
  }, [alle, mehrdeutig, nurMehrdeutige, suche]);

  const angezeigt = gefiltert.slice(0, sichtbar);
  const alleGewaehlt = angezeigt.length > 0 && angezeigt.every((k) => gewaehlt.has(k.id));

  function umschalten(id: string) {
    setGewaehlt((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function alleUmschalten() {
    setGewaehlt((cur) => {
      const next = new Set(cur);
      if (alleGewaehlt) for (const k of angezeigt) next.delete(k.id);
      else for (const k of angezeigt) next.add(k.id);
      return next;
    });
  }

  async function entfernen(ids: string[]) {
    if (guard('Testmodus — Kombinationen werden nicht gelöscht.')) return;
    setBusy('loeschen');
    setFehler(null);
    try {
      const n = await loescheKombinationen(ids);
      const weg = new Set(ids);
      setAlle((cur) => cur.filter((k) => !weg.has(k.id)));
      setGewaehlt(new Set());
      setHinweis(`${n} ${n === 1 ? 'Kombination' : 'Kombinationen'} gelöscht.`);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Löschen fehlgeschlagen');
    } finally {
      setBusy(null);
      setSammelLoeschen(false);
    }
  }

  async function speichern(k: AdressKombination) {
    if (guard()) return;
    setBusy(k.id);
    const res = await aktualisiereKombination(k.id, entwurf);
    setBusy(null);
    if (!res.ok) { setFehler(res.fehler ?? 'Speichern fehlgeschlagen'); return; }
    setFehler(null);
    setBearbeiteId(null);
    await laden();
  }

  if (loading) {
    return (
      <section className="card p-5">
        <h2 className="text-sm font-semibold text-maja-navy">Adress-Kombinationen</h2>
        <p className="mt-2 text-xs text-maja-muted">Wird geladen …</p>
      </section>
    );
  }

  const mehrdeutigeAnzahl = alle.filter(
    (k) => (mehrdeutig.get(vergleichsSchluessel(k.strasse)) ?? 0) >= 2,
  ).length;

  return (
    <section className="card space-y-3 p-5">
      <div>
        <h2 className="text-sm font-semibold text-maja-navy">
          Adress-Kombinationen{' '}
          <span className="font-normal text-maja-muted">({alle.length})</span>
        </h2>
        <p className="mt-1 text-xs text-maja-muted">
          Welche Straße gehört zu welcher PLZ und welchem Ort? Wird
          automatisch aus Touren und Formularen gesammelt und füllt bei der
          Auswahl einer Straße alle drei Adressfelder gemeinsam. Gibt es zu
          einer Straße mehrere Orte, erscheinen sie einzeln zur Auswahl.
        </p>
      </div>

      {fehler && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</div>
      )}
      {hinweis && (
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{hinweis}</div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input
          className="input max-w-sm"
          placeholder="Suchen (Straße, PLZ oder Ort) …"
          value={suche}
          onChange={(e) => { setSuche(e.target.value); setSichtbar(SICHTBAR_SCHRITT); }}
        />
        <label className="flex items-center gap-2 text-xs text-maja-ink">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
            checked={nurMehrdeutige}
            onChange={(e) => { setNurMehrdeutige(e.target.checked); setSichtbar(SICHTBAR_SCHRITT); }}
          />
          Nur Straßen mit mehreren Orten ({mehrdeutigeAnzahl})
        </label>
        <span className="text-xs text-maja-muted">{gefiltert.length} angezeigt</span>
        {gewaehlt.size > 0 && (
          <button
            type="button"
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
            disabled={busy !== null}
            onClick={() => setSammelLoeschen(true)}
          >
            {gewaehlt.size} ausgewählte löschen
          </button>
        )}
      </div>

      {gefiltert.length === 0 ? (
        <p className="text-sm text-maja-muted">
          {alle.length === 0
            ? 'Noch keine Kombinationen gesammelt. Sie entstehen, sobald eine '
              + 'Tour oder ein Formular mit vollständiger Adresse gespeichert wird.'
            : 'Keine Treffer.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-maja-navy/10">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-maja-navy/10 text-left text-xs uppercase tracking-wide text-maja-muted">
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                    aria-label="Alle angezeigten auswählen"
                    checked={alleGewaehlt}
                    onChange={alleUmschalten}
                  />
                </th>
                <th className="px-3 py-2">Straße</th>
                <th className="w-24 px-3 py-2">PLZ</th>
                <th className="px-3 py-2">Ort</th>
                <th className="w-20 px-3 py-2 text-right">Anzahl</th>
                <th className="w-32 px-3 py-2">Zuletzt</th>
                <th className="w-28 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {angezeigt.map((k) => {
                const mehrere = (mehrdeutig.get(vergleichsSchluessel(k.strasse)) ?? 0) >= 2;
                const bearbeitet = bearbeiteId === k.id;
                return (
                  <tr key={k.id} className="border-b border-maja-navy/5 last:border-b-0">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                        aria-label={`„${k.strasse}" auswählen`}
                        checked={gewaehlt.has(k.id)}
                        onChange={() => umschalten(k.id)}
                      />
                    </td>
                    {bearbeitet ? (
                      <>
                        <td className="px-3 py-2">
                          <input className="input" value={entwurf.strasse}
                                 aria-label="Straße"
                                 onChange={(e) => setEntwurf({ ...entwurf, strasse: e.target.value })} />
                        </td>
                        <td className="px-3 py-2">
                          <input className="input" value={entwurf.plz}
                                 aria-label="PLZ" inputMode="numeric"
                                 onChange={(e) => setEntwurf({ ...entwurf, plz: e.target.value })} />
                        </td>
                        <td className="px-3 py-2">
                          <input className="input" value={entwurf.ort}
                                 aria-label="Ort"
                                 onChange={(e) => setEntwurf({ ...entwurf, ort: e.target.value })} />
                        </td>
                        <td colSpan={2} className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            <button type="button" className="btn-primary px-3 py-1.5 text-sm"
                                    disabled={busy !== null}
                                    onClick={() => void speichern(k)}>
                              Speichern
                            </button>
                            <button type="button" className="btn-secondary px-3 py-1.5 text-sm"
                                    onClick={() => setBearbeiteId(null)}>
                              Abbrechen
                            </button>
                          </div>
                        </td>
                        <td />
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-maja-ink">
                          {k.strasse}
                          {mehrere && (
                            <span
                              className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-900 dark:!bg-amber-900 dark:!text-amber-100"
                              title="Diese Straße kommt in mehreren Orten vor"
                            >
                              mehrere Orte
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-maja-muted">{k.plz ?? '—'}</td>
                        <td className="px-3 py-2 text-maja-ink">{k.ort ?? '—'}</td>
                        <td className="px-3 py-2 text-right text-maja-muted">{k.anzahl ?? 0}</td>
                        <td className="px-3 py-2 text-xs text-maja-muted">
                          {k.letzte_nutzung ? formatDate(k.letzte_nutzung) : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              className="rounded-md px-2 py-1 text-xs font-medium text-maja-accent hover:bg-maja-light"
                              onClick={() => {
                                setBearbeiteId(k.id);
                                setEntwurf({
                                  strasse: k.strasse, plz: k.plz ?? '', ort: k.ort ?? '',
                                });
                              }}
                            >
                              Bearbeiten
                            </button>
                            <button
                              type="button"
                              className="rounded-md p-1 text-red-600 hover:bg-red-50"
                              title="Kombination löschen"
                              aria-label={`„${k.strasse}" löschen`}
                              disabled={busy !== null}
                              onClick={() => void entfernen([k.id])}
                            >
                              <XIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {gefiltert.length > angezeigt.length && (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setSichtbar((n) => n + SICHTBAR_SCHRITT)}
        >
          Weitere {Math.min(SICHTBAR_SCHRITT, gefiltert.length - angezeigt.length)} anzeigen
        </button>
      )}

      {sammelLoeschen && (
        <ConfirmDialog
          title={`${gewaehlt.size} ${gewaehlt.size === 1 ? 'Kombination' : 'Kombinationen'} löschen?`}
          message="Die Zuordnung Straße → PLZ → Ort wird entfernt. Der Vorschlags-Pool bleibt unverändert; Touren und Formulare sowieso."
          confirmLabel="Löschen"
          destructive
          onConfirm={async () => { await entfernen([...gewaehlt]); }}
          onClose={() => setSammelLoeschen(false)}
        />
      )}
    </section>
  );
}
