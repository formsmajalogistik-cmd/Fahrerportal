// Adressverwaltung: Vorschlags-Pool (077 / 095) und Kombinationen (097).
//
// Aufbau der Seite, und der ist Absicht: Suche, Filter und Aktionen
// stehen GANZ OBEN und bleiben beim Scrollen stehen; die Liste läuft
// darunter in ihrem eigenen Scroll-Bereich. Vorher lag die Liste oben
// und man musste an ihr vorbeiscrollen, um überhaupt filtern zu können.
//
// Der Pool enthält ausschließlich ADRESSTEILE: Straße, PLZ, Ort.
// Kennzeichen, Modelle, E-Mails und Namen werden weder gesammelt noch
// angeboten — Alt-Einträge finden sich über den Filter „Sonstige".
//
// Die Kombinationen (Straße → PLZ → Ort) sind ein eigener Filter statt
// einer zweiten Sektion: es ist dieselbe Aufräumarbeit mit denselben
// Werkzeugen, nur eine andere Tabelle.
//
// Beide Listen werden seitenweise geladen — ohne das schneidet der
// Server bei seiner Zeilen-Obergrenze ab, und weil nach `feld_typ`
// sortiert wird, fiel dabei ausgerechnet `adresse_strasse` heraus.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Spinner } from '../../components/Spinner';
import { XIcon } from '../../components/icons';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useTestGuard } from '../../auth/TestModeContext';
import {
  aktualisiereVorschlag, istGesamtadresse, ladeAlleVorschlaege, legeVorschlagAn,
  loescheVorschlag, loescheVorschlaege, type FeldVorschlag,
} from '../../lib/feldVorschlaege';
import {
  ladeAlleKombinationen, loescheKombinationen, type AdressKombination,
} from '../../lib/adressKombinationen';
import { vergleichsSchluessel } from '../../lib/textNormalisierung';
import { formatDate } from '../../lib/touren';
import { AdressbuchSektion } from './AdressbuchSektion';
import { AdressPoolBereinigen } from '../../components/AdressPoolBereinigen';
import { AdressKombinationenTabelle } from './AdressKombinationenTabelle';

type Filter =
  | 'alle' | 'strasse' | 'plz' | 'stadt' | 'sonstige' | 'gesamtadressen'
  | 'kombinationen';

const FILTER: Array<{ id: Filter; label: string }> = [
  { id: 'alle', label: 'Alle' },
  { id: 'strasse', label: 'Straße' },
  { id: 'plz', label: 'PLZ' },
  { id: 'stadt', label: 'Ort' },
  { id: 'sonstige', label: 'Sonstige' },
  { id: 'gesamtadressen', label: 'Ganze Adressen' },
  { id: 'kombinationen', label: 'Kombinationen' },
];

/**
 * Sortierung der VERWALTUNGSANSICHT. Default ist das Alphabet: nur so
 * stehen ähnliche Schreibweisen direkt untereinander und Tippfehler
 * fallen auf.
 *
 * Das Eingabe-Dropdown sortiert weiterhin nach Relevanz (häufigste
 * zuerst, dann zuletzt genutzt) — siehe ladeVorschlaege(). Dort ist
 * Relevanz hilfreicher als das Alphabet.
 */
type Sortierung = 'alphabet' | 'haeufigkeit' | 'zuletzt';

const SORTIERUNGEN: Array<{ id: Sortierung; label: string }> = [
  { id: 'alphabet', label: 'A–Z' },
  { id: 'haeufigkeit', label: 'Häufigkeit' },
  { id: 'zuletzt', label: 'Zuletzt genutzt' },
];

/** Wie viele Zeilen auf einmal gerendert werden — bei ein paar tausend
 *  Einträgen wäre die Seite sonst spürbar träge. */
const SICHTBAR_SCHRITT = 300;

const deVergleich = (a: string, b: string) =>
  a.localeCompare(b, 'de', { sensitivity: 'base' });

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
    default: return false;
  }
}

