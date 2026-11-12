import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { seiteBegrenzen, useListenZustand, useWiederherstellen } from '../../../lib/useListenZustand';
import {
  alsVersendetMarkieren, ladeVersand, versandStatus, type VersandEintrag, type VersandStatus,
} from '../../../lib/belegVersand';
import { VersandBadge } from '../../../components/versand/VersandBadge';
import { VersendetMarkierenDialog } from '../../../components/versand/VersendetMarkierenDialog';
import { VersandAltbestandDialog } from '../../../components/versand/VersandAltbestandDialog';
import { supabase } from '../../../lib/supabase';
import { ladeInBloecken } from '../../../lib/ladeInBloecken';
import { neuesteBelegeZuerst } from '../../../lib/belegNummer';
import { Spinner } from '../../../components/Spinner';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { formatDate, formatEuro } from '../../../lib/touren';
import { RechnungStatusBadge } from './RechnungStatusBadge';
import { RechnungenTabs } from './RechnungenTabs';
import { RECHNUNG_STATUS_LABEL } from './rechnungLabels';
import { MANUELL_OPTION, empfaengerAusSnapshot } from '../../../lib/manuelleEmpfaenger';
import { auftraggeberAnzeige, filterAuftraggeber, filterOptionen, filterPasst, mitNiederlassungSpalte, standortPasstZuSuche } from '../../../lib/niederlassungen';
import { useStandorte } from '../../../lib/useStandorte';
import type {
  Auftraggeber, AuftraggeberKontakt, Rechnung, RechnungStatus,
} from '../../../types/db';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

interface RechnungRow extends Rechnung {
  auftraggeber: Pick<Auftraggeber, 'id' | 'name'> | null;
  rechnungsempfaenger: Pick<AuftraggeberKontakt, 'id' | 'name'> | null;
  positionen_count: number;
}

const PAGE_SIZE = 25;
const STATUS_ORDER: Array<RechnungStatus | 'alle'> = [
  'alle', 'entwurf', 'offen', 'bezahlt', 'storniert',
];

