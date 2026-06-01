import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Spinner } from '../../components/Spinner';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { XIcon } from '../../components/icons';
import { triggerOneDriveDownload, uploadToOneDrive } from '../../lib/onedrive';
import { sanitizeSegment } from '../../lib/onedrivePaths';
import type { Auftraggeber, Preisstufe, Sonderverguetung } from '../../types/db';

const DEFAULT_RANGES: Array<[number, number]> = [
  [1, 24], [25, 50], [51, 74], [75, 100], [101, 125], [126, 150], [151, 174],
  [175, 200], [201, 250], [251, 300], [301, 350], [351, 400], [401, 450],
  [451, 500], [501, 550], [551, 600], [601, 650], [651, 700], [701, 750],
  [751, 800], [801, 850], [851, 900], [901, 950], [951, 1000], [1001, 1050],
  [1051, 1100], [1101, 1150], [1151, 1200], [1201, 1250], [1251, 1300],
  [1301, 1350], [1351, 1400], [1401, 1450], [1451, 1500], [1501, 1550],
  [1551, 1600], [1601, 1650], [1651, 1700], [1701, 1750], [1751, 1800],
  [1801, 1850], [1851, 1900], [1901, 1948], [1949, 2000],
];

const DEFAULT_SV: Array<{ bezeichnung: string; einheit: string }> = [
  { bezeichnung: 'Reifenhandling',  einheit: 'pro Vorgang' },
  { bezeichnung: 'Rote Kennzeichen', einheit: 'pauschal' },
  { bezeichnung: 'Wartezeit',        einheit: 'pro Stunde' },
  { bezeichnung: 'Ladezeit',         einheit: 'pro Vorgang' },
];

interface DraftRow {
  // Local row id used as React key. Existing rows reuse the DB id.
  key: string;
  // Server id (set if the row exists on the server)
  id: string | null;
  km_von: string;
  km_bis: string;
  preis: string;
  e_aufschlag: string;
}

interface SvDraftRow {
  key: string;
  id: string | null;
  bezeichnung: string;
  einheit: string;
  preis: string;
}

function rowFromServer(p: Preisstufe): DraftRow {
  return {
    key: p.id,
    id: p.id,
    km_von: String(p.km_von),
    km_bis: String(p.km_bis),
    preis: Number(p.preis).toFixed(2).replace('.', ','),
    e_aufschlag: Number(p.e_fahrzeug_aufschlag ?? 0).toFixed(2).replace('.', ','),
  };
}

function newDraftRow(km_von = '', km_bis = '', preis = '0,00', e_aufschlag = '0,00'): DraftRow {
  return {
    key: `new-${Math.random().toString(36).slice(2, 10)}`,
    id: null,
    km_von,
    km_bis,
    preis,
    e_aufschlag,
  };
}

function svRowFromServer(s: Sonderverguetung): SvDraftRow {
  return {
    key: s.id,
    id: s.id,
    bezeichnung: s.bezeichnung,
    einheit: s.einheit,
    preis: Number(s.preis).toFixed(2).replace('.', ','),
  };
}

function newSvDraftRow(bezeichnung = '', einheit = '', preis = '0,00'): SvDraftRow {
  return {
    key: `sv-new-${Math.random().toString(36).slice(2, 10)}`,
    id: null,
    bezeichnung,
    einheit,
    preis,
  };
}

