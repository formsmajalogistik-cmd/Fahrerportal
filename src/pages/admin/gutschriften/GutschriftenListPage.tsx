// Übersicht der Gutschriften / Rechnungskorrekturen.
//
// Bewusst schlanker als die Rechnungsliste: KEINE KPI-Karten, KEIN
// „bezahlt"-Status und keine Zahlungsverfolgung. Filter auf Jahr,
// Auftraggeber und Nummer; neueste zuerst.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useListenZustand, useWiederherstellen } from '../../../lib/useListenZustand';
import {
  alsVersendetMarkieren, ladeVersand, versandStatus, type VersandEintrag, type VersandStatus,
} from '../../../lib/belegVersand';
import { VersandBadge } from '../../../components/versand/VersandBadge';
import { VersendetMarkierenDialog } from '../../../components/versand/VersendetMarkierenDialog';
import { VersandAltbestandDialog } from '../../../components/versand/VersandAltbestandDialog';
import { supabase } from '../../../lib/supabase';
import { neuesteBelegeZuerst } from '../../../lib/belegNummer';
import { Spinner } from '../../../components/Spinner';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { DownloadIcon, EyeIcon, MailIcon } from '../../../components/icons';
import { formatDate, formatEuro } from '../../../lib/touren';
import { previewOneDrivePdf, triggerOneDriveDownload } from '../../../lib/onedrive';
import { RechnungenTabs } from '../rechnungen/RechnungenTabs';
import { GutschriftEmailDialog } from './GutschriftEmailDialog';
import { GutschriftStatusBadge } from './GutschriftStatusBadge';
import {
  gutschriftPdfFilename, type Gutschrift,
} from '../../../lib/gutschriften';
import {
  DEFAULT_GUTSCHRIFT_SETTINGS, loadGutschriftSettings,
  type GutschriftSettings,
} from '../../../lib/gutschriftSettings';
import { MANUELL_OPTION, empfaengerAusSnapshot } from '../../../lib/manuelleEmpfaenger';
import { parseAdressSnapshot } from '../../../lib/gutschriften';
import type { Auftraggeber, AuftraggeberKontakt } from '../../../types/db';
import { auftraggeberAnzeige, filterOptionen, filterPasst } from '../../../lib/niederlassungen';
import { useStandorte } from '../../../lib/useStandorte';

/** Empfängername einer manuellen Gutschrift aus ihrem Adress-Snapshot. */
function gutschriftEmpfaenger(g: { adress_snapshot: unknown }): string {
  const a = parseAdressSnapshot(g.adress_snapshot);
  return empfaengerAusSnapshot({ firma: a.firma, ansprechpartner: a.ansprechpartner });
}

interface Row extends Gutschrift {
  auftraggeber: Pick<Auftraggeber, 'id' | 'name'> | null;
  rechnungsempfaenger: Pick<AuftraggeberKontakt, 'id' | 'name'> | null;
  rechnung: { id: string; rechnungsnummer: string; datum: string } | null;
}

