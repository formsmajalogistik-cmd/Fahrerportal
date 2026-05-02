import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../../lib/supabase';
import { displayName } from '../../lib/names';
import type {
  AppUser, Auftraggeber, Fahrer, TourenArt,
} from '../../types/db';

type FahrerWithUser = Fahrer & { user: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null };

interface Props {
  onClose: () => void;
  onImported: () => void;
}

type Step = 'upload' | 'mapping' | 'matching' | 'preview' | 'running' | 'done';

interface ParsedRow {
  rowIndex: number; // ursprüngliche Excel-Zeilennummer (1-basiert nach Header)
  raw: Record<string, unknown>;
  // ausgewertete Felder:
  startdatum: string | null;        // ISO
  start_stadt: string;
  ziel_stadt: string;
  rueckfuehrung_stadt: string | null;
  fahrer_name: string | null;
  auftraggeber_name: string | null;
  tourenart: TourenArt | null;
  ist_sondervereinbarung: boolean;
  sondervereinbarung: string | null;
  km_gesamt: number | null;
  verguetung: number | null;
  kennzeichen: string[];
  errors: string[];
  is_duplicate: boolean;
}

const HEADER_KEYS = {
  datum:           ['datum'],
  fahrauftrag:     ['fahrauftrag', 'fahrauftrag:'],
  fahrer:          ['fahrer', 'fahrer:'],
  auftraggeber:    ['auftraggeber', 'auftraggeber:'],
  tourenart:       ['tourenart', 'tourenart:'],
  sondervereinbar: ['sondervereinbarung', 'sondervereinbarung:'],
  km:              ['km zahl', 'km', 'km gesamt', 'km zahl:'],
  verguetung:      ['vergütung (netto)', 'verguetung (netto)', 'vergütung netto', 'vergütung', 'verguetung', 'vergütung netto:'],
  kennzeichen:     ['kennzeichen', 'kennzeichen:'],
};

function normalizeHeader(s: string): string {
  return (s ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
}

function findColumn(headers: string[], candidates: string[]): number {
  const norm = headers.map(normalizeHeader);
  for (const c of candidates) {
    const idx = norm.indexOf(normalizeHeader(c));
    if (idx >= 0) return idx;
  }
  // Fallback: enthält-Match
  for (const c of candidates) {
    const needle = normalizeHeader(c).replace(/:$/, '').trim();
    const idx = norm.findIndex((h) => h.includes(needle));
    if (idx >= 0) return idx;
  }
  return -1;
}

function excelDateToISO(value: unknown): string | null {
  if (value == null || value === '') return null;
  // Excel-Seriennummer (z.B. 46024 = 2026-01-02)
  if (typeof value === 'number' && Number.isFinite(value)) {
    // SheetJS: SSF.parse_date_code akzeptiert die Seriennummer
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const d = new Date(Date.UTC(
        parsed.y, (parsed.m ?? 1) - 1, parsed.d ?? 1,
        parsed.H ?? 0, parsed.M ?? 0, Math.floor(parsed.S ?? 0),
      ));
      if (!isNaN(d.getTime())) return d.toISOString();
    }
  }
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString();
  }
  // String: versuche dd.mm.yyyy oder ISO
  const s = String(value).trim();
  const m = s.match(/^(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{2,4})$/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    const d = new Date(Date.UTC(year, month - 1, day));
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function parseRoute(raw: unknown): { start: string; ziel: string; rueck: string | null } | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const parts = text.split('/').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  return {
    start: parts[0],
    ziel: parts[1],
    rueck: parts[2] ?? null,
  };
}

function parseTourenart(raw: unknown): TourenArt | null {
  if (!raw) return null;
  const s = String(raw).toUpperCase();
  if (/\bABA\b/.test(s)) return 'ABA';
  if (/\bABC\b/.test(s)) return 'ABC';
  if (/\bAB\b/.test(s)) return 'AB';
  return null;
}

