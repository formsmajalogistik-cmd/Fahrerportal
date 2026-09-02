// Pflege des Vorschlags-Pools (Migration 077, Adress-Beschränkung 095).
//
// Der Pool enthält ausschließlich ADRESSTEILE: Straße, PLZ, Ort.
// Kennzeichen, Modelle, E-Mails und Namen werden weder gesammelt noch
// angeboten — Alt-Einträge lassen sich hier über den Filter „Sonstige"
// finden und löschen.
//
// Löschen ist per RLS auf Admins beschränkt; Test-Profile sehen die
// Liste, das Löschen läuft dann ins Leere und wird zusätzlich im Client
// geblockt.
//
// Die Liste wird seitenweise geladen (siehe ladeAlleVorschlaege) — ohne
// das schnitt der Server bei seiner Zeilen-Obergrenze ab, und weil nach
// `feld_typ` sortiert wird, fiel dabei ausgerechnet `adresse_strasse`
// heraus. Genau deshalb waren hier lange nur PLZ und Orte zu sehen.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Spinner } from '../../components/Spinner';
import { XIcon } from '../../components/icons';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useTestGuard } from '../../auth/TestModeContext';
import {
  aktualisiereVorschlag, istGesamtadresse, ladeAlleVorschlaege, legeVorschlagAn,
  loescheVorschlag, loescheVorschlaege, type FeldVorschlag,
} from '../../lib/feldVorschlaege';
import { formatDate } from '../../lib/touren';
import { AdressbuchSektion } from './AdressbuchSektion';
import { AdressPoolBereinigen } from '../../components/AdressPoolBereinigen';

type Filter = 'alle' | 'strasse' | 'plz' | 'stadt' | 'sonstige' | 'gesamtadressen';

const FILTER: Array<{ id: Filter; label: string }> = [
  { id: 'alle', label: 'Alle' },
  { id: 'strasse', label: 'Straße' },
  { id: 'plz', label: 'PLZ' },
  { id: 'stadt', label: 'Ort' },
  { id: 'sonstige', label: 'Sonstige' },
  { id: 'gesamtadressen', label: 'Ganze Adressen' },
];

/** Wie viele Zeilen auf einmal gerendert werden — bei ein paar tausend
 *  Einträgen wäre die Seite sonst spürbar träge. */
const SICHTBAR_SCHRITT = 300;

function istStrasse(typ: string): boolean {
  return typ === 'adresse_strasse' || typ.endsWith('_strasse');
}

function passtZuFilter(v: FeldVorschlag, f: Filter): boolean {
  const t = v.feld_typ.toLowerCase();
  switch (f) {
    case 'alle': return true;
    case 'strasse': return istStrasse(t);
    case 'plz': return t === 'adresse_plz' || t.endsWith('_plz');
    case 'stadt': return t === 'adresse_stadt' || t.endsWith('_stadt');
    case 'sonstige':
      return !istStrasse(t)
        && !(t === 'adresse_plz' || t.endsWith('_plz'))
        && !(t === 'adresse_stadt' || t.endsWith('_stadt'));
    // Straßen-Einträge, die in Wahrheit eine ganze Adresse sind.
    case 'gesamtadressen': return istStrasse(t) && istGesamtadresse(v.wert);
    default: return true;
  }
}

