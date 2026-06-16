import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { getAllFormDrafts, getAllPendingSubmissions } from '../../lib/offlineDb';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Spinner } from '../../components/Spinner';
import type { Json } from '../../types/supabase';

/**
 * Recovery-Hilfsseite (Admin-only, /recovery).
 *
 * WICHTIG: IndexedDB ist GERÄTE-LOKAL. Diese Seite zeigt nur Entwürfe,
 * die auf GENAU DIESEM Gerät / in DIESEM Browser-Profil gespeichert
 * wurden. Um einen verlorenen Stand zu retten, muss die Seite auf dem
 * Gerät geöffnet werden, auf dem das Formular ausgefüllt wurde. Da
 * Abmelden die lokalen Entwürfe NICHT löscht, kann sich ein Admin auf
 * dem Fahrer-Gerät anmelden und hier nachsehen.
 *
 * Quellen:
 *  - form-drafts          (laufende/zwischengespeicherte Entwürfe)
 *  - pending-submissions  (abgeschickt, aber noch nicht synchronisiert)
 *
 * Aktionen: Inhalt ansehen + lokalen Stand zurück in die Datenbank
 * (ausgefuellte_formulare.daten) schreiben.
 */

interface LocalEntry {
  source: 'draft' | 'pending';
  /** ausgefuellte_formulare.id */
  formularId: string;
  data: Record<string, unknown>;
  /** ms epoch */
  savedAt: number;
  kennzeichen: string | null;
  filledCount: number;
}

interface ServerRow {
  id: string;
  status: string;
  daten: Record<string, unknown> | null;
  created_at: string;
  fahrer_id: string;
  template_id: string;
  fahrer_name: string | null;
}

function hasContent(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return true;
}

function countFilled(data: Record<string, unknown>): number {
  let n = 0;
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith('_')) continue; // reservierte Keys (_tour_id, _slider_*)
    if (hasContent(v)) n += 1;
  }
  return n;
}

function extractKennzeichen(data: Record<string, unknown>): string | null {
  const direct = data['kennzeichen'] ?? data['Kennzeichen'];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  // Fallback: erste String-Value, die wie ein deutsches Kennzeichen aussieht.
  for (const v of Object.values(data)) {
    if (typeof v === 'string' && /[A-ZÄÖÜ]{1,3}[-\s]?[A-Z]{1,2}\s?\d{1,4}/i.test(v)) {
      return v.trim();
    }
  }
  return null;
}

function fmtTs(ms: number): string {
  if (!ms) return '—';
  try { return new Date(ms).toLocaleString('de-DE'); } catch { return String(ms); }
}