function parsePreis(input: string): number | null {
  const normalized = input.trim().replace(/\./g, '').replace(',', '.');
  if (normalized === '') return 0;
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function parseKm(input: string): number | null {
  const n = Number(input.trim());
  if (!Number.isFinite(n)) return null;
  if (Math.floor(n) !== n) return null;
  if (n < 0) return null;
  return n;
}

function pdfFolderForAuftraggeber(a: Auftraggeber): string {
  const segment = `${sanitizeSegment(a.name)}_${a.id.slice(0, 8)}`;
  return `Maja-Logistik/Preislisten/${segment}`;
}

function filenameFromPath(path: string): string {
  return path.split('/').pop() ?? path;
}

export function PreislistePage() {
  const [auftraggeber, setAuftraggeber] = useState<Auftraggeber[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [agRes, psRes] = await Promise.all([
      supabase.from('auftraggeber').select('*').order('name'),
      supabase.from('preisstufen').select('auftraggeber_id'),
    ]);
    if (agRes.error) { setError(agRes.error.message); setLoading(false); return; }
    if (psRes.error) { setError(psRes.error.message); setLoading(false); return; }
    const c: Record<string, number> = {};
    for (const row of psRes.data ?? []) {
      c[row.auftraggeber_id] = (c[row.auftraggeber_id] ?? 0) + 1;
    }
    setAuftraggeber(agRes.data ?? []);
    setCounts(c);
    setLoading(false);
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);

  const selected = useMemo(
    () => auftraggeber.find((a) => a.id === selectedId) ?? null,
    [auftraggeber, selectedId],
  );

  const handleAfterSave = useCallback((agId: string, newCount: number) => {
    setCounts((c) => ({ ...c, [agId]: newCount }));
  }, []);

  const handleAuftraggeberPatch = useCallback((patched: Auftraggeber) => {
    setAuftraggeber((rows) => rows.map((r) => (r.id === patched.id ? patched : r)));
  }, []);

  if (loading) return <Spinner label="Auftraggeber werden geladen …" />;
  if (error) {
    return <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-maja-navy">Preisliste</h1>
        <p className="text-sm text-maja-muted">
          Pro Auftraggeber Preisliste-PDF, km-Stufen und Sondervergütungen pflegen.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <aside className="card overflow-hidden">
          {auftraggeber.length === 0 ? (
            <div className="p-4 text-sm text-maja-muted">
              Noch keine Auftraggeber angelegt.
            </div>
          ) : (
            <ul className="divide-y divide-maja-navy/10">
              {auftraggeber.map((a) => {
                const isActive = a.id === selectedId;
                const count = counts[a.id] ?? 0;
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(a.id)}
                      className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition ${
                        isActive
                          ? 'bg-maja-navy text-white'
                          : 'hover:bg-maja-light'
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{a.name}</span>
                        {a.kontakt && (
                          <span className={`block truncate text-xs ${
                            isActive ? 'text-white/70' : 'text-maja-muted'
                          }`}>
                            {a.kontakt}
                          </span>
                        )}
                      </span>
                      <span
                        className={`inline-flex min-w-[1.75rem] items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                          isActive
                            ? 'bg-white/20 text-white'
                            : 'bg-maja-light text-maja-navy'
                        }`}
                        title={`${count} hinterlegte Preisstufen`}
                      >
                        {count}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className="min-w-0">
          {!selected ? (
            <div className="card p-8 text-center text-sm text-maja-muted">
              Wähle links einen Auftraggeber aus, um Preisliste, km-Stufen und Sondervergütungen zu bearbeiten.
            </div>
          ) : (
            <PreislisteDetail
              key={selected.id}
              auftraggeber={selected}
              alleAuftraggeber={auftraggeber}
              preisstufenCounts={counts}
              onPatched={handleAuftraggeberPatch}
              onCountChanged={(n) => handleAfterSave(selected.id, n)}
              onSvCountsRefresh={loadList}
            />
          )}
        </section>
      </div>
    </div>
  );
}

interface DetailProps {
  auftraggeber: Auftraggeber;
  /** Vollständige Auftraggeber-Liste (für "Preisliste kopieren von…"). */
  alleAuftraggeber: Auftraggeber[];
  /** Anzahl Preisstufen pro Auftraggeber, aus dem Parent. */
  preisstufenCounts: Record<string, number>;
  onPatched: (a: Auftraggeber) => void;
  onCountChanged: (count: number) => void;
  /** Nach dem Kopieren von einem anderen Auftraggeber neu laden, damit
   *  die Sidebar-Counts aktualisiert werden. */
  onSvCountsRefresh: () => void;
}

function PreislisteDetail({
  auftraggeber, alleAuftraggeber, preisstufenCounts,
  onPatched, onCountChanged, onSvCountsRefresh,
}: DetailProps) {
  const [serverRows, setServerRows] = useState<Preisstufe[]>([]);
  const [draftRows, setDraftRows] = useState<DraftRow[]>([]);
  const [serverSv, setServerSv] = useState<Sonderverguetung[]>([]);
  const [draftSv, setDraftSv] = useState<SvDraftRow[]>([]);
  const [abaAufschlagInput, setAbaAufschlagInput] = useState<string>(
    auftraggeber.aba_aufschlag_prozent == null
      ? ''
      : Number(auftraggeber.aba_aufschlag_prozent).toFixed(2).replace('.', ','),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [psRes, svRes] = await Promise.all([
      supabase
        .from('preisstufen')
        .select('*')
        .eq('auftraggeber_id', auftraggeber.id)
        .order('km_von', { ascending: true }),
      supabase
        .from('sonderverguetungen')
        .select('*')
        .eq('auftraggeber_id', auftraggeber.id)
        .order('bezeichnung', { ascending: true }),
    ]);
    if (psRes.error) {
      setStatusMsg({ kind: 'err', text: psRes.error.message });
      setServerRows([]); setDraftRows([]);
    } else {
      const rows = (psRes.data ?? []) as Preisstufe[];
      setServerRows(rows);
      setDraftRows(rows.map(rowFromServer));
    }
    if (svRes.error) {
      setStatusMsg({ kind: 'err', text: svRes.error.message });
      setServerSv([]); setDraftSv([]);
    } else {
      const rows = (svRes.data ?? []) as Sonderverguetung[];
      setServerSv(rows);
      setDraftSv(rows.map(svRowFromServer));
    }
    setLoading(false);
  }, [auftraggeber.id]);

  useEffect(() => { void load(); }, [load]);

  // Sync ABA-Aufschlag-Input wenn Auftraggeber sich ändert (z.B. nach Save).
  useEffect(() => {
    setAbaAufschlagInput(
      auftraggeber.aba_aufschlag_prozent == null
        ? ''
        : Number(auftraggeber.aba_aufschlag_prozent).toFixed(2).replace('.', ','),
    );
  }, [auftraggeber.aba_aufschlag_prozent]);

  function updateRow(key: string, patch: Partial<DraftRow>) {
    setDraftRows((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function removeRow(key: string) {
    setDraftRows((rows) => rows.filter((r) => r.key !== key));
  }
  function addEmptyRow() {
    setDraftRows((rows) => [...rows, newDraftRow()]);
  }
  function loadDefaults() {
    setDraftRows(DEFAULT_RANGES.map(([von, bis]) => newDraftRow(String(von), String(bis), '0,00')));
    setStatusMsg(null);
  }

  // ---------- Preisliste von anderem Auftraggeber kopieren ----------
  const [copyPickerOpen, setCopyPickerOpen] = useState(false);
  const [copyConfirm, setCopyConfirm] = useState<Auftraggeber | null>(null);
  const [copying, setCopying] = useState(false);

  /**
   * Kopiert Preisstufen + Sondervergütungen + ABA-Aufschlag vom Quell-
   * Auftraggeber auf den aktuell ausgewählten. Bestehende Preisstufen/
   * Sondervergütungen werden vorher gelöscht. NICHT kopiert werden:
   * Name, Kontakt, Rechnungsformat, Rechnungsadressen, Preisliste-PDF.
   *
   * Es gibt keine echte DB-Transaktion über den supabase-js-Client; wir
   * geben uns Mühe, Fehler sauber zu propagieren — falls inserts nach
   * dem delete fehlschlagen, sieht der Admin das im Status-Banner und
   * kann die Standard-Buttons neu nutzen.
   */
  async function handleCopyFrom(src: Auftraggeber) {
    setCopying(true);
    setStatusMsg(null);
    try {
      // 1. Quell-Daten laden (Preisstufen + SV + ABA-Aufschlag).
      const [psSrc, svSrc] = await Promise.all([
        supabase.from('preisstufen').select('*').eq('auftraggeber_id', src.id),
        supabase.from('sonderverguetungen').select('*').eq('auftraggeber_id', src.id),
      ]);
      if (psSrc.error) throw psSrc.error;
      if (svSrc.error) throw svSrc.error;

      // 2. Bestehende Ziel-Einträge löschen.
      const [delPs, delSv] = await Promise.all([
        supabase.from('preisstufen').delete().eq('auftraggeber_id', auftraggeber.id),
        supabase.from('sonderverguetungen').delete().eq('auftraggeber_id', auftraggeber.id),
      ]);
      if (delPs.error) throw delPs.error;
      if (delSv.error) throw delSv.error;

      // 3. Neue Einträge als Kopie einfügen (ohne id → neue UUIDs).
      const psInsert = (psSrc.data ?? []).map((p) => ({
        auftraggeber_id: auftraggeber.id,
        km_von: p.km_von,
        km_bis: p.km_bis,
        preis: p.preis,
        e_fahrzeug_aufschlag: p.e_fahrzeug_aufschlag ?? 0,
      }));
      const svInsert = (svSrc.data ?? []).map((s) => ({
        auftraggeber_id: auftraggeber.id,
        bezeichnung: s.bezeichnung,
        einheit: s.einheit,
        preis: s.preis,
      }));
      if (psInsert.length > 0) {
        const { error } = await supabase.from('preisstufen').insert(psInsert);
        if (error) throw error;
      }
      if (svInsert.length > 0) {
        const { error } = await supabase.from('sonderverguetungen').insert(svInsert);
        if (error) throw error;
      }

      // 4. ABA-Aufschlag setzen.
      const { error: agErr } = await supabase
        .from('auftraggeber')
        .update({ aba_aufschlag_prozent: src.aba_aufschlag_prozent ?? null })
        .eq('id', auftraggeber.id);
      if (agErr) throw agErr;
      onPatched({ ...auftraggeber, aba_aufschlag_prozent: src.aba_aufschlag_prozent ?? null });

      // 5. Lokale Drafts neu laden, Sidebar-Counts auffrischen.
      await load();
      onCountChanged(psInsert.length);
      onSvCountsRefresh();
      setStatusMsg({
        kind: 'ok',
        text: `Preisliste von „${src.name}" übernommen — `
          + `${psInsert.length} Stufe${psInsert.length === 1 ? '' : 'n'}, `
          + `${svInsert.length} Sondervergütung${svInsert.length === 1 ? '' : 'en'}.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Kopieren fehlgeschlagen';
      setStatusMsg({ kind: 'err', text: msg });
    } finally {
      setCopying(false);
      setCopyPickerOpen(false);
      setCopyConfirm(null);
    }
  }

  const copyCandidates = useMemo(
    () => alleAuftraggeber
      .filter((a) => a.id !== auftraggeber.id && (preisstufenCounts[a.id] ?? 0) > 0)
      .sort((a, b) => a.name.localeCompare(b.name, 'de')),
    [alleAuftraggeber, preisstufenCounts, auftraggeber.id],
  );

  function updateSvRow(key: string, patch: Partial<SvDraftRow>) {
    setDraftSv((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function removeSvRow(key: string) {
    setDraftSv((rows) => rows.filter((r) => r.key !== key));
  }
  function addEmptySvRow() {
    setDraftSv((rows) => [...rows, newSvDraftRow()]);
  }
  function loadSvDefaults() {
    setDraftSv(DEFAULT_SV.map((d) => newSvDraftRow(d.bezeichnung, d.einheit, '0,00')));
    setStatusMsg(null);
  }

  async function handleSave() {
    setStatusMsg(null);

    // --- Validate ABA-Aufschlag ---
    const abaTrim = abaAufschlagInput.trim();
    let abaValue: number | null = null;
    if (abaTrim !== '') {
      const parsed = parsePreis(abaTrim);
      if (parsed === null || parsed < 0) {
        setStatusMsg({ kind: 'err', text: 'ABA-Aufschlag: bitte einen gültigen Prozentwert eingeben (oder leer für „kein Aufschlag").' });
        return;
      }
      abaValue = parsed === 0 ? null : parsed;
    }

    // --- Validate Preisstufen ---
    const parsedPs: Array<{ row: DraftRow; km_von: number; km_bis: number; preis: number; e_aufschlag: number }> = [];
    for (const row of draftRows) {
      const km_von = parseKm(row.km_von);
      const km_bis = parseKm(row.km_bis);
      const preis = parsePreis(row.preis);
      const e_aufschlag = parsePreis(row.e_aufschlag);
      if (km_von === null || km_bis === null) {
        setStatusMsg({ kind: 'err', text: 'Bitte gültige km-Werte eingeben (ganze Zahlen).' });
        return;
      }
      if (km_bis < km_von) {
        setStatusMsg({ kind: 'err', text: `Stufe ${row.km_von}–${row.km_bis}: km bis muss ≥ km von sein.` });
        return;
      }
      if (preis === null) {
        setStatusMsg({ kind: 'err', text: `Stufe ${row.km_von}–${row.km_bis}: Preis ist ungültig.` });
        return;
      }
      if (e_aufschlag === null) {
        setStatusMsg({ kind: 'err', text: `Stufe ${row.km_von}–${row.km_bis}: E-Fahrzeug-Aufschlag ist ungültig.` });
        return;
      }
      parsedPs.push({ row, km_von, km_bis, preis, e_aufschlag });
    }

    // --- Validate Sondervergütungen ---
    const parsedSv: Array<{ row: SvDraftRow; bezeichnung: string; einheit: string; preis: number }> = [];
    const seen = new Set<string>();
    for (const row of draftSv) {
      const bezeichnung = row.bezeichnung.trim();
      const einheit = row.einheit.trim();
      const preis = parsePreis(row.preis);
      if (!bezeichnung) {
        setStatusMsg({ kind: 'err', text: 'Sondervergütung: Bezeichnung darf nicht leer sein.' });
        return;
      }
      if (!einheit) {
        setStatusMsg({ kind: 'err', text: `Sondervergütung „${bezeichnung}": Einheit darf nicht leer sein.` });
        return;
      }
      if (preis === null) {
        setStatusMsg({ kind: 'err', text: `Sondervergütung „${bezeichnung}": Preis ist ungültig.` });
        return;
      }
      const lower = bezeichnung.toLowerCase();
      if (seen.has(lower)) {
        setStatusMsg({ kind: 'err', text: `Sondervergütung „${bezeichnung}" ist mehrfach vorhanden.` });
        return;
      }
      seen.add(lower);
      parsedSv.push({ row, bezeichnung, einheit, preis });
    }

    setSaving(true);
    try {
      // --- Preisstufen: diff & sync ---
      const psDraftIds = new Set(draftRows.map((r) => r.id).filter((id): id is string => !!id));
      const psToDelete = serverRows.filter((s) => !psDraftIds.has(s.id)).map((s) => s.id);
      const psToInsert = parsedPs
        .filter((p) => p.row.id === null)
        .map((p) => ({
          auftraggeber_id: auftraggeber.id,
          km_von: p.km_von,
          km_bis: p.km_bis,
          preis: p.preis,
          e_fahrzeug_aufschlag: p.e_aufschlag,
        }));
      const psToUpdate = parsedPs.filter((p) => p.row.id !== null);

      if (psToDelete.length > 0) {
        const { error } = await supabase.from('preisstufen').delete().in('id', psToDelete);
        if (error) throw error;
      }
      if (psToInsert.length > 0) {
        const { error } = await supabase.from('preisstufen').insert(psToInsert);
        if (error) throw error;
      }
      for (const u of psToUpdate) {
        const { error } = await supabase
          .from('preisstufen')
          .update({
            km_von: u.km_von, km_bis: u.km_bis,
            preis: u.preis, e_fahrzeug_aufschlag: u.e_aufschlag,
          })
          .eq('id', u.row.id!);
        if (error) throw error;
      }

      // --- Sondervergütungen: diff & sync ---
      const svDraftIds = new Set(draftSv.map((r) => r.id).filter((id): id is string => !!id));
      const svToDelete = serverSv.filter((s) => !svDraftIds.has(s.id)).map((s) => s.id);
      const svToInsert = parsedSv
        .filter((p) => p.row.id === null)
        .map((p) => ({
          auftraggeber_id: auftraggeber.id,
          bezeichnung: p.bezeichnung,
          einheit: p.einheit,
          preis: p.preis,
        }));
      const svToUpdate = parsedSv.filter((p) => p.row.id !== null);

      if (svToDelete.length > 0) {
        const { error } = await supabase.from('sonderverguetungen').delete().in('id', svToDelete);
        if (error) throw error;
      }
      if (svToInsert.length > 0) {
        const { error } = await supabase.from('sonderverguetungen').insert(svToInsert);
        if (error) throw error;
      }
      for (const u of svToUpdate) {
        const { error } = await supabase
          .from('sonderverguetungen')
          .update({ bezeichnung: u.bezeichnung, einheit: u.einheit, preis: u.preis })
          .eq('id', u.row.id!);
        if (error) throw error;
      }

      // --- ABA-Aufschlag auf auftraggeber speichern ---
      if (abaValue !== Number(auftraggeber.aba_aufschlag_prozent ?? 0)
          || (abaValue === null && auftraggeber.aba_aufschlag_prozent != null)) {
        const { error } = await supabase
          .from('auftraggeber')
          .update({ aba_aufschlag_prozent: abaValue })
          .eq('id', auftraggeber.id);
        if (error) throw error;
        onPatched({ ...auftraggeber, aba_aufschlag_prozent: abaValue });
      }

      await load();
      onCountChanged(parsedPs.length);
      setStatusMsg({ kind: 'ok', text: 'Preisstufen und Sondervergütungen gespeichert.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Speichern fehlgeschlagen';
      setStatusMsg({ kind: 'err', text: msg });
    } finally {
      setSaving(false);
    }
  }

  async function handlePdfUpload(file: File) {
    setStatusMsg(null);
    if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
      setStatusMsg({ kind: 'err', text: 'Bitte eine PDF-Datei auswählen.' });
      return;
    }
    setUploading(true);
    try {
      const folder = pdfFolderForAuftraggeber(auftraggeber);
      const safeName = sanitizeSegment(file.name.replace(/\.pdf$/i, '')) + '.pdf';
      const path = `${folder}/${safeName}`;
      await uploadToOneDrive(path, file);
      const { error } = await supabase
        .from('auftraggeber')
        .update({ preisliste_pdf_url: path })
        .eq('id', auftraggeber.id);
      if (error) throw error;
      onPatched({ ...auftraggeber, preisliste_pdf_url: path });
      setStatusMsg({ kind: 'ok', text: 'Preisliste-PDF hochgeladen.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload fehlgeschlagen';
      setStatusMsg({ kind: 'err', text: msg });
    } finally {
      setUploading(false);
    }
  }

  async function handlePdfDownload() {
    if (!auftraggeber.preisliste_pdf_url) return;
    const ok = await triggerOneDriveDownload(
      auftraggeber.preisliste_pdf_url,
      filenameFromPath(auftraggeber.preisliste_pdf_url),
    );
    if (!ok) setStatusMsg({ kind: 'err', text: 'Download fehlgeschlagen.' });
  }

  const noPs = !loading && draftRows.length === 0;
  const noSv = !loading && draftSv.length === 0;

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h2 className="text-lg font-semibold text-maja-navy">{auftraggeber.name}</h2>
        {auftraggeber.kontakt && (
          <p className="text-xs text-maja-muted">Kontakt: {auftraggeber.kontakt}</p>
        )}
        <p className="text-sm text-maja-muted">
          Preisliste-PDF, km-Stufen und Sondervergütungen für diesen Auftraggeber.
        </p>
      </div>

      <div className="card p-5 space-y-3">
        <h3 className="text-base font-semibold text-maja-navy">Preisliste PDF</h3>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handlePdfUpload(f);
            e.target.value = '';
          }}
        />
        {auftraggeber.preisliste_pdf_url ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="text-sm font-medium text-maja-accent hover:underline"
              onClick={() => void handlePdfDownload()}
            >
              {filenameFromPath(auftraggeber.preisliste_pdf_url)}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? 'Hochladen …' : 'Ersetzen'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn-primary"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Hochladen …' : 'PDF hochladen'}
          </button>
        )}
      </div>

      <div className="card p-5 space-y-3">
        <h3 className="text-base font-semibold text-maja-navy">ABA-Aufschlag</h3>
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr] sm:items-start">
          <div>
            <label htmlFor="aba-aufschlag" className="label">ABA-Aufschlag (%)</label>
            <input
              id="aba-aufschlag"
              className="input"
              type="text"
              inputMode="decimal"
              placeholder="z.B. 15,00"
              value={abaAufschlagInput}
              onChange={(e) => setAbaAufschlagInput(e.target.value)}
            />
          </div>
          <p className="text-xs text-maja-muted sm:pt-7">
            Prozentsatz, der auf den Standardpreis bei ABA-Touren aufgeschlagen wird.
            Leer oder 0 = kein Aufschlag.
          </p>
        </div>
      </div>

      <div className="card p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-maja-navy">Preisstufen</h3>
          {copyCandidates.length > 0 && (
            <button
              type="button"
              onClick={() => setCopyPickerOpen(true)}
              disabled={copying}
              className="btn-secondary text-sm disabled:opacity-60"
              title="Preisstufen, Sondervergütungen und ABA-Aufschlag eines anderen Auftraggebers übernehmen"
            >
              {copying ? 'Kopiere …' : 'Preisliste kopieren von …'}
            </button>
          )}
        </div>

        {loading ? (
          <Spinner label="Stufen werden geladen …" />
        ) : noPs ? (
          <div className="space-y-3">
            <p className="text-sm text-maja-muted">
              Für diesen Auftraggeber sind noch keine Preisstufen hinterlegt.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" onClick={loadDefaults}>
                Standardstufen laden
              </button>
              {copyCandidates.length > 0 && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setCopyPickerOpen(true)}
                  disabled={copying}
                >
                  Preisliste kopieren von …
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-maja-light text-left text-maja-navy">
                <tr>
                  <th className="px-3 py-2 font-semibold">km von</th>
                  <th className="px-3 py-2 font-semibold">km bis</th>
                  <th className="px-3 py-2 font-semibold">Preis (€)</th>
                  <th className="px-3 py-2 font-semibold">E-Aufschlag (€)</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-maja-navy/10">
                {draftRows.map((row) => (
                  <tr key={row.key} className="align-middle">
                    <td className="px-2 py-1">
                      <input
                        className="input py-1.5"
                        type="number"
                        min={0}
                        step={1}
                        value={row.km_von}
                        onChange={(e) => updateRow(row.key, { km_von: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        className="input py-1.5"
                        type="number"
                        min={0}
                        step={1}
                        value={row.km_bis}
                        onChange={(e) => updateRow(row.key, { km_bis: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        className="input py-1.5"
                        type="text"
                        inputMode="decimal"
                        value={row.preis}
                        onChange={(e) => updateRow(row.key, { preis: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        className="input py-1.5"
                        type="text"
                        inputMode="decimal"
                        value={row.e_aufschlag}
                        onChange={(e) => updateRow(row.key, { e_aufschlag: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <button
                        type="button"
                        aria-label="Stufe löschen"
                        title="Stufe löschen"
                        className="rounded-md px-2 py-1 text-red-600 hover:bg-red-50"
                        onClick={() => removeRow(row.key)}
                      >
                        <XIcon className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3">
              <button type="button" className="btn-secondary" onClick={addEmptyRow}>
                Stufe hinzufügen
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card p-5 space-y-3">
        <h3 className="text-base font-semibold text-maja-navy">Sondervergütungen</h3>

        {loading ? (
          <Spinner label="Sondervergütungen werden geladen …" />
        ) : noSv ? (
          <div className="space-y-3">
            <p className="text-sm text-maja-muted">
              Für diesen Auftraggeber sind noch keine Sondervergütungen hinterlegt.
            </p>
            <button type="button" className="btn-primary" onClick={loadSvDefaults}>
              Standard-Sondervergütungen laden
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-maja-light text-left text-maja-navy">
                <tr>
                  <th className="px-3 py-2 font-semibold">Bezeichnung</th>
                  <th className="px-3 py-2 font-semibold">Einheit</th>
                  <th className="px-3 py-2 font-semibold">Preis (€)</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-maja-navy/10">
                {draftSv.map((row) => (
                  <tr key={row.key} className="align-middle">
                    <td className="px-2 py-1">
                      <input
                        className="input py-1.5"
                        type="text"
                        value={row.bezeichnung}
                        onChange={(e) => updateSvRow(row.key, { bezeichnung: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        className="input py-1.5"
                        type="text"
                        value={row.einheit}
                        onChange={(e) => updateSvRow(row.key, { einheit: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        className="input py-1.5"
                        type="text"
                        inputMode="decimal"
                        value={row.preis}
                        onChange={(e) => updateSvRow(row.key, { preis: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <button
                        type="button"
                        aria-label="Sondervergütung löschen"
                        title="Sondervergütung löschen"
                        className="rounded-md px-2 py-1 text-red-600 hover:bg-red-50"
                        onClick={() => removeSvRow(row.key)}
                      >
                        <XIcon className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3">
              <button type="button" className="btn-secondary" onClick={addEmptySvRow}>
                Sondervergütung hinzufügen
              </button>
            </div>
          </div>
        )}
      </div>

      {statusMsg && (
        <div
          role="status"
          className={`rounded-lg p-3 text-sm ${
            statusMsg.kind === 'ok'
              ? 'bg-green-50 text-green-700'
              : 'bg-red-50 text-red-700'
          }`}
        >
          {statusMsg.text}
        </div>
      )}

      {!loading && (
        <div className="flex justify-end">
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? 'Speichert …' : 'Speichern'}
          </button>
        </div>
      )}

      {copyPickerOpen && (
        <CopyPricelistPicker
          candidates={copyCandidates}
          counts={preisstufenCounts}
          onCancel={() => setCopyPickerOpen(false)}
          onPick={(src) => setCopyConfirm(src)}
        />
      )}

      {copyConfirm && (
        <ConfirmDialog
          title="Preisstufen übernehmen?"
          message={
            <>
              Preisstufen, Sondervergütungen und ABA-Aufschlag von{' '}
              <strong>{copyConfirm.name}</strong> übernehmen? Bestehende
              Preisstufen und Sondervergütungen werden dabei{' '}
              <strong>überschrieben</strong>.
            </>
          }
          confirmLabel="Übernehmen"
          onConfirm={async () => { await handleCopyFrom(copyConfirm); }}
          onClose={() => setCopyConfirm(null)}
        />
      )}
    </div>
  );
}

function CopyPricelistPicker({
  candidates, counts, onCancel, onPick,
}: {
  candidates: Auftraggeber[];
  counts: Record<string, number>;
  onCancel: () => void;
  onPick: (src: Auftraggeber) => void;
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-maja-ink/40 px-4">
      <div className="card w-full max-w-lg p-5">
        <h3 className="text-base font-semibold text-maja-navy">Preisliste kopieren von …</h3>
        <p className="mt-1 text-xs text-maja-muted">
          Wähle einen Auftraggeber, dessen Preisstufen, Sondervergütungen
          und ABA-Aufschlag übernommen werden sollen.
        </p>
        <ul className="mt-4 max-h-80 divide-y divide-maja-navy/10 overflow-auto rounded-lg border border-maja-navy/10">
          {candidates.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onPick(a)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-maja-light"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-maja-ink">{a.name}</span>
                  {a.kontakt && (
                    <span className="block truncate text-xs text-maja-muted">{a.kontakt}</span>
                  )}
                </span>
                <span className="inline-flex items-center rounded-full bg-maja-navy/10 px-2 py-0.5 text-xs font-semibold text-maja-navy">
                  {counts[a.id] ?? 0} Stufen
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end">
          <button type="button" className="btn-secondary" onClick={onCancel}>Abbrechen</button>
        </div>
      </div>
    </div>
  );
}