export function FeldVorschlaegePage() {
  const guard = useTestGuard();
  const [alle, setAlle] = useState<FeldVorschlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [suche, setSuche] = useState('');
  const [filter, setFilter] = useState<Filter>('alle');
  const [busy, setBusy] = useState<string | null>(null);
  const [neuTyp, setNeuTyp] = useState('adresse_strasse');
  const [neuWert, setNeuWert] = useState('');
  const [gewaehlt, setGewaehlt] = useState<Set<string>>(new Set());
  const [sammelLoeschen, setSammelLoeschen] = useState(false);
  const [sichtbar, setSichtbar] = useState(SICHTBAR_SCHRITT);
  /** Zeile, die gerade bearbeitet wird (Tippfehler korrigieren). */
  const [bearbeiteId, setBearbeiteId] = useState<string | null>(null);
  const [bearbeitetWert, setBearbeitetWert] = useState('');

  const load = useCallback(async () => {
    try {
      const list = await ladeAlleVorschlaege();
      setAlle(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred, damit kein synchrones setState im Effect-Body steht.
    const t = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const gefiltert = useMemo(() => {
    const q = suche.trim().toLowerCase();
    return alle.filter((v) => {
      if (!passtZuFilter(v, filter)) return false;
      if (!q) return true;
      return v.wert.toLowerCase().includes(q) || v.feld_typ.toLowerCase().includes(q);
    });
  }, [alle, filter, suche]);

  /** Zähler je Filter — zeigt sofort, wo noch aufzuräumen ist. */
  const anzahlJeFilter = useMemo(() => {
    const m = new Map<Filter, number>();
    for (const f of FILTER) m.set(f.id, alle.filter((v) => passtZuFilter(v, f.id)).length);
    return m;
  }, [alle]);

  const angezeigt = gefiltert.slice(0, sichtbar);
  const alleAngezeigtGewaehlt = angezeigt.length > 0
    && angezeigt.every((v) => gewaehlt.has(v.id));

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
      if (alleAngezeigtGewaehlt) for (const v of angezeigt) next.delete(v.id);
      else for (const v of angezeigt) next.add(v.id);
      return next;
    });
  }

  async function anlegen() {
    if (guard()) return;
    setBusy('neu');
    const res = await legeVorschlagAn(neuTyp, neuWert);
    setBusy(null);
    if (!res.ok) { setError(res.fehler ?? 'Anlegen fehlgeschlagen'); return; }
    setError(null);
    setNeuWert('');
    await load();
  }

  async function entfernen(v: FeldVorschlag) {
    if (guard('Testmodus — Vorschläge werden nicht gelöscht.')) return;
    setBusy(v.id);
    setError(null);
    try {
      await loescheVorschlag(v.id);
      setAlle((cur) => cur.filter((x) => x.id !== v.id));
      setGewaehlt((cur) => { const n = new Set(cur); n.delete(v.id); return n; });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen');
    } finally {
      setBusy(null);
    }
  }

  async function auswahlLoeschen() {
    if (guard('Testmodus — Vorschläge werden nicht gelöscht.')) return;
    const ids = [...gewaehlt];
    setBusy('sammel');
    setError(null);
    try {
      const n = await loescheVorschlaege(ids);
      setAlle((cur) => cur.filter((x) => !gewaehlt.has(x.id)));
      setGewaehlt(new Set());
      setHinweis(`${n} ${n === 1 ? 'Eintrag' : 'Einträge'} gelöscht.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen');
    } finally {
      setBusy(null);
      setSammelLoeschen(false);
    }
  }

  async function bearbeitungSpeichern(v: FeldVorschlag) {
    if (guard()) return;
    setBusy(v.id);
    const res = await aktualisiereVorschlag(v.id, bearbeitetWert, v.feld_typ);
    setBusy(null);
    if (!res.ok) { setError(res.fehler ?? 'Speichern fehlgeschlagen'); return; }
    setError(null);
    setBearbeiteId(null);
    await load();
  }

  if (loading) return <Spinner />;

  return (
    <div className="space-y-8">
      {/* Adressen zuerst — das ist der Teil, den man von Hand pflegt. */}
      <AdressbuchSektion />

      <div className="space-y-4 border-t border-maja-navy/10 pt-6">
        <div>
          <h2 className="text-lg font-semibold text-maja-navy">Gesammelte Werte</h2>
          <p className="text-sm text-maja-muted">
            Adressteile, die beim Ausfüllen von Formularen und beim Anlegen
            von Touren gesammelt wurden und als Vorschlag angeboten werden.
            Es gibt nur noch die Töpfe Straße, PLZ und Ort — Einträge unter
            „Sonstige" stammen aus der Zeit davor und können gelöscht
            werden. Auftraggeber-Konten haben keinen Zugriff auf diese Liste.
          </p>
        </div>

        <AdressPoolBereinigen onFertig={() => { void load(); }} />

        {/* Manuellen Wert ergänzen — z.B. eine korrekte Schreibweise
            vorgeben, bevor sie zum ersten Mal getippt wird. */}
        <div className="card flex flex-wrap items-end gap-3 p-4">
          <div>
            <label htmlFor="fv-neu-typ" className="label">Topf</label>
            <select id="fv-neu-typ" className="input"
                    value={neuTyp} onChange={(e) => setNeuTyp(e.target.value)}>
              <option value="adresse_strasse">Straße</option>
              <option value="adresse_plz">PLZ</option>
              <option value="adresse_stadt">Ort</option>
            </select>
          </div>
          <div className="min-w-[12rem] flex-1">
            <label htmlFor="fv-neu-wert" className="label">Wert</label>
            <input id="fv-neu-wert" className="input"
                   value={neuWert} onChange={(e) => setNeuWert(e.target.value)} />
          </div>
          <button
            type="button" className="btn-primary"
            disabled={busy !== null || !neuWert.trim()}
            onClick={() => void anlegen()}
          >
            Hinzufügen
          </button>
        </div>

        {/* Filter + Suche */}
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {FILTER.map((f) => {
              const n = anzahlJeFilter.get(f.id) ?? 0;
              const aktiv = filter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => { setFilter(f.id); setSichtbar(SICHTBAR_SCHRITT); }}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                    aktiv
                      ? 'bg-maja-navy text-white dark:bg-blue-600'
                      : 'bg-maja-light text-maja-navy hover:bg-maja-navy/10 dark:bg-surface-700 dark:text-slate-200'
                  }`}
                >
                  {f.label}
                  <span className={aktiv ? 'ml-1.5 opacity-80' : 'ml-1.5 text-maja-muted'}>{n}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input
              className="input max-w-sm"
              placeholder="Suchen (Wert oder Topf) …"
              value={suche}
              onChange={(e) => { setSuche(e.target.value); setSichtbar(SICHTBAR_SCHRITT); }}
            />
            <span className="text-xs text-maja-muted">
              {gefiltert.length} von {alle.length} Einträgen
            </span>
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
        </div>

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {hinweis && (
          <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{hinweis}</div>
        )}

        {filter === 'gesamtadressen' && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Diese Straßen-Einträge enthalten eine PLZ und sind damit ganze
            Adressen. Beim Auswählen landen sie vollständig im Straßenfeld —
            sie gehören gelöscht. Neue Werte dieser Art werden gar nicht mehr
            gesammelt.
          </p>
        )}

        {gefiltert.length === 0 ? (
          <p className="text-sm text-maja-muted">
            {alle.length === 0
              ? 'Noch keine Vorschläge gesammelt.'
              : 'Keine Treffer für diesen Filter.'}
          </p>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-maja-navy/10 text-left text-xs uppercase tracking-wide text-maja-muted">
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                      aria-label="Alle angezeigten auswählen"
                      checked={alleAngezeigtGewaehlt}
                      onChange={alleUmschalten}
                    />
                  </th>
                  <th className="px-3 py-2">Wert</th>
                  <th className="w-36 px-3 py-2">Topf</th>
                  <th className="w-20 px-3 py-2 text-right">Anzahl</th>
                  <th className="w-32 px-3 py-2">Zuletzt</th>
                  <th className="w-28 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {angezeigt.map((v) => (
                  <tr key={v.id} className="border-b border-maja-navy/5 last:border-b-0">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                        aria-label={`„${v.wert}" auswählen`}
                        checked={gewaehlt.has(v.id)}
                        onChange={() => umschalten(v.id)}
                      />
                    </td>
                    <td className="px-3 py-2 text-maja-ink">
                      {bearbeiteId === v.id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            className="input flex-1"
                            value={bearbeitetWert}
                            onChange={(e) => setBearbeitetWert(e.target.value)}
                          />
                          <button type="button" className="btn-primary px-3 py-1.5 text-sm"
                                  disabled={busy !== null}
                                  onClick={() => void bearbeitungSpeichern(v)}>
                            Speichern
                          </button>
                          <button type="button" className="btn-secondary px-3 py-1.5 text-sm"
                                  onClick={() => setBearbeiteId(null)}>
                            Abbrechen
                          </button>
                        </div>
                      ) : (
                        <>
                          {v.ist_manuell && (
                            <span className="mr-1 font-semibold text-maja-accent" title="Manuell gepflegt">✎</span>
                          )}
                          {v.wert}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-maja-muted">{v.feld_typ}</td>
                    <td className="px-3 py-2 text-right text-maja-muted">
                      {v.ist_manuell ? '—' : v.anzahl}
                    </td>
                    <td className="px-3 py-2 text-xs text-maja-muted">
                      {formatDate(v.letzte_nutzung)}
                    </td>
                    <td className="px-3 py-2">
                      {bearbeiteId !== v.id && (
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            className="rounded-md px-2 py-1 text-xs font-medium text-maja-accent hover:bg-maja-light"
                            onClick={() => { setBearbeiteId(v.id); setBearbeitetWert(v.wert); }}
                          >
                            Bearbeiten
                          </button>
                          <button
                            type="button"
                            className="rounded-md p-1 text-red-600 hover:bg-red-50"
                            title="Vorschlag löschen"
                            aria-label={`„${v.wert}" löschen`}
                            disabled={busy !== null}
                            onClick={() => void entfernen(v)}
                          >
                            <XIcon className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
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
      </div>

      {sammelLoeschen && (
        <ConfirmDialog
          title={`${gewaehlt.size} ${gewaehlt.size === 1 ? 'Eintrag' : 'Einträge'} löschen?`}
          message="Die Werte werden aus dem Vorschlags-Pool entfernt. Formulare und Touren bleiben unverändert — es verschwinden nur die Vorschläge."
          confirmLabel="Löschen"
          destructive
          onConfirm={async () => { await auswahlLoeschen(); }}
          onClose={() => setSammelLoeschen(false)}
        />
      )}
    </div>
  );
}
