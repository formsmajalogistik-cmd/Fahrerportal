// Übersicht der Gutschriften / Rechnungskorrekturen.
//
// Bewusst schlanker als die Rechnungsliste: KEINE KPI-Karten, KEIN
// „bezahlt"-Status und keine Zahlungsverfolgung. Filter auf Jahr,
// Auftraggeber und Nummer; neueste zuerst.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
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
import type { Auftraggeber, AuftraggeberKontakt } from '../../../types/db';

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

  const [yearFilter, setYearFilter] = useState<number | 'alle'>(new Date().getFullYear());
  const [agFilter, setAgFilter] = useState('');
  const [search, setSearch] = useState('');

  const [emailFor, setEmailFor] = useState<Row | null>(null);
  const [deleteFor, setDeleteFor] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [gRes, aRes, sRes] = await Promise.all([
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
    ]);
    if (gRes.error) { setError(gRes.error.message); setLoading(false); return; }
    if (aRes.error) { setError(aRes.error.message); setLoading(false); return; }
    setRows((gRes.data as unknown as Row[]) ?? []);
    setAuftraggeber(aRes.data ?? []);
    setSettings(sRes);
    setLoading(false);
  }, []);

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
      if (agFilter && r.auftraggeber_id !== agFilter) return false;
      if (!q) return true;
      return r.gutschrift_nr.toLowerCase().includes(q)
        || (r.auftraggeber?.name ?? '').toLowerCase().includes(q)
        || (r.rechnung?.rechnungsnummer ?? '').toLowerCase().includes(q);
    });
  }, [rows, yearFilter, agFilter, search]);

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

      {/* Jahres-Pills */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-maja-muted">Jahr</span>
        <button
          type="button"
          onClick={() => setYearFilter('alle')}
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            yearFilter === 'alle' ? 'bg-maja-navy text-white' : 'bg-white text-maja-navy hover:bg-maja-light'
          }`}
        >Alle</button>
        {yearOptions.map((y) => (
          <button
            key={y}
            type="button"
            onClick={() => setYearFilter(y)}
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
                  onChange={(e) => setAgFilter(e.target.value)}>
            <option value="">Alle</option>
            {auftraggeber.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="gs-search" className="label">Suche</label>
          <input id="gs-search" className="input"
                 placeholder="Nummer, Auftraggeber, Rechnung …"
                 value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
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
                <th className="px-3 py-2 font-semibold">Nummer</th>
                <th className="px-3 py-2 font-semibold">Datum</th>
                <th className="px-3 py-2 font-semibold">Auftraggeber</th>
                <th className="px-3 py-2 font-semibold">Bezug</th>
                <th className="px-3 py-2 text-right font-semibold">Brutto</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 text-right font-semibold">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-maja-navy/10">
              {gefiltert.map((r) => (
                <tr key={r.id} className="hover:bg-maja-light/40">
                  <td className="px-3 py-2">
                    <button type="button"
                            className="font-medium text-maja-navy hover:underline"
                            onClick={() => navigate(`/gutschriften/${r.id}`)}>
                      {r.gutschrift_nr}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-maja-ink">{formatDate(r.datum)}</td>
                  <td className="px-3 py-2 text-maja-ink">
                    {r.auftraggeber?.name ?? '—'}
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
                    {r.email_versendet_am && (
                      <span className="block text-[11px] text-maja-muted">
                        versendet {formatDate(r.email_versendet_am)}
                      </span>
                    )}
                  </td>
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
          onClose={() => setEmailFor(null)}
          onSent={() => {
            const id = emailFor.id;
            setRows((cur) => cur.map((r) => (
              r.id === id ? { ...r, email_versendet_am: new Date().toISOString() } : r
            )));
            setEmailFor(null);
          }}
        />
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
