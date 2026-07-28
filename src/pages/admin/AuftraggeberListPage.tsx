import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Spinner } from '../../components/Spinner';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { AuftraggeberEditDialog } from './AuftraggeberEditDialog';
import type { Auftraggeber } from '../../types/db';
import { kundennummerZahl, naechsteKundennummer } from '../../lib/kundennummer';



export function AuftraggeberListPage() {
  const [rows, setRows] = useState<Auftraggeber[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Auftraggeber | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Auftraggeber | null>(null);

  /** Nächste freie Kundennummer im vorhandenen Format (führende Nullen
   *  werden beibehalten, wenn der Bestand sie nutzt). */
  const naechsteNummer = useMemo(() => naechsteKundennummer(rows), [rows]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from('auftraggeber').select('*').order('name');
    if (err) setError(err.message);
    else {
      // Standard-Sortierung nach Kundennummer (numerisch, damit "9" vor
      // "10" steht); Einträge ohne Nummer ans Ende, dort nach Name.
      const list = [...(data ?? [])].sort((a, b) => {
        const na = kundennummerZahl(a.kundennummer);
        const nb = kundennummerZahl(b.kundennummer);
        if (na != null && nb != null && na !== nb) return na - nb;
        if (na != null && nb == null) return -1;
        if (na == null && nb != null) return 1;
        return (a.name ?? '').localeCompare(b.name ?? '', 'de', { sensitivity: 'base' });
      });
      setRows(list);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleDelete(ag: Auftraggeber) {
    const { error: err } = await supabase
      .from('auftraggeber').delete().eq('id', ag.id);
    if (err) throw err;
    setDeleting(null);
    void load();
  }

  if (loading) return <Spinner label="Auftraggeber werden geladen …" />;
  if (error) {
    return <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-maja-navy">Auftraggeber</h1>
          <p className="text-sm text-maja-muted">Kunden verwalten.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-maja-muted">
            Nächste freie Kundennummer: <strong className="text-maja-navy">{naechsteNummer}</strong>
          </span>
          <button className="btn-primary" onClick={() => setEditing('new')}>
            Neuen Auftraggeber anlegen
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-maja-light text-left text-maja-navy">
            <tr>
              <th className="px-4 py-3 font-semibold">Kd.-Nr.</th>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Adresse</th>
              <th className="px-4 py-3 font-semibold">Kontakt</th>
              <th className="px-4 py-3 font-semibold">E-Mails</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-maja-navy/10">
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-maja-muted">
                Noch keine Auftraggeber angelegt.
              </td></tr>
            ) : rows.map((a) => (
              <tr key={a.id} className="hover:bg-maja-light/50 align-top">
                <td className="px-4 py-3 font-semibold tabular-nums text-maja-navy">
                  {a.kundennummer || <span className="font-normal text-maja-muted">—</span>}
                </td>
                <td className="px-4 py-3 font-medium text-maja-ink">{a.name}</td>
                <td className="px-4 py-3 text-maja-muted">
                  {a.strasse || a.plz || a.ort ? (
                    <>
                      {a.strasse && <div>{a.strasse}</div>}
                      {(a.plz || a.ort) && (
                        <div>{[a.plz, a.ort].filter(Boolean).join(' ')}</div>
                      )}
                    </>
                  ) : '—'}
                </td>
                <td className="px-4 py-3 text-maja-muted">{a.kontakt ?? '—'}</td>
                <td className="px-4 py-3 text-maja-muted">
                  {a.email1 && <div>{a.email1}</div>}
                  {a.email2 && <div>{a.email2}</div>}
                  {!a.email1 && !a.email2 && '—'}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button
                    className="text-sm font-medium text-maja-accent hover:underline"
                    onClick={() => setEditing(a)}
                  >Bearbeiten</button>
                  <button
                    className="ml-3 text-sm font-medium text-red-600 hover:underline"
                    onClick={() => setDeleting(a)}
                  >Löschen</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <AuftraggeberEditDialog
          initial={editing === 'new' ? null : editing}
          kundennummerVorschlag={naechsteNummer}
          vergebeneNummern={rows.map((r) => r.kundennummer).filter((x): x is string => !!x)}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Auftraggeber löschen?"
          message={
            <>
              Soll „<strong>{deleting.name}</strong>" wirklich gelöscht werden?
              Zugeordnete Templates verlieren die Verknüpfung, vorhandene
              Protokolle bleiben erhalten.
            </>
          }
          confirmLabel="Löschen"
          destructive
          onConfirm={() => handleDelete(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