export function GutschriftenListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [auftraggeber, setAuftraggeber] = useState<Pick<Auftraggeber, 'id' | 'name'>[]>([]);
  const [settings, setSettings] = useState<GutschriftSettings>(DEFAULT_GUTSCHRIFT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter + Suche in der URL (?jahr=…&ag=…&versand=…&suche=…), damit
  // „Zurück" aus einer Gutschrift genau auf diesen Stand führt.
  const liste = useListenZustand('gutschriften');
  const jahrParam = liste.wert('jahr', String(new Date().getFullYear()));
  const yearFilter: number | 'alle' = jahrParam === 'alle' ? 'alle' : Number(jahrParam) || new Date().getFullYear();
  const agFilter = liste.wert('ag');
  const { standorte } = useStandorte();
  const search = liste.wert('suche');
  const versandFilter = liste.wert('versand');

  // Versandstatus (Migration 111)
  const [versandMap, setVersandMap] = useState<Map<string, VersandEintrag[]>>(new Map());
  const [versandFehlt, setVersandFehlt] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [markierenOffen, setMarkierenOffen] = useState(false);
  const [altbestandOffen, setAltbestandOffen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  function setFilter(patch: Record<string, string | number | null>) {
    liste.setze(patch);
    setSelected(new Set());
  }

  const [emailFor, setEmailFor] = useState<Row | null>(null);
  const [deleteFor, setDeleteFor] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [gRes, aRes, sRes, vRes] = await Promise.all([
      supabase
        .from('gutschriften')
        .select(`
          *,
          auftraggeber:auftraggeber_id (id, name),
          rechnungsempfaenger:rechnungsempfaenger_id (id, name),
          rechnung:rechnung_id (id, rechnungsnummer, datum)
        `)
        // Neueste zuerst.
        .order('datum', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500),
      supabase.from('auftraggeber').select('id, name').order('name'),
      loadGutschriftSettings(),
      ladeVersand('gutschrift').catch(() => ({ map: new Map<string, VersandEintrag[]>(), fehlt: true })),
    ]);
    if (gRes.error) { setError(gRes.error.message); setLoading(false); return; }
    if (aRes.error) { setError(aRes.error.message); setLoading(false); return; }
    // Am selben Tag die höhere Nummer zuerst — numerisch, nicht als Text.
    setRows(neuesteBelegeZuerst((gRes.data as unknown as Row[]) ?? [], (r) => r.gutschrift_nr, (r) => r.datum, (r) => r.created_at));
    setAuftraggeber(aRes.data ?? []);
    setSettings(sRes);
    setVersandMap(vRes.map);
    setVersandFehlt(vRes.fehlt);
    setLoading(false);
  }, []);

  const versandById = useMemo(() => {
    const m = new Map<string, VersandStatus>();
    for (const r of rows) m.set(r.id, versandStatus('gutschrift', r.status, versandMap.get(r.id) ?? []));
    return m;
  }, [rows, versandMap]);
  const istNichtVersendet = useCallback((id: string) => {
    const a = versandById.get(id)?.art;
    return a === 'nicht_versendet' || a === 'fehlgeschlagen';
  }, [versandById]);
  const nichtVersendetZahl = useMemo(() => rows.filter((r) => istNichtVersendet(r.id)).length, [rows, istNichtVersendet]);
  useWiederherstellen(liste.wiederherstellen, !loading);

  useEffect(() => {
    const t = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const yearOptions = useMemo(() => {
    const set = new Set<number>([new Date().getFullYear()]);
    for (const r of rows) {
      const y = Number((r.datum ?? '').slice(0, 4));
      if (Number.isFinite(y) && y > 1990) set.add(y);
    }
    return Array.from(set).sort((a, b) => b - a);
  }, [rows]);

  const gefiltert = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (yearFilter !== 'alle' && Number((r.datum ?? '').slice(0, 4)) !== yearFilter) return false;
      if (agFilter === MANUELL_OPTION) {
        if (r.empfaenger_typ !== 'manuell') return false;
      } else if (agFilter && !filterPasst(agFilter, r.auftraggeber_id, r.niederlassung_id)) return false;
      if (versandFilter === 'nicht_versendet' && !istNichtVersendet(r.id)) return false;
      if (!q) return true;
      return r.gutschrift_nr.toLowerCase().includes(q)
        || (r.auftraggeber ? auftraggeberAnzeige(standorte, r.auftraggeber_id, r.niederlassung_id, r.auftraggeber.name) : '').toLowerCase().includes(q)
        || (r.empfaenger_typ === 'manuell'
          ? gutschriftEmpfaenger(r).toLowerCase().includes(q) : false)
        || (r.rechnung?.rechnungsnummer ?? '').toLowerCase().includes(q);
    });
  }, [rows, yearFilter, agFilter, search, versandFilter, istNichtVersendet, standorte]);

  async function loeschen(row: Row) {
    const { error: err } = await supabase.from('gutschriften').delete().eq('id', row.id);
    if (err) { setError(err.message); return; }
    setRows((cur) => cur.filter((r) => r.id !== row.id));
    setDeleteFor(null);
  }

  const bezeichnung = settings.dokumentbezeichnung;

  return (
    <div className="space-y-5">
      <RechnungenTabs />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-maja-navy">{bezeichnung}en</h1>
          <p className="text-sm text-maja-muted">
            Rechnungskorrekturen mit eigener Nummernserie. Klick auf eine
            Zeile öffnet die Detail-Ansicht.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => navigate('/gutschriften/neu')}>
          + Neue {bezeichnung}
        </button>
      </div>

      {!loading && !versandFehlt && nichtVersendetZahl > 0 && versandFilter !== 'nicht_versendet' && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <button type="button" className="text-left font-semibold underline-offset-2 hover:underline"
                  onClick={() => setFilter({ versand: 'nicht_versendet', jahr: 'alle', ag: null, suche: null })}>
            ⚠ {nichtVersendetZahl} {bezeichnung}{nichtVersendetZahl === 1 ? ' ist' : 'en sind'} noch nicht versendet — anzeigen
          </button>
          <button type="button" className="text-xs font-medium underline" onClick={() => setAltbestandOffen(true)}>
            Versandstatus für bestehende {bezeichnung}en übernehmen …
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
        >Alle</button>
        {yearOptions.map((y) => (
          <button
            key={y}
            type="button"
            onClick={() => setFilter({ jahr: y === new Date().getFullYear() ? null : y })}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              yearFilter === y ? 'bg-maja-navy text-white' : 'bg-white text-maja-navy hover:bg-maja-light'
            }`}
          >{y}</button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label htmlFor="gs-ag-filter" className="label">Auftraggeber</label>
          <select id="gs-ag-filter" className="input" value={agFilter}
                  onChange={(e) => setFilter({ ag: e.target.value })}>
            <option value="">Alle</option>
            <option value={MANUELL_OPTION}>Manuell (kein Auftraggeber)</option>
            {filterOptionen(standorte, auftraggeber).map((o) => <option key={o.wert} value={o.wert}>{o.eingerueckt ? `\u2003${o.label}` : o.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="gs-search" className="label">Suche</label>
          <input id="gs-search" className="input"
                 placeholder="Nummer, Auftraggeber, Rechnung …"
                 value={search} onChange={(e) => setFilter({ suche: e.target.value })} />
        </div>
      </div>

      {!versandFehlt && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-maja-muted">Versand</span>
          {([['', 'Alle'], ['nicht_versendet', `Nicht versendet (${nichtVersendetZahl})`]] as const).map(([v, label]) => (
            <button key={v || 'alle'} type="button" onClick={() => setFilter({ versand: v || null })}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      versandFilter === v ? 'bg-maja-navy text-white' : 'bg-white text-maja-navy hover:bg-maja-light'
                    }`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {selected.size > 0 && (
        <div className="card flex flex-wrap items-center gap-3 border border-maja-navy/15 p-3">
          <span className="text-sm font-medium text-maja-ink">{selected.size} ausgewählt</span>
          <button type="button" className="btn-secondary text-sm" onClick={() => setMarkierenOffen(true)}>
            Ausgewählte als versendet markieren
          </button>
          <button type="button" className="text-sm font-medium text-maja-muted hover:text-maja-navy hover:underline"
                  onClick={() => setSelected(new Set())}>Auswahl aufheben</button>
        </div>
      )}

      {loading ? (
        <Spinner label={`${bezeichnung}en werden geladen …`} />
      ) : gefiltert.length === 0 ? (
        <div className="card p-6 text-sm text-maja-muted">
          Keine {bezeichnung}en für den gewählten Filter.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-maja-navy/10">
          <table className="w-full text-sm">
            <thead className="bg-maja-light text-left text-maja-navy">
              <tr>
                {!versandFehlt && <th className="w-10 px-3 py-2"><span className="sr-only">Auswahl</span></th>}
                <th className="px-3 py-2 font-semibold">Nummer</th>
                <th className="px-3 py-2 font-semibold">Datum</th>
                <th className="px-3 py-2 font-semibold">Auftraggeber</th>
                <th className="px-3 py-2 font-semibold">Bezug</th>
                <th className="px-3 py-2 text-right font-semibold">Brutto</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                {!versandFehlt && <th className="px-3 py-2 font-semibold">Versand</th>}
                <th className="px-3 py-2 text-right font-semibold">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-maja-navy/10">
              {gefiltert.map((r) => (
                <tr key={r.id} className={`hover:bg-maja-light/40 ${
                  liste.hervorgehoben === r.id ? 'bg-amber-50 ring-2 ring-inset ring-amber-300' : ''
                }`}>
                  {!versandFehlt && (
                    <td className="px-3 py-2">
                      <input type="checkbox" className="h-4 w-4 rounded border-maja-navy/30 text-maja-navy"
                             aria-label={`${r.gutschrift_nr} auswählen`}
                             checked={selected.has(r.id)}
                             onChange={() => setSelected((s) => {
                               const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n;
                             })} />
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <button type="button"
                            className="font-medium text-maja-navy hover:underline"
                            onClick={() => {
                              liste.merkeAbsprung(r.id);
                              navigate(`/gutschriften/${r.id}`, { state: { vonListe: true } });
                            }}>
                      {r.gutschrift_nr}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-maja-ink">{formatDate(r.datum)}</td>
                  <td className="px-3 py-2 text-maja-ink">
                    {r.empfaenger_typ === 'manuell' ? (
                      <>
                        {gutschriftEmpfaenger(r)}
                        <span className="ml-1 text-xs text-maja-muted">(manuell)</span>
                      </>
                    ) : (r.auftraggeber ? auftraggeberAnzeige(standorte, r.auftraggeber_id, r.niederlassung_id, r.auftraggeber.name) : '—')}
                    {r.rechnungsempfaenger?.name && (
                      <span className="block text-xs text-maja-muted">
                        {r.rechnungsempfaenger.name}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.rechnung ? (
                      <button type="button"
                              className="text-maja-accent hover:underline"
                              onClick={() => navigate(`/rechnungen/${r.rechnung!.id}`)}>
                        {r.rechnung.rechnungsnummer}
                      </button>
                    ) : <span className="text-maja-muted">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-maja-ink">
                    {formatEuro(Number(r.brutto_summe))}
                  </td>
                  <td className="px-3 py-2">
                    <GutschriftStatusBadge status={r.status} />
                    {versandFehlt && r.email_versendet_am && (
                      <span className="block text-[11px] text-maja-muted">
                        versendet {formatDate(r.email_versendet_am)}
                      </span>
                    )}
                  </td>
                  {!versandFehlt && (
                    <td className="px-3 py-2">
                      {versandById.get(r.id) && <VersandBadge status={versandById.get(r.id)!} />}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <IconAction
                        label="PDF-Vorschau"
                        disabled={!r.pdf_url}
                        onClick={() => void previewOneDrivePdf(r.pdf_url!, {
                          filename: gutschriftPdfFilename(bezeichnung, r.gutschrift_nr),
                        })}
                      ><EyeIcon className="h-4 w-4" /></IconAction>
                      <IconAction
                        label="PDF herunterladen"
                        disabled={!r.pdf_url}
                        onClick={() => void triggerOneDriveDownload(
                          r.pdf_url!, gutschriftPdfFilename(bezeichnung, r.gutschrift_nr),
                        )}
                      ><DownloadIcon className="h-4 w-4" /></IconAction>
                      <IconAction
                        label="Per E-Mail versenden"
                        disabled={!r.pdf_url}
                        onClick={() => setEmailFor(r)}
                      ><MailIcon className="h-4 w-4" /></IconAction>
                      <button
                        type="button"
                        className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                        onClick={() => setDeleteFor(r)}
                      >Löschen</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {emailFor && (
        <GutschriftEmailDialog
          gutschrift={{
            id: emailFor.id,
            gutschrift_nr: emailFor.gutschrift_nr,
            datum: emailFor.datum,
            brutto_summe: Number(emailFor.brutto_summe),
            auftraggeber_id: emailFor.auftraggeber_id,
            pdf_url: emailFor.pdf_url,
          }}
          bezeichnung={bezeichnung}
          onClose={() => { setEmailFor(null); void load(); }}
          onSent={() => {
            setEmailFor(null);
            void load();
          }}
        />
      )}

      {markierenOffen && (
        <VersendetMarkierenDialog
          titel={`${selected.size} ${bezeichnung}${selected.size === 1 ? '' : 'en'} als versendet markieren`}
          hinweis="Entwürfe werden übersprungen. Jede Markierung wird mit Benutzer und Zeitpunkt protokolliert."
          onCancel={() => setMarkierenOffen(false)}
          onConfirm={async (weg, datum, notiz) => {
            const r = await alsVersendetMarkieren('gutschrift', [...selected], weg, datum, notiz);
            setMarkierenOffen(false);
            setSelected(new Set());
            await load();
            setToast(`${r.markiert} als versendet markiert${r.uebersprungen.length ? ` (${r.uebersprungen.length} Entwürfe übersprungen)` : ''}`);
            window.setTimeout(() => setToast(null), 4000);
          }}
        />
      )}
      {altbestandOffen && (
        <VersandAltbestandDialog
          typ="gutschrift"
          belege={rows.map((r) => ({ id: r.id, nummer: r.gutschrift_nr, datum: r.datum, status: r.status, email_versendet_am: r.email_versendet_am }))}
          versand={versandMap}
          onClose={() => setAltbestandOffen(false)}
          onDone={(text) => { setAltbestandOffen(false); void load(); setToast(text); window.setTimeout(() => setToast(null), 5000); }}
        />
      )}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-maja-navy px-4 py-2 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}

      {deleteFor && (
        <ConfirmDialog
          title={`${bezeichnung} löschen?`}
          message={
            <>
              <strong>{deleteFor.gutschrift_nr}</strong> unwiderruflich löschen?
              Alle Positionen werden ebenfalls gelöscht.
            </>
          }
          confirmLabel="Löschen"
          destructive
          onConfirm={async () => { await loeschen(deleteFor); }}
          onClose={() => setDeleteFor(null)}
        />
      )}
    </div>
  );
}

function IconAction({
  label, disabled, onClick, children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={disabled ? `${label} — noch keine PDF generiert` : label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md p-1.5 text-maja-navy hover:bg-maja-accent/20 disabled:opacity-30"
    >
      {children}
    </button>
  );
}
