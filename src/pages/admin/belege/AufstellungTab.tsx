import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { fahrerName as resolveFahrerName, displayName } from '../../../lib/names';
import { Spinner } from '../../../components/Spinner';
import { flattenedFahrerOptions, type FahrerOptionRaw } from '../../touren/FahrerSelect';
import { generateAufstellungPdf } from './aufstellungPdf';
import { downloadBlob } from './belegPdf';
import type { AppUser } from '../../../types/db';

interface FahrerOption {
  id: string;
  label: string;
  /** Für die Anzeige im PDF: nur der reine Name. */
  pdfName: string;
}

interface TourRow {
  id: string;
  tour_id: string | null;
  enddatum: string | null;
  startdatum: string | null;
  start_stadt: string;
  ziel_stadt: string;
  rueckfuehrung_stadt: string | null;
  verguetung: number | null;
  fahrer_honorar: number | null;
  fahrer_id: string | null;
  auftraggeber: { name: string } | null;
  fahrer: {
    id: string;
    vorname: string | null;
    nachname: string | null;
    user: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null;
  } | null;
}

function monthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function monthEnd(): string {
  const d = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function buildRoute(t: TourRow): string {
  const parts = [t.start_stadt, t.ziel_stadt];
  if (t.rueckfuehrung_stadt) parts.push(t.rueckfuehrung_stadt);
  return parts.filter(Boolean).join(' → ');
}

function fahrerLabelFromRow(t: TourRow): string {
  if (!t.fahrer) return '—';
  return resolveFahrerName(t.fahrer, t.fahrer.user ?? null) || displayName(t.fahrer.user ?? null) || '—';
}

function fmtEuro(v: number | null): string {
  if (v == null) return '—';
  const eur = (Math.round(v * 100) / 100).toFixed(2).replace('.', ',');
  return eur.replace(/\B(?=(\d{3})+(?=,))/g, '.') + ' €';
}

function sanitizeFs(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_');
}

export function AufstellungTab() {
  const [fahrerOptions, setFahrerOptions] = useState<FahrerOption[]>([]);
  const [selectedFahrer, setSelectedFahrer] = useState<string[]>([]);
  const [von, setVon] = useState<string>(monthStart());
  const [bis, setBis] = useState<string>(monthEnd());
  const [rows, setRows] = useState<TourRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [honorarDraft, setHonorarDraft] = useState<Record<string, string>>({});

  // Fahrer-Optionen einmalig laden — Haupt + Unterkonten, alphabetisch.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('fahrer')
        .select('id, user_id, vorname, nachname, ist_unterkonto, haupt_user_id, user:user_id (email, vorname, nachname)')
        .eq('aktiv', true);
      if (cancelled) return;
      // Gruppierte Optionen: Haupt → Unterkonten (gleiche Logik wie in
      // den Tour-Dropdowns), inkl. Duplikat-Filter.
      const raw = (data ?? []) as unknown as FahrerOptionRaw[];
      const flat = flattenedFahrerOptions(raw);
      // pdfName ist der reine Personenname ohne "Unterkonto von …"-Hinweis,
      // damit er sauber in der Aufstellung-Überschrift erscheint.
      const list: FahrerOption[] = flat.map((o) => {
        const f = raw.find((x) => x.id === o.id);
        const pdfName = f
          ? (resolveFahrerName(f, f.user ?? null) || displayName(f.user ?? null) || '—')
          : o.label;
        return { id: o.id, label: o.label, pdfName };
      });
      setFahrerOptions(list);
    })();
    return () => { cancelled = true; };
  }, []);

  const selectableOptions = useMemo(
    () => fahrerOptions.filter((o) => !selectedFahrer.includes(o.id)),
    [fahrerOptions, selectedFahrer],
  );

  function addFahrer(id: string) {
    if (!id) return;
    setSelectedFahrer((s) => (s.includes(id) ? s : [...s, id]));
  }
  function removeFahrer(id: string) {
    setSelectedFahrer((s) => s.filter((x) => x !== id));
  }

  const load = useCallback(async () => {
    if (selectedFahrer.length === 0) {
      setError('Bitte mindestens einen Fahrer auswählen.');
      return;
    }
    setLoading(true);
    setError(null);

    // Wird ein Haupt-Konto ausgewählt, müssen auch die Touren seiner
    // Unterkonten in die Aufstellung. Direkt ausgewählte Unterkonten
    // bleiben unverändert (kein Reverse-Lookup zum Haupt).
    const { data: subData, error: subErr } = await supabase
      .from('fahrer')
      .select('id, haupt_user_id')
      .in('haupt_user_id', selectedFahrer);
    if (subErr) { setError(subErr.message); setLoading(false); return; }
    const scopeIds = new Set<string>(selectedFahrer);
    for (const s of subData ?? []) scopeIds.add(s.id);

    const { data, error: err } = await supabase
      .from('touren')
      .select(`
        id, tour_id, enddatum, startdatum, start_stadt, ziel_stadt, rueckfuehrung_stadt,
        verguetung, fahrer_honorar, fahrer_id,
        auftraggeber:auftraggeber_id (name),
        fahrer:fahrer_id (
          id, vorname, nachname,
          user:user_id (email, vorname, nachname)
        )
      `)
      .in('fahrer_id', Array.from(scopeIds))
      .order('enddatum', { ascending: true, nullsFirst: false });
    if (err) { setError(err.message); setLoading(false); return; }
    // Datumsfilter clientseitig anwenden (auf Enddatum, mit Fallback startdatum).
    const list = ((data ?? []) as unknown as TourRow[]).filter((t) => {
      const ref = t.enddatum ?? t.startdatum;
      if (!ref) return false;
      return ref >= von && ref <= bis;
    });
    setRows(list);
    setHonorarDraft({});
    setLoading(false);
  }, [selectedFahrer, von, bis]);

  /** Auto-Save eines bearbeiteten Honorars in der Tour. */
  async function commitHonorar(rowId: string) {
    const raw = honorarDraft[rowId];
    if (raw === undefined) return;
    const trimmed = raw.trim().replace(/\./g, '').replace(',', '.');
    // DB-Spalte ist NOT NULL → leer wird als 0 gespeichert.
    const num = trimmed === '' ? 0 : Number(trimmed);
    if (!Number.isFinite(num)) {
      setError('Ungültiges Honorar — bitte als Zahl eingeben (z.B. 120,50).');
      return;
    }
    setSavingId(rowId);
    setError(null);
    const { error: err } = await supabase
      .from('touren')
      .update({ fahrer_honorar: num })
      .eq('id', rowId);
    setSavingId(null);
    if (err) { setError(err.message); return; }
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, fahrer_honorar: num } : r)));
    setHonorarDraft((d) => { const cp = { ...d }; delete cp[rowId]; return cp; });
  }

  const sumHonorar = useMemo(
    () => rows.reduce((acc, r) => acc + (r.fahrer_honorar ?? 0), 0),
    [rows],
  );
  const missingHonorar = useMemo(
    () => rows.filter((r) => r.fahrer_honorar == null || r.fahrer_honorar === 0).length,
    [rows],
  );

  async function exportPdf() {
    if (rows.length === 0) return;
    if (missingHonorar > 0) {
      const ok = confirm(
        `${missingHonorar} ${missingHonorar === 1 ? 'Tour hat' : 'Touren haben'} kein `
        + `Fahrer-Honorar eingetragen. Trotzdem fortfahren?`,
      );
      if (!ok) return;
    }
    setPdfBusy(true);
    setError(null);
    try {
      const fahrerNamen = selectedFahrer
        .map((id) => fahrerOptions.find((o) => o.id === id)?.pdfName)
        .filter((n): n is string => !!n);
      const blob = await generateAufstellungPdf({
        fahrerNamen,
        von, bis,
        rows: rows.map((r) => ({
          enddatum: r.enddatum,
          route: buildRoute(r),
          fahrer_honorar: r.fahrer_honorar ?? null,
        })),
      });
      const namePart = fahrerNamen.length === 1
        ? sanitizeFs(fahrerNamen[0]) + '_'
        : '';
      downloadBlob(blob, `Aufstellung_${namePart}${von}_${bis}.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF-Erstellung fehlgeschlagen');
    } finally {
      setPdfBusy(false);
    }
  }

  const showFahrerSpalte = selectedFahrer.length > 1;

  return (
    <div className="space-y-5">
      <p className="text-sm text-maja-muted">
        Touren-Aufstellung pro Fahrer und Zeitraum erstellen, Honorare ergänzen und als PDF exportieren.
      </p>

      {/* Filter */}
      <div className="card space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Von</label>
            <input type="date" className="input" value={von} onChange={(e) => setVon(e.target.value)} />
          </div>
          <div>
            <label className="label">Bis</label>
            <input type="date" className="input" value={bis} onChange={(e) => setBis(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">Fahrer auswählen</label>
          {selectedFahrer.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {selectedFahrer.map((id) => {
                const opt = fahrerOptions.find((o) => o.id === id);
                return (
                  <span key={id}
                        className="inline-flex items-center gap-1 rounded-full bg-maja-navy px-2.5 py-1 text-xs font-medium text-white">
                    {opt?.label ?? id}
                    <button type="button" onClick={() => removeFahrer(id)}
                            className="text-white/80 hover:text-white">×</button>
                  </span>
                );
              })}
            </div>
          )}
          <select
            className="input"
            value=""
            onChange={(e) => { addFahrer(e.target.value); e.currentTarget.selectedIndex = 0; }}
          >
            <option value="">— Fahrer hinzufügen —</option>
            {selectableOptions.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>

        <div>
          <button
            type="button"
            className="btn-primary"
            disabled={loading || selectedFahrer.length === 0}
            onClick={() => void load()}
          >
            {loading ? 'Lädt …' : 'Touren laden'}
          </button>
        </div>

        {error && (
          <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      {/* Touren-Tabelle */}
      {loading ? (
        <Spinner label="Touren werden geladen …" />
      ) : rows.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-maja-light text-left text-maja-navy">
              <tr>
                <th className="px-3 py-2 font-semibold">Datum</th>
                <th className="px-3 py-2 font-semibold">Tour</th>
                {showFahrerSpalte && (
                  <th className="px-3 py-2 font-semibold">Fahrer</th>
                )}
                <th className="px-3 py-2 font-semibold">Auftraggeber</th>
                <th className="px-3 py-2 font-semibold text-right">Preis</th>
                <th className="px-3 py-2 font-semibold text-right">Honorar Fahrer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-maja-navy/10">
              {rows.map((r) => {
                const draftValue = honorarDraft[r.id];
                const honEmpty = r.fahrer_honorar == null || r.fahrer_honorar === 0;
                return (
                  <tr key={r.id} className="hover:bg-maja-light/50">
                    <td className="whitespace-nowrap px-3 py-2 text-maja-ink">
                      {r.enddatum ? new Date(r.enddatum).toLocaleDateString('de-DE') : '—'}
                    </td>
                    <td className="px-3 py-2 text-maja-ink">
                      {r.tour_id && (
                        <span className="mr-1 inline-block rounded-full bg-maja-light px-2 py-0.5 text-[10px] font-semibold text-maja-navy">
                          {r.tour_id}
                        </span>
                      )}
                      {buildRoute(r)}
                    </td>
                    {showFahrerSpalte && (
                      <td className="whitespace-nowrap px-3 py-2 text-maja-ink">
                        {fahrerLabelFromRow(r)}
                      </td>
                    )}
                    <td className="px-3 py-2 text-maja-muted">{r.auftraggeber?.name ?? '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-maja-muted">
                      {fmtEuro(r.verguetung)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {honEmpty || draftValue !== undefined ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          className="input w-28 px-2 py-1 text-right text-sm"
                          placeholder="0,00"
                          value={draftValue ?? ''}
                          onChange={(e) => setHonorarDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                          onBlur={() => void commitHonorar(r.id)}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                          disabled={savingId === r.id}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setHonorarDraft((d) => ({
                            ...d,
                            [r.id]: String(r.fahrer_honorar ?? '').replace('.', ','),
                          }))}
                          className="font-medium text-maja-navy hover:underline"
                          title="Honorar bearbeiten"
                        >
                          {fmtEuro(r.fahrer_honorar)}
                        </button>
                      )}
                      {savingId === r.id && (
                        <span className="ml-1 text-xs text-maja-muted">…</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-maja-light text-maja-navy">
                <td colSpan={showFahrerSpalte ? 5 : 4}
                    className="px-3 py-2 text-right font-semibold">
                  Gesamt Honorar Fahrer (netto):
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-base font-bold">
                  {fmtEuro(sumHonorar)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="card p-6 text-center text-sm text-maja-muted">
          Noch keine Touren geladen. Wähle Zeitraum + Fahrer und klicke „Touren laden".
        </div>
      )}

      {rows.length > 0 && missingHonorar > 0 && (
        <div role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {missingHonorar} {missingHonorar === 1 ? 'Tour hat' : 'Touren haben'} noch kein Fahrer-Honorar eingetragen.
        </div>
      )}

      {/* PDF-Aktion */}
      {rows.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            className="btn-primary"
            disabled={pdfBusy}
            onClick={() => void exportPdf()}
          >
            {pdfBusy ? 'PDF wird erstellt …' : 'PDF erstellen'}
          </button>
        </div>
      )}
    </div>
  );
}