export function RechnungenListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<RechnungRow[]>([]);
  const [auftraggeber, setAuftraggeber] = useState<Pick<Auftraggeber, 'id' | 'name'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter, Suche und Seite stehen in der URL (?jahr=…&ag=…&status=…&
  // versand=…&suche=…&seite=…) — so führt „Zurück" aus einer Rechnung
  // genau auf diesen Stand (lib/useListenZustand).
  const liste = useListenZustand('rechnungen');
  const jahrParam = liste.wert('jahr', String(new Date().getFullYear()));
  const yearFilter: number | 'alle' = jahrParam === 'alle' ? 'alle' : Number(jahrParam) || new Date().getFullYear();
  const agFilter = liste.wert('ag');
  // Niederlassungen (Migration 118): „Name · Ort" + Filter je Standort
  const { standorte } = useStandorte();
  /** Optionaler Rechnungsempfänger-Filter, abhängig vom Auftraggeber-Filter:
   *  Auswahlmöglichkeiten kommen aus den Empfängern der Rechnungen des
   *  aktuell gefilterten Auftraggebers. Bei agFilter="" ist das Feld
   *  verborgen und der Filter wird ignoriert. */
  const empfaengerFilter = liste.wert('empf');
  const statusFilter = liste.wert('status', 'alle') as RechnungStatus | 'alle';
  /** '' = alle; 'nicht_versendet' = noch nicht (erfolgreich) versendet. */
  const versandFilter = liste.wert('versand');
  const search = liste.wert('suche');
  const seiteParam = Number(liste.wert('seite', '1'));

  // Versandstatus (Migration 111)
  const [versandMap, setVersandMap] = useState<Map<string, VersandEintrag[]>>(new Map());
  const [versandFehlt, setVersandFehlt] = useState(false);
  const [markierenOffen, setMarkierenOffen] = useState(false);
  const [altbestandOffen, setAltbestandOffen] = useState(false);

  // Mehrfach-Auswahl für Sammelaktionen (als bezahlt / offen markieren).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<null | 'bezahlt' | 'offen'>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(t: string) {
    setToast(t);
    window.setTimeout(() => setToast((cur) => (cur === t ? null : cur)), 4000);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Beide Seiten parallel laden — Rechnungen + Auftraggeber-Optionen.
    // Alle Rechnungen in Blöcken — vorher `.limit(500)`: ältere Rechnungen
    // tauchten in Liste und Filtern nicht mehr auf.
    const nlSpalte = (await mitNiederlassungSpalte('')).replace(/^,\s*/, '').replace(/^(.+)$/, '$1,');
    const [rBloecke, aRes, vRes] = await Promise.all([
      ladeInBloecken((v, bis) => supabase
        .from('rechnungen')
        // Egress-Optimierung: nur die Spalten, die die Listen-Ansicht
        // tatsächlich anzeigt + Filter braucht. Notizen, Adress-
        // Snapshot-Felder, anrede, sachbearbeiter, kundennummer,
        // ust_betrag, bezahlt_am, ust_satz, pdf_url, belege_pdf_url,
        // email_versendet_am sind nur im Detail relevant — Detail-
        // Page lädt sich ihre Zeile separat mit *.
        .select(`${nlSpalte}
          id, rechnungsnummer, auftraggeber_id, datum, created_at,
          empfaenger_typ, rechnungsadresse_firma, ansprechpartner,
          leistungszeitraum_von, leistungszeitraum_bis,
          netto_summe, brutto_summe, status, ist_auslagen_rechnung, email_versendet_am,
          auftraggeber:auftraggeber_id (id, name),
          rechnungsempfaenger:rechnungsempfaenger_id (id, name),
          positionen:rechnungspositionen(count)
        `)
        // Nur für stabiles Blättern beim Laden; die angezeigte Reihenfolge
        // (Nummer numerisch, Re_26/1000 vor Re_26/999) setzt
        // neuesteBelegeZuerst unten.
        .order('datum', { ascending: false })
        .order('id', { ascending: true })
        .range(v, bis)),
      supabase.from('auftraggeber').select('id, name').order('name'),
      ladeVersand('rechnung').catch(() => ({ map: new Map<string, VersandEintrag[]>(), fehlt: true })),
    ]);
    const rRes = { data: rBloecke.data, error: rBloecke.error ? { message: rBloecke.error } : null };
    if (rRes.error) { setError(rRes.error.message); setLoading(false); return; }
    if (aRes.error) { setError(aRes.error.message); setLoading(false); return; }
    type RawRow = Rechnung & {
      auftraggeber: { id: string; name: string } | null;
      empfaenger_typ: string;
      rechnungsadresse_firma: string | null;
      ansprechpartner: string | null;
      rechnungsempfaenger: { id: string; name: string } | null;
      positionen: Array<{ count: number }>;
    };
    const list: RechnungRow[] = ((rRes.data as unknown as RawRow[]) ?? []).map((r) => ({
      ...r,
      positionen_count: r.positionen?.[0]?.count ?? 0,
    }));
    setRows(neuesteBelegeZuerst(list, (r) => r.rechnungsnummer, (r) => r.datum, (r) => r.created_at));
    setAuftraggeber(aRes.data ?? []);
    setVersandMap(vRes.map);
    setVersandFehlt(vRes.fehlt);
    setLoading(false);
  }, []);

  const versandById = useMemo(() => {
    const m = new Map<string, VersandStatus>();
    for (const r of rows) m.set(r.id, versandStatus('rechnung', r.status, versandMap.get(r.id) ?? []));
    return m;
  }, [rows, versandMap]);
  const nichtVersendet = (id: string) => {
    const a = versandById.get(id)?.art;
    return a === 'nicht_versendet' || a === 'fehlgeschlagen';
  };
  const nichtVersendetZahl = useMemo(
    () => rows.filter((r) => { const a = versandById.get(r.id)?.art; return a === 'nicht_versendet' || a === 'fehlgeschlagen'; }).length,
    [rows, versandById],
  );
  const fehlgeschlagenZahl = useMemo(
    () => rows.filter((r) => versandById.get(r.id)?.art === 'fehlgeschlagen').length,
    [rows, versandById],
  );

  /** Filter setzen: URL (Seite 1) + Auswahl leeren — sonst könnten nicht
   *  mehr sichtbare (ausgefilterte) Rechnungen in der Sammelaktion landen. */
  function setFilter(patch: Record<string, string | number | null>) {
    liste.setze(patch);
    setSelected(new Set());
  }

  useEffect(() => { void load(); }, [load]);

  // Jahres-Pills aus den vorhandenen Datumswerten ableiten + immer das aktuelle Jahr.
  const yearOptions = useMemo(() => {
    const set = new Set<number>([new Date().getFullYear()]);
    for (const r of rows) {
      const y = Number((r.datum ?? '').slice(0, 4));
      if (Number.isFinite(y) && y > 1990) set.add(y);
    }
    return Array.from(set).sort((a, b) => b - a);
  }, [rows]);

  const yearCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    let alle = 0;
    for (const r of rows) {
      alle += 1;
      const y = Number((r.datum ?? '').slice(0, 4));
      if (Number.isFinite(y)) counts[y] = (counts[y] ?? 0) + 1;
    }
    return { alle, byYear: counts };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (yearFilter !== 'alle') {
        const y = Number((r.datum ?? '').slice(0, 4));
        if (y !== yearFilter) return false;
      }
      // "__manuell" filtert auf Rechnungen ohne Auftraggeber-Bezug.
      if (agFilter === MANUELL_OPTION) {
        if (r.empfaenger_typ !== 'manuell') return false;
      } else if (agFilter && !filterPasst(agFilter, r.auftraggeber_id, r.niederlassung_id)) return false;
      if (agFilter && empfaengerFilter && r.rechnungsempfaenger?.id !== empfaengerFilter) return false;
      if (statusFilter !== 'alle' && r.status !== statusFilter) return false;
      if (versandFilter === 'nicht_versendet' && !nichtVersendet(r.id)) return false;
      if (q) {
        const hay = [
          r.rechnungsnummer,
          r.auftraggeber ? auftraggeberAnzeige(standorte, r.auftraggeber_id, r.niederlassung_id, r.auftraggeber.name) : '',
          r.empfaenger_typ === 'manuell' ? empfaengerAusSnapshot({
            firma: r.rechnungsadresse_firma, ansprechpartner: r.ansprechpartner,
          }) : '',
          r.rechnungsempfaenger?.name ?? '',
        ].join(' ').toLowerCase();
        if (!hay.includes(q) && !standortPasstZuSuche(standorte, r.auftraggeber_id, r.niederlassung_id, q)) return false;
      }
      return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, yearFilter, agFilter, empfaengerFilter, statusFilter, versandFilter, versandById, search, standorte]);

  // Empfänger-Optionen aus den geladenen Rechnungen, sobald ein
  // Auftraggeber gefiltert wird — eine Map nach Id mit Name.
  const empfaengerOptions = useMemo(() => {
    if (!agFilter) return [] as Array<{ id: string; name: string }>;
    const map = new Map<string, string>();
    for (const r of rows) {
      if (agFilter === MANUELL_OPTION) continue;
      if (r.auftraggeber_id !== filterAuftraggeber(agFilter)) continue;
      const e = r.rechnungsempfaenger;
      if (e?.id && e.name) map.set(e.id, e.name);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
  }, [rows, agFilter]);

  // Auftraggeber-Wechsel räumt den Empfaenger-Filter direkt im
  // onChange-Handler des Dropdowns auf — siehe weiter unten —
  // damit der React-Linter (set-state-in-effect) zufrieden ist.

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Gibt es die Seite (nach Filter) nicht mehr → letzte vorhandene.
  const page = loading ? Math.max(1, seiteParam || 1) : seiteBegrenzen(seiteParam, pageCount);
  const pageRows = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );
  useWiederherstellen(liste.wiederherstellen, !loading);

  // KPI berechnen aus filtered (das ist der relevante Zeitraum/Filter).
  const kpi = useMemo(() => {
    const total = filtered.length;
    let offen = 0;
    let bezahlt = 0;
    let entwuerfe = 0;
    for (const r of filtered) {
      const n = Number(r.netto_summe) || 0;
      if (r.status === 'offen') offen += n;
      if (r.status === 'bezahlt') bezahlt += n;
      if (r.status === 'entwurf') entwuerfe += 1;
    }
    return { total, offen, bezahlt, entwuerfe };
  }, [filtered]);

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { alle: rows.length };
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  // ---- Mehrfach-Auswahl ------------------------------------------------
  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // „Alle auswählen" bezieht sich auf die aktuell GEFILTERTEN Rechnungen
  // (über alle Seiten der Pagination hinweg — die Filter sind die
  // sichtbare Menge).
  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const someFilteredSelected = filtered.some((r) => selected.has(r.id));
  function toggleSelectAll() {
    setSelected(allFilteredSelected ? new Set() : new Set(filtered.map((r) => r.id)));
  }

  /**
   * Sammelaktion: setzt den Status der ausgewählten Rechnungen — mit
   * demselben Patch wie der Einzel-Flow in der Detail-Ansicht
   * (bezahlt → { status, bezahlt_am }; offen → { status, bezahlt_am: null }).
   * Umgestellt werden NUR Rechnungen, für die der Übergang im Einzel-Flow
   * existiert: offen → bezahlt bzw. bezahlt → offen. Entwürfe und bereits
   * im Zielstatus befindliche werden übersprungen.
   */
  async function runBulkStatus(target: 'bezahlt' | 'offen', bezahltAm?: string) {
    const eligible = rows.filter((r) =>
      selected.has(r.id)
      && (target === 'bezahlt' ? r.status === 'offen' : r.status === 'bezahlt'));
    const ids = eligible.map((r) => r.id);
    setBulkAction(null);
    if (ids.length === 0) {
      showToast(target === 'bezahlt'
        ? 'Keine offene Rechnung in der Auswahl — nichts umgestellt.'
        : 'Keine bezahlte Rechnung in der Auswahl — nichts umgestellt.');
      return;
    }
    setBulkBusy(true);
    const patch = target === 'bezahlt'
      ? { status: 'bezahlt' as const, bezahlt_am: bezahltAm ?? todayIso() }
      : { status: 'offen' as const, bezahlt_am: null };
    const { error: err } = await supabase
      .from('rechnungen')
      .update(patch)
      .in('id', ids);
    setBulkBusy(false);
    if (err) { setError(err.message); return; }
    setSelected(new Set());
    await load();
    const skipped = selected.size - ids.length;
    showToast(
      `${ids.length} Rechnung${ids.length === 1 ? '' : 'en'} als ${target === 'bezahlt' ? 'bezahlt' : 'offen'} markiert`
      + (skipped > 0 ? ` (${skipped} übersprungen)` : ''),
    );
  }

  return (
    <div className="space-y-5">
      <RechnungenTabs />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-maja-navy">Rechnungen</h1>
          <p className="text-sm text-maja-muted">
            Alle Rechnungen pro Auftraggeber, Zeitraum und Status. Klick auf
            eine Zeile öffnet die Detail-Ansicht.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => navigate('/rechnungen/neu')}
        >
          + Neue Rechnung
        </button>
      </div>

      {/* Hinweis: Rechnungen ohne Versand (Entwürfe/stornierte zählen nicht) */}
      {!loading && !versandFehlt && nichtVersendetZahl > 0 && versandFilter !== 'nicht_versendet' && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <button
            type="button"
            className="text-left font-semibold underline-offset-2 hover:underline"
            onClick={() => setFilter({ versand: 'nicht_versendet', jahr: 'alle', status: null, ag: null, empf: null, suche: null })}
          >
            ⚠ {nichtVersendetZahl} Rechnung{nichtVersendetZahl === 1 ? ' ist' : 'en sind'} noch nicht versendet
            {fehlgeschlagenZahl > 0 && ` (davon ${fehlgeschlagenZahl} Versand fehlgeschlagen)`} — anzeigen
          </button>
          <button type="button" className="text-xs font-medium underline" onClick={() => setAltbestandOffen(true)}>
            Versandstatus für bestehende Rechnungen übernehmen …
          </button>
        </div>
      )}

      {/* Jahres-Pills */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-maja-muted">Jahr</span>
        <button
          type="button"
          onClick={() => setFilter({ jahr: 'alle' })}
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            yearFilter === 'alle' ? 'bg-maja-navy text-white' : 'bg-white text-maja-navy hover:bg-maja-light'
          }`}
        >
          Alle ({yearCounts.alle})
        </button>
        {yearOptions.map((y) => (
          <button
            key={y}
            type="button"
            onClick={() => setFilter({ jahr: y === new Date().getFullYear() ? null : y })}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              yearFilter === y ? 'bg-maja-navy text-white' : 'bg-white text-maja-navy hover:bg-maja-light'
            }`}
          >
            {y} ({yearCounts.byYear[y] ?? 0})
          </button>
        ))}
      </div>

      {/* Auftraggeber + (optional) Rechnungsempfänger + Suche */}
      <div className={`grid gap-2 ${
        agFilter && empfaengerOptions.length > 0
          ? 'sm:grid-cols-[1fr_1fr_1fr]'
          : 'sm:grid-cols-[1fr_1fr]'
      }`}>
        <div>
          <label htmlFor="ag-filter" className="label">Auftraggeber</label>
          <select
            id="ag-filter"
            className="input"
            value={agFilter}
            onChange={(e) => setFilter({ ag: e.target.value, empf: null })}
          >
            <option value="">Alle</option>
            <option value={MANUELL_OPTION}>Manuell (kein Auftraggeber)</option>
            {filterOptionen(standorte, auftraggeber).map((o) => (
              <option key={o.wert} value={o.wert}>{o.eingerueckt ? `\u2003${o.label}` : o.label}</option>
            ))}
          </select>
        </div>
        {agFilter && empfaengerOptions.length > 0 && (
          <div>
            <label htmlFor="empf-filter" className="label">Rechnungsempfänger</label>
            <select
              id="empf-filter"
              className="input"
              value={empfaengerFilter}
              onChange={(e) => setFilter({ empf: e.target.value })}
            >
              <option value="">Alle</option>
              {empfaengerOptions.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="search" className="label">Suche</label>
          <input
            id="search"
            className="input"
            placeholder="Rechnungsnummer, Auftraggeber, Empfänger …"
            value={search}
            onChange={(e) => setFilter({ suche: e.target.value })}
          />
        </div>
      </div>

      {/* Status-Pills */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-maja-muted">Status</span>
        {STATUS_ORDER.map((s) => {
          const active = statusFilter === s;
          const label = s === 'alle' ? 'Alle' : RECHNUNG_STATUS_LABEL[s];
          const cnt = statusCounts[s] ?? 0;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setFilter({ status: s === 'alle' ? null : s })}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                active ? 'bg-maja-navy text-white' : 'bg-white text-maja-navy hover:bg-maja-light'
              }`}
            >
              {label} ({cnt})
            </button>
          );
        })}
      </div>

      {/* Versand-Filter */}
      {!versandFehlt && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-maja-muted">Versand</span>
          {([['', 'Alle'], ['nicht_versendet', `Nicht versendet (${nichtVersendetZahl})`]] as const).map(([v, label]) => (
            <button
              key={v || 'alle'}
              type="button"
              onClick={() => setFilter({ versand: v || null })}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                versandFilter === v ? 'bg-maja-navy text-white' : 'bg-white text-maja-navy hover:bg-maja-light'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* KPI-Karten */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Rechnungen" value={String(kpi.total)} hint="im gewählten Filter" />
        <KpiCard title="Offen (Netto)" value={formatEuro(kpi.offen)} hint="Status offen" accent />
        <KpiCard title="Bezahlt (Netto)" value={formatEuro(kpi.bezahlt)} hint="Status bezahlt" />
        <KpiCard title="Entwürfe" value={String(kpi.entwuerfe)} hint="Status entwurf" />
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Aktionsleiste für die Mehrfach-Auswahl */}
      {selected.size > 0 && (
        <div className="card flex flex-wrap items-center gap-3 border border-maja-navy/15 p-3">
          <span className="text-sm font-medium text-maja-ink">
            {selected.size} ausgewählt
          </span>
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={bulkBusy}
            onClick={() => setBulkAction('bezahlt')}
          >
            {bulkBusy ? 'Wird umgestellt …' : 'Als bezahlt markieren'}
          </button>
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={bulkBusy}
            onClick={() => setBulkAction('offen')}
          >
            Als offen markieren
          </button>
          {!versandFehlt && (
            <button
              type="button"
              className="btn-secondary text-sm"
              disabled={bulkBusy}
              onClick={() => setMarkierenOffen(true)}
            >
              Ausgewählte als versendet markieren
            </button>
          )}
          <button
            type="button"
            className="text-sm font-medium text-maja-muted hover:text-maja-navy hover:underline"
            disabled={bulkBusy}
            onClick={() => setSelected(new Set())}
          >
            Auswahl aufheben
          </button>
        </div>
      )}

      {loading ? (
        <Spinner label="Rechnungen werden geladen …" />
      ) : filtered.length === 0 ? (
        <div className="card p-6 text-sm text-maja-muted">
          Keine Rechnungen für den gewählten Filter.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-maja-light text-left text-maja-navy">
              <tr>
                <th className="w-10 px-3 py-2">
                  <SelectAllCheckbox
                    checked={allFilteredSelected}
                    indeterminate={someFilteredSelected && !allFilteredSelected}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className="px-3 py-2 font-semibold">Rechnung</th>
                <th className="px-3 py-2 font-semibold">Datum</th>
                <th className="px-3 py-2 font-semibold">Auftraggeber</th>
                <th className="px-3 py-2 font-semibold">Zeitraum</th>
                <th className="px-3 py-2 text-right font-semibold">Pos.</th>
                <th className="px-3 py-2 text-right font-semibold">Netto</th>
                <th className="px-3 py-2 text-right font-semibold">Brutto</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                {!versandFehlt && <th className="px-3 py-2 font-semibold">Versand</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-maja-navy/10">
              {pageRows.map((r) => (
                <tr
                  key={r.id}
                  data-rechnung={r.id}
                  className={`cursor-pointer hover:bg-maja-light/40 ${
                    liste.hervorgehoben === r.id ? 'bg-amber-50 ring-2 ring-inset ring-amber-300 transition-colors' : ''
                  }`}
                  onClick={() => {
                    liste.merkeAbsprung(r.id);
                    navigate(`/rechnungen/${r.id}`, { state: { vonListe: true } });
                  }}
                >
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy focus:ring-maja-navy"
                      checked={selected.has(r.id)}
                      onChange={() => toggleSelected(r.id)}
                      aria-label={`Rechnung ${r.rechnungsnummer} auswählen`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-maja-ink">{r.rechnungsnummer}</span>
                      {r.ist_auslagen_rechnung && (
                        <span className="inline-flex rounded-full bg-maja-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-maja-accent">
                          Auslagen
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-maja-ink">{formatDate(r.datum)}</td>
                  <td className="px-3 py-2 text-maja-ink">
                    {r.empfaenger_typ === 'manuell' ? (
                      <>
                        {empfaengerAusSnapshot({
                          firma: r.rechnungsadresse_firma,
                          ansprechpartner: r.ansprechpartner,
                        })}
                        <span className="ml-1 text-xs text-maja-muted">(manuell)</span>
                      </>
                    ) : (r.auftraggeber ? auftraggeberAnzeige(standorte, r.auftraggeber_id, r.niederlassung_id, r.auftraggeber.name) : '—')}
                    {r.rechnungsempfaenger?.name && (
                      <div className="text-xs text-maja-muted">
                        z. Hd. {r.rechnungsempfaenger.name}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-maja-muted">
                    {formatDate(r.leistungszeitraum_von)} – {formatDate(r.leistungszeitraum_bis)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.positionen_count}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formatEuro(Number(r.netto_summe))}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-maja-navy">
                    {formatEuro(Number(r.brutto_summe))}
                  </td>
                  <td className="px-3 py-2"><RechnungStatusBadge status={r.status} /></td>
                  {!versandFehlt && (
                    <td className="px-3 py-2">
                      {versandById.get(r.id) && <VersandBadge status={versandById.get(r.id)!} />}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button
            type="button"
            className="btn-secondary px-3 py-1"
            disabled={page <= 1}
            onClick={() => liste.setze({ seite: page - 1 > 1 ? page - 1 : null })}
          >Zurück</button>
          <span className="text-maja-muted">Seite {page} / {pageCount}</span>
          <button
            type="button"
            className="btn-secondary px-3 py-1"
            disabled={page >= pageCount}
            onClick={() => liste.setze({ seite: Math.min(pageCount, page + 1) })}
          >Weiter</button>
        </div>
      )}

      {bulkAction === 'bezahlt' && (
        <BulkBezahltDialog
          count={selected.size}
          onCancel={() => setBulkAction(null)}
          onConfirm={(datum) => void runBulkStatus('bezahlt', datum)}
        />
      )}
      {bulkAction === 'offen' && (
        <ConfirmDialog
          title="Als offen markieren?"
          message={
            <>
              {selected.size} ausgewählte Rechnung{selected.size === 1 ? '' : 'en'} zurück
              auf <strong>offen</strong> setzen? Das Bezahlt-Datum wird entfernt.
              Nur bezahlte Rechnungen werden umgestellt.
            </>
          }
          confirmLabel="Als offen markieren"
          onConfirm={() => runBulkStatus('offen')}
          onClose={() => setBulkAction(null)}
        />
      )}

      {markierenOffen && (
        <VersendetMarkierenDialog
          titel={`${selected.size} Rechnung${selected.size === 1 ? '' : 'en'} als versendet markieren`}
          hinweis="Entwürfe werden übersprungen. Jede Markierung wird mit Benutzer und Zeitpunkt protokolliert."
          onCancel={() => setMarkierenOffen(false)}
          onConfirm={async (weg, datum, notiz) => {
            const r = await alsVersendetMarkieren('rechnung', [...selected], weg, datum, notiz);
            setMarkierenOffen(false);
            setSelected(new Set());
            await load();
            showToast(`${r.markiert} Rechnung${r.markiert === 1 ? '' : 'en'} als versendet markiert`
              + (r.uebersprungen.length ? ` (${r.uebersprungen.length} übersprungen: ${r.uebersprungen.map((u) => u.nummer).join(', ')})` : ''));
          }}
        />
      )}
      {altbestandOffen && (
        <VersandAltbestandDialog
          typ="rechnung"
          belege={rows.map((r) => ({
            id: r.id, nummer: r.rechnungsnummer, datum: r.datum, status: r.status, email_versendet_am: r.email_versendet_am,
          }))}
          versand={versandMap}
          onClose={() => setAltbestandOffen(false)}
          onDone={(text) => { setAltbestandOffen(false); void load(); showToast(text); }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-maja-navy px-4 py-2 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

/** Kopf-Checkbox mit indeterminate-Zustand (teilweise Auswahl). */
function SelectAllCheckbox({
  checked, indeterminate, onChange,
}: { checked: boolean; indeterminate: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy focus:ring-maja-navy"
      checked={checked}
      onChange={onChange}
      aria-label="Alle gefilterten Rechnungen auswählen"
    />
  );
}

/**
 * Bestätigung der Sammelaktion „Als bezahlt markieren" — mit demselben
 * „Bezahlt am"-Datum wie der Einzel-Flow (BezahltDialog in der
 * Detail-Ansicht). Default: heute.
 */
function BulkBezahltDialog({
  count, onCancel, onConfirm,
}: { count: number; onCancel: () => void; onConfirm: (datum: string) => void }) {
  const [d, setD] = useState(todayIso());
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-maja-ink/40 px-4">
      <div className="card w-full max-w-sm p-5">
        <h3 className="text-base font-semibold text-maja-navy">
          {count} Rechnung{count === 1 ? '' : 'en'} als bezahlt markieren?
        </h3>
        <p className="mt-1 text-xs text-maja-muted">
          Nur offene Rechnungen werden umgestellt — Entwürfe und bereits
          bezahlte bleiben unverändert.
        </p>
        <label htmlFor="bulk-bezahlt-am" className="label mt-3">Bezahlt am</label>
        <input
          id="bulk-bezahlt-am"
          type="date" className="input" value={d}
          onChange={(e) => setD(e.target.value)}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Abbrechen
          </button>
          <button
            type="button" className="btn-primary"
            disabled={!d}
            onClick={() => onConfirm(d)}
          >
            Als bezahlt markieren
          </button>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ title, value, hint, accent }: { title: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-maja-muted">{title}</div>
      <div className={`mt-1 text-2xl font-semibold ${accent ? 'text-maja-accent' : 'text-maja-navy'}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-maja-muted">{hint}</div>}
    </div>
  );
}
