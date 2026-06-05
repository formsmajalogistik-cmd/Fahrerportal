import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { XIcon } from '../../../components/icons';
import { formatDate, formatEuro } from '../../../lib/touren';
import { RechnungStatusBadge } from '../rechnungen/RechnungStatusBadge';
import type { RechnungStatus } from '../../../types/db';

interface OpenRechnung {
  id: string;
  rechnungsnummer: string;
  datum: string;
  brutto_summe: number;
  status: RechnungStatus;
  auftraggeber: { name: string } | null;
}

interface Props {
  onClose: () => void;
  onPick: (rechnung: OpenRechnung) => void;
}

/**
 * Auswahl-Dialog für die Zuordnung der erzeugten Beleg-PDF zu einer
 * Rechnung. Default-Filter "offen" (Aufgabe 2); per Toggle auch
 * Entwurfs- und bezahlte Rechnungen sichtbar — damit der Admin
 * nicht versehentlich nur Stamm-Status sieht.
 */
export function RechnungAssignDialog({ onClose, onPick }: Props) {
  const [rows, setRows] = useState<OpenRechnung[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error: err } = await supabase
        .from('rechnungen')
        .select(`
          id, rechnungsnummer, datum, brutto_summe, status,
          auftraggeber:auftraggeber_id (name)
        `)
        .order('datum', { ascending: false })
        .limit(200);
      if (cancelled) return;
      if (err) setError(err.message);
      else setRows((data as unknown as OpenRechnung[]) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showAll && r.status !== 'offen') return false;
      if (!q) return true;
      const hay = [r.rechnungsnummer, r.auftraggeber?.name ?? ''].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search, showAll]);

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8">
      <div className="card w-full max-w-2xl p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-maja-navy">Rechnung zuordnen</h2>
            <p className="text-xs text-maja-muted">
              Beleg-PDF wird hochgeladen und der gewählten Rechnung zugeordnet.
              Default zeigt offene Rechnungen — Schalter unten für alle.
            </p>
          </div>
          <button type="button" onClick={onClose}
                  className="rounded-md p-1 text-maja-muted hover:bg-maja-light"
                  aria-label="Schließen">
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <input
          className="input"
          placeholder="Suche: Rechnungsnummer oder Auftraggeber …"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <label className="mt-2 flex items-center gap-2 text-xs">
          <input type="checkbox" checked={showAll}
                 onChange={(e) => setShowAll(e.target.checked)}
                 className="h-3.5 w-3.5 rounded border-maja-navy/30 text-maja-navy" />
          Auch Entwürfe und bezahlte Rechnungen anzeigen
        </label>
        {error && (
          <div role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {loading ? (
          <p className="mt-4 text-sm text-maja-muted">Rechnungen werden geladen …</p>
        ) : filtered.length === 0 ? (
          <p className="mt-4 text-sm text-maja-muted">
            {showAll ? 'Keine Rechnungen gefunden.' : 'Keine offenen Rechnungen gefunden.'}
          </p>
        ) : (
          <ul className="mt-3 max-h-[60vh] space-y-1 overflow-auto">
            {filtered.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onPick(r)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-maja-navy/10 bg-white p-3 text-left text-sm hover:bg-maja-light"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-maja-navy">{r.rechnungsnummer}</span>
                      <RechnungStatusBadge status={r.status} />
                    </div>
                    <div className="mt-0.5 text-xs text-maja-muted">
                      {r.auftraggeber?.name ?? '—'} · {formatDate(r.datum)}
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-maja-navy tabular-nums">
                    {formatEuro(Number(r.brutto_summe))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
        </div>
      </div>
    </div>
  );
}
