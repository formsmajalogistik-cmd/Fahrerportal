// Einstellungen → „E-Rechnungen exportieren" (nur Admin).
//
// ZIP mit den Originaldateien des Archivs (unverändert) und einer
// Übersichtsliste (CSV) für einen Zeitraum — zur Übertragung in die
// Buchhaltung bzw. auf den eigenen Server. Der Export löscht nichts.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/AuthContext';
import { useTestGuard } from '../../auth/TestModeContext';
import { formatDate } from '../../lib/touren';
import { ERECHNUNG_FORMATE } from '../../lib/erechnung/stammdaten';
import {
  dateienVon, exportiere, ladeExportListe, monatsGrenzen, type ExportEintrag, type ExportErgebnis,
} from '../../lib/erechnung/export';

const eur = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const heuteMonat = () => new Date().toISOString().slice(0, 7);
const formatName = (f: string) => (f === 'zugferd' ? 'ZUGFeRD' : ERECHNUNG_FORMATE.find((x) => x.wert === f)?.label.replace(/ \+ PDF-Lesekopie$/, '') ?? f);

export function ERechnungExportPage() {
  const { profile } = useAuth();
  const guard = useTestGuard();
  const [modus, setModus] = useState<'monat' | 'zeitraum'>('monat');
  const [monat, setMonat] = useState(heuteMonat());
  const [von, setVon] = useState(`${heuteMonat()}-01`);
  const [bis, setBis] = useState(new Date().toISOString().slice(0, 10));
  const [auftraggeberId, setAuftraggeberId] = useState('');
  const [nurNeue, setNurNeue] = useState(false);
  const [auftraggeber, setAuftraggeber] = useState<Array<{ id: string; name: string }>>([]);
  const [liste, setListe] = useState<ExportEintrag[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fortschritt, setFortschritt] = useState<{ fertig: number; gesamt: number } | null>(null);
  const [ergebnis, setErgebnis] = useState<ExportErgebnis | null>(null);

  const grenzen = useMemo(() => (modus === 'monat' ? monatsGrenzen(monat) : { von, bis }), [modus, monat, von, bis]);
  const gueltig = /^\d{4}-\d{2}-\d{2}$/.test(grenzen.von) && /^\d{4}-\d{2}-\d{2}$/.test(grenzen.bis) && grenzen.von <= grenzen.bis;

  useEffect(() => {
    let aktiv = true;
    void supabase.from('auftraggeber').select('id, name').order('name').then(({ data }) => { if (aktiv) setAuftraggeber((data ?? []) as Array<{ id: string; name: string }>); });
    return () => { aktiv = false; };
  }, []);

  const laden = useCallback(async () => {
    if (!gueltig) { setListe([]); return; }
    setFehler(null);
    try {
      setListe(await ladeExportListe({ von: grenzen.von, bis: grenzen.bis, auftraggeberId: auftraggeberId || null, nurNichtExportiert: nurNeue }));
    } catch (e) {
      setListe([]);
      setFehler(/erechnung_exporte|erechnung_dokumente|does not exist|schema cache/i.test(String(e))
        ? 'Der Export ist noch nicht eingerichtet (Migration 117 fehlt).'
        : (e instanceof Error ? e.message : String(e)));
    }
  }, [gueltig, grenzen.von, grenzen.bis, auftraggeberId, nurNeue]);

  useEffect(() => {
    const t = window.setTimeout(() => { void laden(); }, 0);
    return () => window.clearTimeout(t);
  }, [laden]);

  async function exportieren() {
    if (!liste?.length) return;
    if (guard()) return;
    setBusy(true); setErgebnis(null); setFehler(null);
    try {
      const name = [profile?.vorname, profile?.nachname].filter(Boolean).join(' ') || profile?.email || null;
      const bezeichnung = modus === 'monat' ? monat : `${grenzen.von}_bis_${grenzen.bis}`;
      const res = await exportiere(liste, bezeichnung, { benutzerName: name, onFortschritt: (fertig, gesamt) => setFortschritt({ fertig, gesamt }) });
      setErgebnis(res);
      const url = URL.createObjectURL(res.zip);
      const a = document.createElement('a');
      a.href = url; a.download = res.dateiname;
      document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      await laden();
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false); setFortschritt(null);
    }
  }

  const dateiAnzahl = (liste ?? []).reduce((s, e) => s + dateienVon(e).length, 0);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-maja-navy">E-Rechnungen exportieren</h2>
        <p className="text-sm text-maja-muted">
          Erstellt eine ZIP-Datei mit den archivierten Originaldateien (XML, PDF-Lesekopien, ZUGFeRD-PDFs — unverändert) und einer
          Übersichtsliste (CSV). Jede Datei wird vorher gegen ihren gespeicherten SHA-256 geprüft. Der Export löscht nichts.
        </p>
      </div>

      <section className="card space-y-3 p-4">
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="radio" name="exp-modus" checked={modus === 'monat'} onChange={() => setModus('monat')} /> Monat</label>
          <label className="flex items-center gap-2"><input type="radio" name="exp-modus" checked={modus === 'zeitraum'} onChange={() => setModus('zeitraum')} /> Zeitraum von–bis</label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {modus === 'monat' ? (
            <div>
              <label htmlFor="exp-monat" className="label">Monat (Belegdatum)</label>
              <input id="exp-monat" type="month" className="input" value={monat} onChange={(e) => setMonat(e.target.value)} />
            </div>
          ) : (
            <>
              <div>
                <label htmlFor="exp-von" className="label">Von (Belegdatum)</label>
                <input id="exp-von" type="date" className="input" value={von} onChange={(e) => setVon(e.target.value)} />
              </div>
              <div>
                <label htmlFor="exp-bis" className="label">Bis</label>
                <input id="exp-bis" type="date" className="input" value={bis} onChange={(e) => setBis(e.target.value)} />
              </div>
            </>
          )}
          <div>
            <label htmlFor="exp-ag" className="label">Empfänger (optional)</label>
            <select id="exp-ag" className="input" value={auftraggeberId} onChange={(e) => setAuftraggeberId(e.target.value)}>
              <option value="">Alle</option>
              {auftraggeber.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-maja-ink">
          <input type="checkbox" className="h-4 w-4 rounded border-maja-navy/30" checked={nurNeue} onChange={(e) => setNurNeue(e.target.checked)} />
          Nur noch nicht exportierte Belege
        </label>
      </section>

      {fehler && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</div>}

      <section className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-maja-navy">
            {liste == null ? 'Lädt …' : `${liste.length} ${liste.length === 1 ? 'Beleg' : 'Belege'} · ${dateiAnzahl} ${dateiAnzahl === 1 ? 'Datei' : 'Dateien'}`}
          </h3>
          <button type="button" className="btn-primary" disabled={busy || !liste?.length} onClick={() => void exportieren()}>
            {busy ? (fortschritt ? `Lade ${fortschritt.fertig}/${fortschritt.gesamt} …` : 'Bereite vor …') : 'ZIP herunterladen'}
          </button>
        </div>
        {liste && liste.length === 0 ? (
          <p className="text-sm text-maja-muted">Keine archivierten E-Rechnungen im gewählten Zeitraum.</p>
        ) : liste && (
          <div className="max-h-96 overflow-auto rounded-md border border-maja-navy/10">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-maja-light text-left text-xs uppercase tracking-wide text-maja-muted">
                <tr><th className="px-3 py-2">Beleg</th><th className="px-3 py-2">Datum</th><th className="px-3 py-2">Empfänger</th><th className="px-3 py-2">Typ</th><th className="px-3 py-2">Format</th><th className="px-3 py-2 text-right">Brutto</th><th className="px-3 py-2">Zuletzt exportiert</th></tr>
              </thead>
              <tbody className="divide-y divide-maja-navy/10">
                {liste.map((e) => (
                  <tr key={e.dokument.id}>
                    <td className="px-3 py-1.5 font-medium text-maja-ink">{e.belegnummer}</td>
                    <td className="px-3 py-1.5">{formatDate(e.datum)}</td>
                    <td className="px-3 py-1.5">{e.empfaenger}</td>
                    <td className="px-3 py-1.5">{e.typ}</td>
                    <td className="px-3 py-1.5">{formatName(e.dokument.format)}</td>
                    <td className="px-3 py-1.5 text-right">{eur(e.brutto)}</td>
                    <td className="px-3 py-1.5 text-maja-muted">{e.zuletztExportiert ? new Date(e.zuletztExportiert).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : 'noch nie'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {ergebnis && (
        <section className="card space-y-2 p-4" data-testid="export-ergebnis">
          {ergebnis.abweichungen.length === 0 ? (
            <p role="status" className="text-sm font-medium text-emerald-700 dark:!text-emerald-300">
              {ergebnis.dateien.length} {ergebnis.dateien.length === 1 ? 'Datei' : 'Dateien'} exportiert — alle Hash-Prüfungen bestanden.
            </p>
          ) : (
            <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:!bg-red-900/40 dark:!text-red-200">
              <p className="font-semibold">Achtung: {ergebnis.abweichungen.length} {ergebnis.abweichungen.length === 1 ? 'Datei weicht' : 'Dateien weichen'} vom Archiv-Stand ab oder {ergebnis.abweichungen.length === 1 ? 'fehlt' : 'fehlen'}.</p>
              <ul className="mt-1 list-disc pl-5">
                {ergebnis.abweichungen.map((d) => (
                  <li key={d.pfad}>{d.eintrag.belegnummer} · {d.name}: {d.fehler ?? 'SHA-256 stimmt nicht mit dem beim Archivieren gespeicherten Wert überein'}</li>
                ))}
              </ul>
              <p className="mt-1">Die Abweichungen stehen auch in der Uebersicht.csv. Bitte die Dateien in OneDrive prüfen.</p>
            </div>
          )}
          {!ergebnis.protokolliert && (
            <p className="text-sm text-amber-700 dark:!text-amber-300">Der Export konnte nicht protokolliert werden{ergebnis.protokollFehler ? `: ${ergebnis.protokollFehler}` : ''}.</p>
          )}
        </section>
      )}
    </div>
  );
}