export function FeldVorschlaegePage() {
  const guard = useTestGuard();
  const [alle, setAlle] = useState<FeldVorschlag[]>([]);
  const [kombis, setKombis] = useState<AdressKombination[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [suche, setSuche] = useState('');
  const [filter, setFilter] = useState<Filter>('alle');
  const [sortierung, setSortierung] = useState<Sortierung>('alphabet');
  const [busy, setBusy] = useState<string | null>(null);
  const [neuTyp, setNeuTyp] = useState('adresse_strasse');
  const [neuWert, setNeuWert] = useState('');
  const [gewaehlt, setGewaehlt] = useState<Set<string>>(new Set());
  const [sammelLoeschen, setSammelLoeschen] = useState(false);
  const [sichtbar, setSichtbar] = useState(SICHTBAR_SCHRITT);
  /** Zeile, die gerade bearbeitet wird (Tippfehler korrigieren). */
  const [bearbeiteId, setBearbeiteId] = useState<string | null>(null);
  const [bearbeitetWert, setBearbeitetWert] = useState('');

  const istKombiAnsicht = filter === 'kombinationen';

  const load = useCallback(async () => {
    try {
      const [pool, kombiListe] = await Promise.all([
        ladeAlleVorschlaege(),
        ladeAlleKombinationen(),
      ]);
      setAlle(pool);
      setKombis(kombiListe);
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

  /** Straßen, zu denen es mehr als eine Kombination gibt. */
  const mehrdeutig = useMemo(() => {
    const zaehler = new Map<string, number>();
    for (const k of kombis) {
      const key = vergleichsSchluessel(k.strasse);
      zaehler.set(key, (zaehler.get(key) ?? 0) + 1);
    }
    return zaehler;
  }, [kombis]);

  // ---- Pool: filtern + sortieren ----
  const poolGefiltert = useMemo(() => {
    const q = suche.trim().toLowerCase();
    const liste = alle.filter((v) => {
      if (!passtZuFilter(v, filter)) return false;
      if (!q) return true;
      return v.wert.toLowerCase().includes(q) || v.feld_typ.toLowerCase().includes(q);
    });
    const sortiert = [...liste];
    if (sortierung === 'alphabet') {
      // localeCompare mit 'de': Umlaute einsortiert wie erwartet
      // („Österstraße" bei O), Groß/Klein egal.
      sortiert.sort((a, b) => deVergleich(a.wert, b.wert));
    } else if (sortierung === 'haeufigkeit') {
      sortiert.sort((a, b) => b.anzahl - a.anzahl || deVergleich(a.wert, b.wert));
    } else {
      sortiert.sort((a, b) => b.letzte_nutzung.localeCompare(a.letzte_nutzung)
        || deVergleich(a.wert, b.wert));
    }
    return sortiert;
  }, [alle, filter, suche, sortierung]);

  // ---- Kombinationen: filtern + sortieren ----
  const kombiGefiltert = useMemo(() => {
    const q = suche.trim().toLowerCase();
    const liste = kombis.filter((k) => {
      if (!q) return true;
      return `${k.strasse} ${k.plz ?? ''} ${k.ort ?? ''}`.toLowerCase().includes(q);
    });
    const sortiert = [...liste];
    if (sortierung === 'alphabet') {
      sortiert.sort((a, b) => deVergleich(a.strasse, b.strasse)
        || (a.plz ?? '').localeCompare(b.plz ?? ''));
    } else if (sortierung === 'haeufigkeit') {
      sortiert.sort((a, b) => (b.anzahl ?? 0) - (a.anzahl ?? 0)
        || deVergleich(a.strasse, b.strasse));
    } else {
      sortiert.sort((a, b) => (b.letzte_nutzung ?? '').localeCompare(a.letzte_nutzung ?? '')
        || deVergleich(a.strasse, b.strasse));
    }
    return sortiert;
  }, [kombis, suche, sortierung]);

  /** Zähler je Filter — zeigt sofort, wo noch aufzuräumen ist. */
  const anzahlJeFilter = useMemo(() => {
    const m = new Map<Filter, number>();
    for (const f of FILTER) {
      m.set(f.id, f.id === 'kombinationen'
        ? kombis.length
        : alle.filter((v) => passtZuFilter(v, f.id)).length);
    }
    return m;
  }, [alle, kombis]);

  const gefiltertAnzahl = istKombiAnsicht ? kombiGefiltert.length : poolGefiltert.length;
  const gesamtAnzahl = istKombiAnsicht ? kombis.length : alle.length;
  const angezeigtPool = poolGefiltert.slice(0, sichtbar);
  const angezeigtKombi = kombiGefiltert.slice(0, sichtbar);
  const angezeigteIds = istKombiAnsicht
    ? angezeigtKombi.map((k) => k.id)
    : angezeigtPool.map((v) => v.id);
  const alleAngezeigtGewaehlt = angezeigteIds.length > 0
    && angezeigteIds.every((id) => gewaehlt.has(id));

  /** Filterwechsel: Auswahl verwerfen — sie bezöge sich auf die andere
   *  Tabelle und wäre beim Sammel-Löschen ein böser Fehler. */
  function filterSetzen(f: Filter) {
    setFilter(f);
    setSichtbar(SICHTBAR_SCHRITT);
    setGewaehlt(new Set());
    setBearbeiteId(null);
  }

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
      if (alleAngezeigtGewaehlt) for (const id of angezeigteIds) next.delete(id);
      else for (const id of angezeigteIds) next.add(id);
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

  /** Löscht in der gerade sichtbaren Tabelle — Pool oder Kombinationen. */
  async function entfernen(ids: string[]) {
    if (guard('Testmodus — es wird nichts gelöscht.')) return;
    setBusy('loeschen');
    setError(null);
    try {
      const weg = new Set(ids);
      if (istKombiAnsicht) {
        const n = await loescheKombinationen(ids);
        setKombis((cur) => cur.filter((k) => !weg.has(k.id)));
        setHinweis(`${n} ${n === 1 ? 'Kombination' : 'Kombinationen'} gelöscht.`);
      } else if (ids.length === 1) {
        await loescheVorschlag(ids[0]);
        setAlle((cur) => cur.filter((v) => !weg.has(v.id)));
        setHinweis('Eintrag gelöscht.');
      } else {
        const n = await loescheVorschlaege(ids);
        setAlle((cur) => cur.filter((v) => !weg.has(v.id)));
        setHinweis(`${n} ${n === 1 ? 'Eintrag' : 'Einträge'} gelöscht.`);
      }
      setGewaehlt((cur) => {
        const next = new Set(cur);
        for (const id of ids) next.delete(id);
        return next;
      });
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
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-maja-navy">Adressverwaltung</h2>
        <p className="text-sm text-maja-muted">
          Gesammelte Adressteile und die Zuordnung Straße → PLZ → Ort.
          Einträge unter „Sonstige" stammen aus der Zeit vor der
          Beschränkung auf Adressen und können gelöscht werden.
          Auftraggeber-Konten haben keinen Zugriff auf diese Listen.
        </p>
      </div>

      {/* ---------------- Bedienleiste ----------------
          Bleibt beim Scrollen stehen, damit Suche und Filter auch
          mitten in einer langen Liste erreichbar sind. */}
      {/* Auf dem Handy NICHT fixiert: dort füllt die Leiste fast den
          halben Bildschirm und für die Liste bliebe kaum Platz. Ab
          Tablet-Breite bleibt sie stehen. */}
      <div className="z-20 space-y-3 rounded-lg border border-maja-navy/10 bg-maja-light/95 p-3 backdrop-blur sm:sticky sm:top-0 dark:border-surface-700 dark:bg-surface-800/95">
        {/* 1 — Suche */}
        <div className="relative max-w-md">
          <input
            className="input pr-9"
            placeholder={istKombiAnsicht
              ? 'Suchen (Straße, PLZ oder Ort) …'
              : 'Suchen (Wert oder Topf) …'}
            aria-label="Adressen durchsuchen"
            value={suche}
            onChange={(e) => { setSuche(e.target.value); setSichtbar(SICHTBAR_SCHRITT); }}
          />
          {suche && (
            <button
              type="button"
              aria-label="Suche leeren"
              title="Suche leeren"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-maja-muted hover:bg-maja-navy/10"
              onClick={() => { setSuche(''); setSichtbar(SICHTBAR_SCHRITT); }}
            >
              <XIcon className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* 2 — Filter und Sortierung */}
        <div className="flex flex-wrap gap-1.5">
          {FILTER.map((f) => {
            const n = anzahlJeFilter.get(f.id) ?? 0;
            const aktiv = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => filterSetzen(f.id)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  aktiv
                    ? 'bg-maja-navy text-white dark:bg-blue-600'
                    : 'bg-white text-maja-navy hover:bg-maja-navy/10 dark:bg-surface-700 dark:text-slate-200'
                }`}
              >
                {f.label}
                <span className={aktiv ? 'ml-1.5 opacity-80' : 'ml-1.5 text-maja-muted'}>{n}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-maja-muted">Sortierung:</span>
          {SORTIERUNGEN.map((so) => (
            <button
              key={so.id}
              type="button"
              onClick={() => setSortierung(so.id)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                sortierung === so.id
                  ? 'bg-maja-navy text-white dark:bg-blue-600'
                  : 'bg-white text-maja-navy hover:bg-maja-navy/10 dark:bg-surface-700 dark:text-slate-200'
              }`}
            >
              {so.label}
            </button>
          ))}
          <span className="text-xs text-maja-muted">
            — im Eingabe-Dropdown bleibt es bei „häufigste zuerst".
          </span>
        </div>

        {/* 3 — Aktionsleiste */}
        <div className="flex flex-wrap items-center gap-3 border-t border-maja-navy/10 pt-2">
          <span className="text-xs text-maja-muted">
            {gefiltertAnzahl} von {gesamtAnzahl}{' '}
            {istKombiAnsicht ? 'Kombinationen' : 'Einträgen'}
          </span>
          {gewaehlt.size > 0 ? (
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
              disabled={busy !== null}
              onClick={() => setSammelLoeschen(true)}
            >
              {gewaehlt.size} ausgewählte löschen
            </button>
          ) : (
            <span className="text-xs text-maja-muted">
              Zeilen ankreuzen, um mehrere auf einmal zu löschen.
            </span>
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
          Adressen. Sie werden in ihre Bestandteile zerlegt: Straße, PLZ und
          Ort wandern in ihre Töpfe, die vollständige Adresse kommt ins
          Adressbuch. Neu erfasste Werte werden bereits beim Sammeln zerlegt.
        </p>
      )}
      {istKombiAnsicht && (
        <p className="text-xs text-maja-muted">
          Welche Straße gehört zu welcher PLZ und welchem Ort? Wird
          automatisch aus Touren und Formularen gesammelt und füllt bei der
          Auswahl einer Straße alle drei Adressfelder gemeinsam. Kommt eine
          Straße in mehreren Orten vor, ist sie markiert — dort lohnt der
          Blick besonders.
        </p>
      )}

      {/* ---------------- Liste ----------------
          Eigener Scroll-Bereich mit begrenzter Höhe: die Bedienleiste
          darüber bleibt dadurch immer sichtbar. */}
      {gefiltertAnzahl === 0 ? (
        <p className="text-sm text-maja-muted">
          {gesamtAnzahl === 0
            ? (istKombiAnsicht
                ? 'Noch keine Kombinationen gesammelt. Sie entstehen, sobald eine '
                  + 'Tour oder ein Formular mit vollständiger Adresse gespeichert wird.'
                : 'Noch keine Vorschläge gesammelt.')
            : 'Keine Treffer für Suche und Filter.'}
        </p>
      ) : (
        <div className="card overflow-hidden">
          <div className="max-h-[70vh] overflow-auto sm:max-h-[60vh]">
            {istKombiAnsicht ? (
              <AdressKombinationenTabelle
                zeilen={angezeigtKombi}
                mehrdeutig={mehrdeutig}
                gewaehlt={gewaehlt}
                onUmschalten={umschalten}
                onAlleUmschalten={alleUmschalten}
                alleGewaehlt={alleAngezeigtGewaehlt}
                onLoeschen={(ids) => void entfernen(ids)}
                onGeaendert={() => { void load(); }}
                busy={busy !== null}
                onFehler={setError}
              />
            ) : (
              <table className="w-full min-w-[36rem] text-sm">
                <thead className="sticky top-0 z-10 bg-white dark:bg-surface-800">
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
                  {angezeigtPool.map((v) => (
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
                              aria-label="Wert bearbeiten"
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
                              onClick={() => void entfernen([v.id])}
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
            )}
          </div>
        </div>
      )}

      {gefiltertAnzahl > angezeigteIds.length && (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setSichtbar((n) => n + SICHTBAR_SCHRITT)}
        >
          Weitere {Math.min(SICHTBAR_SCHRITT, gefiltertAnzahl - angezeigteIds.length)} anzeigen
        </button>
      )}

      {/* ---------------- Werkzeuge unterhalb der Liste ---------------- */}
      <div className="space-y-4 border-t border-maja-navy/10 pt-6">
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

        <AdressPoolBereinigen onFertig={() => { void load(); }} />

        {/* Adressbuch zuletzt — das ist der handgepflegte Teil und wird
            beim Aufräumen des Pools nicht gebraucht. */}
        <AdressbuchSektion />
      </div>

      {sammelLoeschen && (
        <ConfirmDialog
          title={`${gewaehlt.size} ${gewaehlt.size === 1 ? 'Eintrag' : 'Einträge'} löschen?`}
          message={istKombiAnsicht
            ? 'Die Zuordnung Straße → PLZ → Ort wird entfernt. Der Vorschlags-Pool bleibt unverändert; Touren und Formulare sowieso.'
            : 'Die Werte werden aus dem Vorschlags-Pool entfernt. Formulare und Touren bleiben unverändert — es verschwinden nur die Vorschläge.'}
          confirmLabel="Löschen"
          destructive
          onConfirm={async () => { await entfernen([...gewaehlt]); }}
          onClose={() => setSammelLoeschen(false)}
        />
      )}
    </div>
  );
}
