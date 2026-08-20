// Pflege des Vorschlags-Pools (Migration 077).
//
// Tippfehler und Einmal-Eingaben sammeln sich mit der Zeit an — hier kann
// der Admin sie je Topf (`feld_typ`) durchsehen und löschen. Löschen ist
// per RLS auf Admins beschränkt; Test-Profile sehen die Liste, das Löschen
// läuft dann ins Leere und wird zusätzlich im Client geblockt.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Spinner } from '../../components/Spinner';
import { XIcon } from '../../components/icons';
import { useTestGuard } from '../../auth/TestModeContext';
import {
  ladeAlleVorschlaege, legeVorschlagAn, loescheVorschlag, type FeldVorschlag,
} from '../../lib/feldVorschlaege';
import { AdressbuchSektion } from './AdressbuchSektion';

export function FeldVorschlaegePage() {
  const guard = useTestGuard();
  const [alle, setAlle] = useState<FeldVorschlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suche, setSuche] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [neuTyp, setNeuTyp] = useState('');
  const [neuWert, setNeuWert] = useState('');

  async function anlegen() {
    if (guard()) return;
    setBusy('neu');
    const res = await legeVorschlagAn(neuTyp, neuWert);
    setBusy(null);
    if (!res.ok) { setError(res.fehler ?? 'Anlegen fehlgeschlagen'); return; }
    setError(null);
    setNeuTyp(''); setNeuWert('');
    await load();
  }

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

  const gruppen = useMemo(() => {
    const q = suche.trim().toLowerCase();
    const map = new Map<string, FeldVorschlag[]>();
    for (const v of alle) {
      if (q && !v.wert.toLowerCase().includes(q) && !v.feld_typ.toLowerCase().includes(q)) continue;
      const list = map.get(v.feld_typ);
      if (list) list.push(v);
      else map.set(v.feld_typ, [v]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'de'));
  }, [alle, suche]);

  async function entfernen(v: FeldVorschlag) {
    if (guard('Testmodus — Vorschläge werden nicht gelöscht.')) return;
    if (!confirm(`Vorschlag „${v.wert}" wirklich löschen?`)) return;
    setBusy(v.id);
    setError(null);
    try {
      await loescheVorschlag(v.id);
      setAlle((cur) => cur.filter((x) => x.id !== v.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen');
    } finally {
      setBusy(null);
    }
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
          Werte, die beim Ausfüllen von Formularen gesammelt wurden und den
          Fahrern als Vorschlag angeboten werden. Adress-, PLZ-, Orts-,
          E-Mail-, Kontakt- und Fahrzeugfelder sammeln automatisch; im
          Template lässt sich das je Feld gezielt an- oder abschalten.
          Auftraggeber-Konten haben keinen Zugriff auf diese Liste.
        </p>
      </div>

      {/* Manuellen Wert ergänzen — z.B. eine korrekte Schreibweise
          vorgeben, bevor sie zum ersten Mal getippt wird. */}
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label htmlFor="fv-neu-typ" className="label">Topf</label>
          <input id="fv-neu-typ" className="input" list="fv-toepfe"
                 placeholder="z.B. kontaktname"
                 value={neuTyp} onChange={(e) => setNeuTyp(e.target.value)} />
          <datalist id="fv-toepfe">
            {[...new Set(alle.map((v) => v.feld_typ))].map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
        <div className="min-w-[12rem] flex-1">
          <label htmlFor="fv-neu-wert" className="label">Wert</label>
          <input id="fv-neu-wert" className="input"
                 value={neuWert} onChange={(e) => setNeuWert(e.target.value)} />
        </div>
        <button
          type="button" className="btn-primary"
          disabled={busy !== null}
          onClick={() => void anlegen()}
        >
          Hinzufügen
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          className="input max-w-sm"
          placeholder="Suchen (Wert oder Topf) …"
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
        />
        <span className="text-xs text-maja-muted">
          {alle.length} {alle.length === 1 ? 'Eintrag' : 'Einträge'} in{' '}
          {new Set(alle.map((v) => v.feld_typ)).size} Töpfen
        </span>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {gruppen.length === 0 ? (
        <p className="text-sm text-maja-muted">
          {alle.length === 0
            ? 'Noch keine Vorschläge gesammelt.'
            : 'Keine Treffer für diese Suche.'}
        </p>
      ) : (
        <div className="space-y-4">
          {gruppen.map(([typ, werte]) => (
            <section key={typ} className="card p-4">
              <header className="mb-2 flex items-baseline gap-2">
                <h3 className="font-mono text-sm font-semibold text-maja-navy">{typ}</h3>
                <span className="text-xs text-maja-muted">
                  {werte.length} {werte.length === 1 ? 'Wert' : 'Werte'}
                </span>
              </header>
              <ul className="flex flex-wrap gap-2">
                {werte.map((v) => (
                  <li
                    key={v.id}
                    className="inline-flex items-stretch overflow-hidden rounded-full border border-slate-300 bg-maja-light text-xs text-maja-navy dark:border-slate-600 dark:bg-surface-700"
                  >
                    <span
                      className="px-2.5 py-1"
                      title={v.ist_manuell
                        ? 'Manuell gepflegt — wird zuerst vorgeschlagen'
                        : `${v.anzahl}× genutzt`}
                    >
                      {v.ist_manuell && (
                        <span className="mr-1 font-semibold text-maja-accent">✎</span>
                      )}
                      {v.wert}
                      <span className="ml-1.5 text-maja-muted">
                        {v.ist_manuell ? 'manuell' : `${v.anzahl}×`}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="flex items-center border-l border-slate-300 px-2 py-1 text-red-600 hover:bg-red-50 dark:border-slate-600"
                      title="Vorschlag löschen"
                      aria-label={`„${v.wert}" löschen`}
                      disabled={busy !== null}
                      onClick={() => void entfernen(v)}
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