function parseDecimalNumber(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw * 100) / 100;
  const s = String(raw).trim().replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function parseInteger(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  const s = String(raw).trim().replace(/[\s.]/g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function fuzzyMatchName<T extends { id: string; haystack: string }>(
  needle: string, candidates: T[],
): T | null {
  const n = needle.trim().toLowerCase();
  if (!n) return null;
  // Exakter Match zuerst
  const exact = candidates.find((c) => c.haystack === n);
  if (exact) return exact;
  // Enthält-Match
  const contains = candidates.find((c) => c.haystack.includes(n) || n.includes(c.haystack));
  return contains ?? null;
}

export function TourImportDialog({ onClose, onImported }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [error, setError] = useState<string | null>(null);

  // Datei + Sheet
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');

  // Geparste Daten
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);

  // Match-Maps (importierter Name → ausgewählte ID oder null)
  const [fahrerMap, setFahrerMap] = useState<Record<string, string | null>>({});
  const [agMap, setAgMap] = useState<Record<string, string | null>>({});

  // Lookup-Listen
  const [auftraggeber, setAuftraggeber] = useState<Auftraggeber[]>([]);
  const [fahrer, setFahrer] = useState<FahrerWithUser[]>([]);
  const [existingHashes, setExistingHashes] = useState<Set<string>>(new Set());

  // Import-Fortschritt
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState<{ imported: number; skipped: number; errors: number } | null>(null);

  useEffect(() => {
    void (async () => {
      const [agRes, faRes, tRes] = await Promise.all([
        supabase.from('auftraggeber').select('*').order('name'),
        supabase
          .from('fahrer')
          .select('*, user:user_id (email, vorname, nachname)')
          .eq('aktiv', true),
        supabase.from('touren').select('startdatum, start_stadt, ziel_stadt, auftraggeber_id'),
      ]);
      setAuftraggeber(Array.isArray(agRes.data) ? agRes.data : []);
      setFahrer(Array.isArray(faRes.data) ? (faRes.data as unknown as FahrerWithUser[]) : []);
      const set = new Set<string>();
      for (const t of tRes.data ?? []) {
        const d = (t.startdatum ?? '').slice(0, 10);
        const key = `${d}|${(t.start_stadt ?? '').toLowerCase()}|${(t.ziel_stadt ?? '').toLowerCase()}|${t.auftraggeber_id ?? ''}`;
        set.add(key);
      }
      setExistingHashes(set);
    })();
  }, []);

  const fahrerHaystack = useMemo(
    () => fahrer.map((f) => ({ id: f.id, haystack: displayName(f.user ?? null).toLowerCase() })),
    [fahrer],
  );
  const agHaystack = useMemo(
    () => auftraggeber.map((a) => ({ id: a.id, haystack: a.name.trim().toLowerCase() })),
    [auftraggeber],
  );

  async function handleFileChange(file: File) {
    setError(null);
    setSummary(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      setWorkbook(wb);
      setSheetNames(wb.SheetNames);
      setSelectedSheet(wb.SheetNames[0] ?? '');
      setStep('mapping');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Datei konnte nicht gelesen werden.');
    }
  }

  function parseSelectedSheet() {
    if (!workbook || !selectedSheet) return;
    const sheet = workbook.Sheets[selectedSheet];
    if (!sheet) { setError('Sheet nicht gefunden.'); return; }

    // Header in Zeile 2 → wir lesen alle Zellen als 2D-Array und behandeln Zeile 2 als Header.
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    });
    if (aoa.length < 2) { setError('Die Datei enthält keine Datenzeilen.'); return; }

    // Header-Zeile bestimmen: bevorzugt Index 1 (zweite Zeile), Fallback Index 0.
    let headerRowIdx = 1;
    let headerRow: unknown[] = aoa[1] ?? [];
    const headerHasContent = headerRow.some((c) => c != null && String(c).trim() !== '');
    if (!headerHasContent) { headerRowIdx = 0; headerRow = aoa[0] ?? []; }

    const cols = headerRow.map((c) => (c == null ? '' : String(c)));
    const cIdx = {
      datum:        findColumn(cols, HEADER_KEYS.datum),
      fahrauftrag:  findColumn(cols, HEADER_KEYS.fahrauftrag),
      fahrer:       findColumn(cols, HEADER_KEYS.fahrer),
      auftraggeber: findColumn(cols, HEADER_KEYS.auftraggeber),
      tourenart:    findColumn(cols, HEADER_KEYS.tourenart),
      sondervereinbarung: findColumn(cols, HEADER_KEYS.sondervereinbar),
      km:           findColumn(cols, HEADER_KEYS.km),
      verguetung:   findColumn(cols, HEADER_KEYS.verguetung),
      kennzeichen:  findColumn(cols, HEADER_KEYS.kennzeichen),
    };

    const parsed: ParsedRow[] = [];
    const fNames = new Set<string>();
    const aNames = new Set<string>();

    for (let i = headerRowIdx + 1; i < aoa.length; i += 1) {
      const r = aoa[i] ?? [];
      const rowEmpty = r.every((c) => c == null || String(c).trim() === '');
      if (rowEmpty) continue;

      const datumRaw = cIdx.datum >= 0 ? r[cIdx.datum] : null;
      const startdatum = excelDateToISO(datumRaw);

      const route = parseRoute(cIdx.fahrauftrag >= 0 ? r[cIdx.fahrauftrag] : null);
      const start_stadt = route?.start ?? '';
      const ziel_stadt = route?.ziel ?? '';
      const rueckfuehrung_stadt = route?.rueck ?? null;

      const fahrer_name = cIdx.fahrer >= 0 ? (r[cIdx.fahrer] == null ? null : String(r[cIdx.fahrer]).trim()) : null;
      const auftraggeber_name = cIdx.auftraggeber >= 0 ? (r[cIdx.auftraggeber] == null ? null : String(r[cIdx.auftraggeber]).trim()) : null;
      const tourenart = cIdx.tourenart >= 0 ? parseTourenart(r[cIdx.tourenart]) : null;

      const sv_raw = cIdx.sondervereinbarung >= 0 ? r[cIdx.sondervereinbarung] : null;
      const sv_text = sv_raw == null ? '' : String(sv_raw).trim();
      const ist_sondervereinbarung = sv_text.length > 0;

      const km_gesamt = cIdx.km >= 0 ? parseInteger(r[cIdx.km]) : null;
      const verguetung = cIdx.verguetung >= 0 ? parseDecimalNumber(r[cIdx.verguetung]) : null;
      const kz_raw = cIdx.kennzeichen >= 0 ? r[cIdx.kennzeichen] : null;
      const kz = kz_raw == null ? [] : [String(kz_raw).trim().toUpperCase()].filter(Boolean);

      const errors: string[] = [];
      if (!start_stadt || !ziel_stadt) errors.push('Route konnte nicht geparst werden.');

      const dupKey = `${(startdatum ?? '').slice(0, 10)}|${start_stadt.toLowerCase()}|${ziel_stadt.toLowerCase()}|`;
      // Duplikat-Hash inkl. Auftraggeber prüfen wir nach dem Name-Matching erneut.

      parsed.push({
        rowIndex: i + 1,
        raw: cols.reduce<Record<string, unknown>>((acc, c, k) => { acc[c || `col_${k}`] = r[k]; return acc; }, {}),
        startdatum,
        start_stadt,
        ziel_stadt,
        rueckfuehrung_stadt,
        fahrer_name,
        auftraggeber_name,
        tourenart,
        ist_sondervereinbarung,
        sondervereinbarung: ist_sondervereinbarung ? sv_text : null,
        km_gesamt,
        verguetung,
        kennzeichen: kz,
        errors,
        is_duplicate: false,
        // dupKey ist nur intern; wir berechnen ihn erst im Preview neu.
        ...{ _dup_partial: dupKey } as Partial<ParsedRow>,
      });

      if (fahrer_name) fNames.add(fahrer_name);
      if (auftraggeber_name) aNames.add(auftraggeber_name);
    }

    setHeaders(cols);
    setParsedRows(parsed);

    // Auto-Match
    const fMap: Record<string, string | null> = {};
    fNames.forEach((name) => {
      const m = fuzzyMatchName(name, fahrerHaystack);
      fMap[name] = m?.id ?? null;
    });
    const aMap: Record<string, string | null> = {};
    aNames.forEach((name) => {
      const m = fuzzyMatchName(name, agHaystack);
      aMap[name] = m?.id ?? null;
    });
    setFahrerMap(fMap);
    setAgMap(aMap);
    setStep('matching');
  }

  // Wenn von Preview zurück zur Mapping-Vorschau gewechselt werden soll, etc.

  // Berechne mit aktuellem Mapping die endgültigen Zeilen (mit aufgelösten IDs + Dup-Flag)
  const resolvedRows = useMemo(() => {
    return parsedRows.map((r) => {
      const fahrerId = r.fahrer_name ? (fahrerMap[r.fahrer_name] ?? null) : null;
      const auftraggeberId = r.auftraggeber_name ? (agMap[r.auftraggeber_name] ?? null) : null;
      const dupKey = `${(r.startdatum ?? '').slice(0, 10)}|${r.start_stadt.toLowerCase()}|${r.ziel_stadt.toLowerCase()}|${auftraggeberId ?? ''}`;
      const is_duplicate = existingHashes.has(dupKey);
      return { ...r, fahrer_id: fahrerId, auftraggeber_id: auftraggeberId, is_duplicate };
    });
  }, [parsedRows, fahrerMap, agMap, existingHashes]);

  const valideCount = resolvedRows.filter((r) => r.errors.length === 0).length;
  const problemCount = resolvedRows.length - valideCount;
  const dupCount = resolvedRows.filter((r) => r.is_duplicate).length;

  async function runImport(onlyValid: boolean) {
    setStep('running');
    const toImport = resolvedRows.filter((r) => onlyValid ? r.errors.length === 0 : true);
    setProgress({ done: 0, total: toImport.length });
    let imported = 0;
    let errors = 0;
    const skipped = resolvedRows.length - toImport.length;

    const CHUNK = 100;
    for (let i = 0; i < toImport.length; i += CHUNK) {
      const slice = toImport.slice(i, i + CHUNK);
      const payload = slice.map((r) => {
        // Tourenart 'ABA' speichert km nur als km_hin.
        const isAba = r.tourenart === 'ABA';
        return {
          startdatum: r.startdatum,
          start_stadt: r.start_stadt,
          ziel_stadt: r.ziel_stadt,
          rueckfuehrung_stadt: r.rueckfuehrung_stadt,
          fahrer_id: r.fahrer_id,
          auftraggeber_id: r.auftraggeber_id,
          tourenart: r.tourenart,
          ist_sondervereinbarung: r.ist_sondervereinbarung,
          sondervereinbarung: r.sondervereinbarung,
          km_hin: isAba ? r.km_gesamt : r.km_gesamt,
          km_rueck: null,
          km_gesamt: r.km_gesamt,
          verguetung: r.verguetung,
          kennzeichen: r.kennzeichen,
        };
      });
      const { error: err } = await supabase.from('touren').insert(payload);
      if (err) {
        errors += slice.length;
      } else {
        imported += slice.length;
      }
      setProgress({ done: Math.min(i + CHUNK, toImport.length), total: toImport.length });
    }

    setSummary({ imported, skipped, errors });
    setStep('done');
    if (imported > 0) onImported();
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8">
      <div className="card w-full max-w-4xl p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-maja-navy">Touren importieren</h2>
            <p className="text-xs text-maja-muted">Excel- oder CSV-Datei mit bestehenden Touren importieren.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-maja-muted hover:bg-maja-light"
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>

        <Steps current={step} />

        {error && (
          <div role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {step === 'upload' && (
          <UploadStep
            onFile={handleFileChange}
            onCancel={onClose}
          />
        )}

        {step === 'mapping' && (
          <MappingStep
            sheetNames={sheetNames}
            selectedSheet={selectedSheet}
            setSelectedSheet={setSelectedSheet}
            onParse={parseSelectedSheet}
            onBack={() => { setStep('upload'); setWorkbook(null); }}
            previewRows={parsedRows.slice(0, 20)}
            headers={headers}
          />
        )}

        {step === 'matching' && (
          <MatchingStep
            parsedRows={parsedRows}
            fahrer={fahrer}
            auftraggeber={auftraggeber}
            fahrerMap={fahrerMap}
            setFahrerMap={setFahrerMap}
            agMap={agMap}
            setAgMap={setAgMap}
            onBack={() => setStep('mapping')}
            onNext={() => setStep('preview')}
          />
        )}

        {step === 'preview' && (
          <PreviewStep
            rows={resolvedRows}
            valideCount={valideCount}
            problemCount={problemCount}
            dupCount={dupCount}
            onBack={() => setStep('matching')}
            onImportAll={() => void runImport(false)}
            onImportValid={() => void runImport(true)}
          />
        )}

        {step === 'running' && (
          <RunningStep progress={progress} />
        )}

        {step === 'done' && summary && (
          <DoneStep summary={summary} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

// ---------- Step-UI Komponenten ----------

function Steps({ current }: { current: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: 'upload',   label: '1. Datei' },
    { id: 'mapping',  label: '2. Mapping' },
    { id: 'matching', label: '3. Namen' },
    { id: 'preview',  label: '4. Vorschau' },
  ];
  return (
    <div className="mb-4 flex flex-wrap gap-1 text-xs">
      {steps.map((s) => {
        const active = s.id === current;
        return (
          <span key={s.id}
                className={`inline-block rounded-full px-3 py-1 ${
                  active ? 'bg-maja-navy text-white' : 'bg-maja-light text-maja-navy'
                }`}>
            {s.label}
          </span>
        );
      })}
    </div>
  );
}

function UploadStep({ onFile, onCancel }: { onFile: (f: File) => void; onCancel: () => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-maja-ink">
        Wähle eine Excel- (.xlsx) oder CSV-Datei aus. Die Datei sollte die Header
        in Zeile 2 enthalten (wie das bestehende Tourenliste-Sheet).
      </p>
      <input
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
        className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-maja-navy file:px-4 file:py-2 file:font-medium file:text-white hover:file:bg-maja-accent"
      />
      <div className="flex justify-end">
        <button type="button" onClick={onCancel} className="btn-secondary">Abbrechen</button>
      </div>
    </div>
  );
}

interface MappingProps {
  sheetNames: string[];
  selectedSheet: string;
  setSelectedSheet: (s: string) => void;
  onParse: () => void;
  onBack: () => void;
  previewRows: ParsedRow[];
  headers: string[];
}

function MappingStep({ sheetNames, selectedSheet, setSelectedSheet, onParse, onBack, previewRows, headers }: MappingProps) {
  return (
    <div className="space-y-4">
      <div>
        <label className="label">Sheet</label>
        <select className="input" value={selectedSheet} onChange={(e) => setSelectedSheet(e.target.value)}>
          {sheetNames.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <p className="mt-1 text-xs text-maja-muted">
          Bei Excel mit Jahres-Sheets das gewünschte Jahr wählen.
        </p>
      </div>

      <div className="flex justify-end">
        <button type="button" className="btn-primary" onClick={onParse}>
          Sheet einlesen
        </button>
      </div>

      {previewRows.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-maja-navy">Vorschau (erste 20 Zeilen)</h3>
          <div className="overflow-x-auto rounded-lg border border-maja-navy/10">
            <table className="w-full text-xs">
              <thead className="bg-maja-light text-maja-navy">
                <tr>
                  <th className="px-2 py-1.5 text-left">#</th>
                  <th className="px-2 py-1.5 text-left">Datum</th>
                  <th className="px-2 py-1.5 text-left">Route</th>
                  <th className="px-2 py-1.5 text-left">Fahrer</th>
                  <th className="px-2 py-1.5 text-left">Auftraggeber</th>
                  <th className="px-2 py-1.5 text-left">Art</th>
                  <th className="px-2 py-1.5 text-left">km</th>
                  <th className="px-2 py-1.5 text-left">€</th>
                  <th className="px-2 py-1.5 text-left">KZ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-maja-navy/10">
                {previewRows.map((r) => (
                  <tr key={r.rowIndex}>
                    <td className="px-2 py-1.5 text-maja-muted">{r.rowIndex}</td>
                    <td className="px-2 py-1.5">{r.startdatum?.slice(0, 10) ?? '—'}</td>
                    <td className="px-2 py-1.5">
                      {[r.start_stadt, r.ziel_stadt, r.rueckfuehrung_stadt].filter(Boolean).join(' → ')}
                    </td>
                    <td className="px-2 py-1.5">{r.fahrer_name ?? '—'}</td>
                    <td className="px-2 py-1.5">{r.auftraggeber_name ?? '—'}</td>
                    <td className="px-2 py-1.5">{r.tourenart ?? '—'}</td>
                    <td className="px-2 py-1.5">{r.km_gesamt ?? '—'}</td>
                    <td className="px-2 py-1.5">{r.verguetung ?? '—'}</td>
                    <td className="px-2 py-1.5">{r.kennzeichen.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-maja-muted">Header: {headers.filter(Boolean).join(' · ')}</p>
        </div>
      )}

      <div className="flex justify-between">
        <button type="button" className="btn-secondary" onClick={onBack}>Zurück</button>
      </div>
    </div>
  );
}

interface MatchingProps {
  parsedRows: ParsedRow[];
  fahrer: FahrerWithUser[];
  auftraggeber: Auftraggeber[];
  fahrerMap: Record<string, string | null>;
  setFahrerMap: (m: Record<string, string | null>) => void;
  agMap: Record<string, string | null>;
  setAgMap: (m: Record<string, string | null>) => void;
  onBack: () => void;
  onNext: () => void;
}

function MatchingStep({ parsedRows, fahrer, auftraggeber, fahrerMap, setFahrerMap, agMap, setAgMap, onBack, onNext }: MatchingProps) {
  const fNames = useMemo(() => {
    const s = new Set<string>();
    parsedRows.forEach((r) => { if (r.fahrer_name) s.add(r.fahrer_name); });
    return [...s];
  }, [parsedRows]);
  const aNames = useMemo(() => {
    const s = new Set<string>();
    parsedRows.forEach((r) => { if (r.auftraggeber_name) s.add(r.auftraggeber_name); });
    return [...s];
  }, [parsedRows]);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-maja-navy">Fahrer-Zuordnung</h3>
        <ul className="divide-y divide-maja-navy/10 rounded-lg border border-maja-navy/10">
          {fNames.length === 0 && <li className="px-3 py-2 text-sm text-maja-muted">Keine Fahrer in den importierten Daten.</li>}
          {fNames.map((name) => {
            const matched = fahrerMap[name];
            return (
              <li key={name} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className={`min-w-[12rem] flex-1 ${matched ? 'text-maja-ink' : 'text-red-700 font-medium'}`}>
                  {name}
                </span>
                <select
                  className="input flex-1"
                  value={matched ?? ''}
                  onChange={(e) => setFahrerMap({ ...fahrerMap, [name]: e.target.value || null })}
                >
                  <option value="">— Überspringen —</option>
                  {fahrer.map((f) => (
                    <option key={f.id} value={f.id}>{displayName(f.user ?? null)}</option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-maja-navy">Auftraggeber-Zuordnung</h3>
        <ul className="divide-y divide-maja-navy/10 rounded-lg border border-maja-navy/10">
          {aNames.length === 0 && <li className="px-3 py-2 text-sm text-maja-muted">Keine Auftraggeber in den importierten Daten.</li>}
          {aNames.map((name) => {
            const matched = agMap[name];
            return (
              <li key={name} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className={`min-w-[12rem] flex-1 ${matched ? 'text-maja-ink' : 'text-red-700 font-medium'}`}>
                  {name}
                </span>
                <select
                  className="input flex-1"
                  value={matched ?? ''}
                  onChange={(e) => setAgMap({ ...agMap, [name]: e.target.value || null })}
                >
                  <option value="">— Überspringen —</option>
                  {auftraggeber.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex justify-between">
        <button type="button" className="btn-secondary" onClick={onBack}>Zurück</button>
        <button type="button" className="btn-primary" onClick={onNext}>Weiter zur Vorschau</button>
      </div>
    </div>
  );
}

interface PreviewProps {
  rows: Array<ParsedRow & { fahrer_id: string | null; auftraggeber_id: string | null }>;
  valideCount: number;
  problemCount: number;
  dupCount: number;
  onBack: () => void;
  onImportAll: () => void;
  onImportValid: () => void;
}

function PreviewStep({ rows, valideCount, problemCount, dupCount, onBack, onImportAll, onImportValid }: PreviewProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <SummaryBox label="Gesamt"        value={rows.length} />
        <SummaryBox label="Valide"        value={valideCount} accent="green" />
        <SummaryBox label="Problematisch" value={problemCount} accent={problemCount > 0 ? 'red' : undefined} />
      </div>
      {dupCount > 0 && (
        <p className="text-xs text-amber-700">
          {dupCount} Zeile(n) sind möglicherweise Duplikate (gleiche Datum + Route + Auftraggeber).
        </p>
      )}

      <div className="max-h-72 overflow-auto rounded-lg border border-maja-navy/10">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-maja-light text-maja-navy">
            <tr>
              <th className="px-2 py-1.5 text-left">#</th>
              <th className="px-2 py-1.5 text-left">Datum</th>
              <th className="px-2 py-1.5 text-left">Route</th>
              <th className="px-2 py-1.5 text-left">Fahrer</th>
              <th className="px-2 py-1.5 text-left">Auftraggeber</th>
              <th className="px-2 py-1.5 text-left">€</th>
              <th className="px-2 py-1.5 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-maja-navy/10">
            {rows.map((r) => {
              const hasErr = r.errors.length > 0;
              return (
                <tr key={r.rowIndex} className={hasErr ? 'bg-red-50' : r.is_duplicate ? 'bg-amber-50' : ''}>
                  <td className="px-2 py-1.5 text-maja-muted">{r.rowIndex}</td>
                  <td className="px-2 py-1.5">{r.startdatum?.slice(0, 10) ?? '—'}</td>
                  <td className="px-2 py-1.5">
                    {[r.start_stadt, r.ziel_stadt, r.rueckfuehrung_stadt].filter(Boolean).join(' → ')}
                  </td>
                  <td className="px-2 py-1.5">
                    {r.fahrer_name}
                    {!r.fahrer_id && r.fahrer_name && <span className="ml-1 text-red-600">·übersprungen</span>}
                  </td>
                  <td className="px-2 py-1.5">
                    {r.auftraggeber_name}
                    {!r.auftraggeber_id && r.auftraggeber_name && <span className="ml-1 text-red-600">·übersprungen</span>}
                  </td>
                  <td className="px-2 py-1.5">{r.verguetung ?? '—'}</td>
                  <td className="px-2 py-1.5">
                    {hasErr
                      ? <span className="text-red-700">{r.errors.join('; ')}</span>
                      : r.is_duplicate
                        ? <span className="text-amber-700">möglicherweise Duplikat</span>
                        : <span className="text-emerald-700">ok</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="btn-secondary" onClick={onBack}>Zurück</button>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={onImportValid} disabled={valideCount === 0}>
            Nur valide importieren ({valideCount})
          </button>
          <button type="button" className="btn-primary" onClick={onImportAll}>
            Alle importieren ({rows.length})
          </button>
        </div>
      </div>
    </div>
  );
}

function RunningStep({ progress }: { progress: { done: number; total: number } }) {
  const pct = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);
  return (
    <div className="space-y-3 py-4">
      <div className="text-sm text-maja-ink">
        Importiere … {progress.done} / {progress.total}
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-maja-light">
        <div className="h-full bg-maja-navy transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function DoneStep({ summary, onClose }: {
  summary: { imported: number; skipped: number; errors: number };
  onClose: () => void;
}) {
  return (
    <div className="space-y-4 py-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <SummaryBox label="Importiert"   value={summary.imported} accent="green" />
        <SummaryBox label="Übersprungen" value={summary.skipped} />
        <SummaryBox label="Fehler"       value={summary.errors} accent={summary.errors > 0 ? 'red' : undefined} />
      </div>
      <div className="flex justify-end">
        <button type="button" className="btn-primary" onClick={onClose}>Schließen</button>
      </div>
    </div>
  );
}

function SummaryBox({ label, value, accent }: {
  label: string; value: number; accent?: 'green' | 'red';
}) {
  const color =
    accent === 'green' ? 'text-emerald-700' :
    accent === 'red'   ? 'text-red-700'      :
                          'text-maja-navy';
  return (
    <div className="rounded-lg border border-maja-navy/10 p-3">
      <div className="text-xs uppercase tracking-wide text-maja-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}