export function RecoveryPage() {
  const [entries, setEntries] = useState<LocalEntry[]>([]);
  const [serverById, setServerById] = useState<Map<string, ServerRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<LocalEntry | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<LocalEntry | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [drafts, pendings] = await Promise.all([
        getAllFormDrafts().catch(() => []),
        getAllPendingSubmissions().catch(() => []),
      ]);
      const list: LocalEntry[] = [];
      for (const d of drafts) {
        const data = (d.data ?? {}) as Record<string, unknown>;
        list.push({
          source: 'draft',
          formularId: d.id,
          data,
          savedAt: d.savedAt ?? 0,
          kennzeichen: extractKennzeichen(data),
          filledCount: countFilled(data),
        });
      }
      for (const p of pendings) {
        const data = (p.data ?? {}) as Record<string, unknown>;
        list.push({
          source: 'pending',
          formularId: p.formularId,
          data,
          savedAt: p.queuedAt ?? 0,
          kennzeichen: extractKennzeichen(data),
          filledCount: countFilled(data),
        });
      }
      list.sort((a, b) => b.savedAt - a.savedAt);
      setEntries(list);

      // Server-Stand der referenzierten Formulare dazuladen (zum Vergleich).
      const ids = Array.from(new Set(list.map((e) => e.formularId)));
      if (ids.length > 0) {
        const { data: rows, error: err } = await supabase
          .from('ausgefuellte_formulare')
          .select('id, status, daten, created_at, fahrer_id, template_id, fahrer:fahrer_id (vorname, nachname, user:user_id (email, vorname, nachname))')
          .in('id', ids);
        if (err) {
          console.warn('[Recovery] Server-Abgleich fehlgeschlagen', err.message);
        }
        const m = new Map<string, ServerRow>();
        for (const r of (rows ?? []) as unknown as Array<Record<string, unknown>>) {
          const fahrer = r.fahrer as
            | { vorname?: string | null; nachname?: string | null; user?: { email?: string | null; vorname?: string | null; nachname?: string | null } | null }
            | null;
          const name = [fahrer?.vorname ?? fahrer?.user?.vorname, fahrer?.nachname ?? fahrer?.user?.nachname]
            .filter(Boolean).join(' ').trim() || (fahrer?.user?.email ?? null);
          m.set(r.id as string, {
            id: r.id as string,
            status: r.status as string,
            daten: (r.daten as Record<string, unknown> | null) ?? null,
            created_at: r.created_at as string,
            fahrer_id: r.fahrer_id as string,
            template_id: r.template_id as string,
            fahrer_name: name,
          });
        }
        setServerById(m);
      } else {
        setServerById(new Map());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function handleRestore(entry: LocalEntry) {
    const { error: err } = await supabase
      .from('ausgefuellte_formulare')
      .update({ daten: entry.data as unknown as Json })
      .eq('id', entry.formularId);
    if (err) throw new Error(err.message);
    setRestoreTarget(null);
    setToast(`Lokaler Stand in Formular ${entry.formularId.slice(0, 8)} zurückgeschrieben.`);
    window.setTimeout(() => setToast(null), 5000);
    void load();
  }

  if (loading) return <Spinner label="Lokale Entwürfe werden gelesen …" />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-maja-navy">Daten-Recovery</h1>
        <p className="text-sm text-maja-muted">
          Lokal auf <strong>diesem Gerät</strong> gespeicherte Formular-Entwürfe.
          Diese Seite muss auf dem Gerät geöffnet werden, auf dem das Formular
          ausgefüllt wurde. Abmelden löscht die lokalen Entwürfe nicht.
        </p>
      </div>

      <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        Hinweis: „Zurück in die Datenbank speichern" überschreibt den aktuellen
        Server-Stand des jeweiligen Formulars mit dem lokalen Stand. Vorher den
        Inhalt prüfen.
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-sm text-maja-muted">
          {entries.length} lokale{entries.length === 1 ? 'r Eintrag' : ' Einträge'}
        </span>
        <button type="button" className="btn-secondary text-sm" onClick={() => void load()}>
          Neu laden
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="card p-6 text-center text-sm text-maja-muted">
          Keine lokalen Entwürfe auf diesem Gerät gefunden.
        </div>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => {
            const server = serverById.get(e.formularId);
            const serverFilled = server?.daten ? countFilled(server.daten) : 0;
            const localBeatsServer = e.filledCount > serverFilled;
            return (
              <li key={`${e.source}-${e.formularId}`} className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-block rounded-full bg-maja-light px-2 py-0.5 text-xs font-semibold text-maja-navy">
                        {e.source === 'draft' ? 'Entwurf' : 'Nicht gesendet'}
                      </span>
                      {e.kennzeichen && (
                        <span className="text-sm font-semibold text-maja-navy">{e.kennzeichen}</span>
                      )}
                      {localBeatsServer && (
                        <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                          Lokal vollständiger
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-maja-muted">
                      Lokal gespeichert: {fmtTs(e.savedAt)} · {e.filledCount} gefüllte Felder
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-maja-muted break-all">
                      {e.formularId}
                    </div>
                    <div className="mt-1 text-xs">
                      {server ? (
                        <span className="text-maja-muted">
                          Server: Status <strong>{server.status}</strong> ·{' '}
                          {serverFilled} gefüllte Felder
                          {server.fahrer_name && <> · Fahrer: {server.fahrer_name}</>}
                        </span>
                      ) : (
                        <span className="text-amber-700">Nicht (mehr) in der Datenbank</span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    <button type="button" className="btn-secondary text-sm"
                            onClick={() => setSelected(e)}>
                      Inhalt ansehen
                    </button>
                    <button
                      type="button"
                      className="btn-primary text-sm"
                      disabled={!server}
                      title={server ? 'Lokalen Stand in die DB schreiben' : 'Zielzeile fehlt in der DB'}
                      onClick={() => setRestoreTarget(e)}
                    >
                      In DB speichern
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {selected && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-maja-ink/40 px-4 py-8">
          <div className="card flex max-h-[85vh] w-full max-w-3xl flex-col p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-maja-navy">
                Inhalt {selected.kennzeichen ? `· ${selected.kennzeichen}` : ''}
              </h2>
              <button type="button" className="btn-secondary text-sm" onClick={() => setSelected(null)}>
                Schließen
              </button>
            </div>
            <pre className="flex-1 overflow-auto rounded-lg bg-maja-light p-3 text-xs text-maja-ink dark:bg-surface-700 dark:text-slate-100">
              {JSON.stringify(selected.data, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {restoreTarget && (
        <ConfirmDialog
          title="Lokalen Stand in die Datenbank schreiben?"
          message={
            <>
              Der aktuelle Server-Stand von Formular{' '}
              <strong>{restoreTarget.formularId.slice(0, 8)}</strong>
              {restoreTarget.kennzeichen && <> ({restoreTarget.kennzeichen})</>}{' '}
              wird mit dem lokalen Stand ({restoreTarget.filledCount} gefüllte Felder,
              gespeichert {fmtTs(restoreTarget.savedAt)}) überschrieben. Diese Aktion
              kann nicht rückgängig gemacht werden.
            </>
          }
          confirmLabel="Überschreiben"
          destructive
          onConfirm={() => handleRestore(restoreTarget)}
          onClose={() => setRestoreTarget(null)}
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
