import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/AuthContext';
import { Spinner } from '../../components/Spinner';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { fahrerName as resolveFahrerName, displayName } from '../../lib/names';
import {
  deleteFuehrerscheinBilder, getFuehrerscheinSignedUrl,
} from '../../lib/fuehrerscheinStorage';
import type { AppUser, FuehrerscheinAbfrage, FuehrerscheinEinreichung } from '../../types/db';

interface FahrerRow {
  id: string;
  vorname: string | null;
  nachname: string | null;
  user: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null;
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('de-DE');
}

export function FuehrerscheinPage() {
  const { profile } = useAuth();
  const [abfragen, setAbfragen] = useState<FuehrerscheinAbfrage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fahrer, setFahrer] = useState<FahrerRow[]>([]);
  const [einreichungen, setEinreichungen] = useState<FuehrerscheinEinreichung[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notiz, setNotiz] = useState('');
  const [starting, setStarting] = useState(false);
  const [viewing, setViewing] = useState<FuehrerscheinEinreichung | null>(null);
  const [pruefBusy, setPruefBusy] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const openAbfrage = useMemo(() => abfragen.find((a) => a.status === 'offen') ?? null, [abfragen]);
  const selected = useMemo(
    () => abfragen.find((a) => a.id === selectedId) ?? null,
    [abfragen, selectedId],
  );

  const loadBase = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [aRes, fRes] = await Promise.all([
      supabase.from('fuehrerschein_abfragen').select('*').order('gestartet_am', { ascending: false }),
      supabase.from('fahrer')
        .select('id, vorname, nachname, user:user_id (email, vorname, nachname)')
        .eq('aktiv', true),
    ]);
    if (aRes.error) setError(aRes.error.message);
    const list = (aRes.data as FuehrerscheinAbfrage[]) ?? [];
    setAbfragen(list);
    setFahrer((fRes.data as unknown as FahrerRow[]) ?? []);
    setSelectedId((cur) => cur ?? list[0]?.id ?? null);
    setLoading(false);
  }, []);

  const loadEinreichungen = useCallback(async (abfrageId: string) => {
    const { data } = await supabase
      .from('fuehrerschein_einreichungen')
      .select('*')
      .eq('abfrage_id', abfrageId);
    setEinreichungen((data as FuehrerscheinEinreichung[]) ?? []);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => { void loadBase(); }, 0);
    return () => window.clearTimeout(t);
  }, [loadBase]);

  useEffect(() => {
    if (!selectedId) {
      const t0 = window.setTimeout(() => setEinreichungen([]), 0);
      return () => window.clearTimeout(t0);
    }
    const t = window.setTimeout(() => { void loadEinreichungen(selectedId); }, 0);
    return () => window.clearTimeout(t);
  }, [selectedId, loadEinreichungen]);

  function showToast(t: string) {
    setToast(t);
    window.setTimeout(() => setToast(null), 4000);
  }

  async function startAbfrage() {
    setStarting(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('fuehrerschein_abfragen')
      .insert({ gestartet_von: profile?.id ?? null, notiz: notiz.trim() || null })
      .select('*')
      .single();
    setStarting(false);
    if (err || !data) { setError(err?.message ?? 'Start fehlgeschlagen'); return; }
    setNotiz('');
    setAbfragen((prev) => [data as FuehrerscheinAbfrage, ...prev]);
    setSelectedId((data as FuehrerscheinAbfrage).id);
    showToast('Neue Abfrage gestartet — Fahrer werden beim nächsten Öffnen benachrichtigt.');
  }

  async function markGeprueft(einr: FuehrerscheinEinreichung) {
    setPruefBusy(einr.id);
    setError(null);
    try {
      // Bilder UNWIDERRUFLICH aus dem Bucket löschen …
      await deleteFuehrerscheinBilder([einr.bild_vorderseite_pfad, einr.bild_rueckseite_pfad]);
      // … und in der DB nur den Prüf-Status behalten (Pfade auf NULL).
      const { error: err } = await supabase
        .from('fuehrerschein_einreichungen')
        .update({
          geprueft: true,
          geprueft_am: new Date().toISOString(),
          geprueft_von: profile?.id ?? null,
          bild_vorderseite_pfad: null,
          bild_rueckseite_pfad: null,
        })
        .eq('id', einr.id);
      if (err) throw new Error(err.message);
      if (selectedId) await loadEinreichungen(selectedId);
      showToast('Geprüft — Bilder gelöscht.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Prüfen fehlgeschlagen');
    } finally {
      setPruefBusy(null);
    }
  }

  async function closeAbfrage() {
    if (!selected) return;
    const { error: err } = await supabase
      .from('fuehrerschein_abfragen')
      .update({ status: 'abgeschlossen' })
      .eq('id', selected.id);
    setConfirmClose(false);
    if (err) { setError(err.message); return; }
    setAbfragen((prev) => prev.map((a) => (a.id === selected.id ? { ...a, status: 'abgeschlossen' } : a)));
    showToast('Abfrage abgeschlossen.');
  }

  const einrByFahrer = useMemo(() => {
    const m = new Map<string, FuehrerscheinEinreichung>();
    for (const e of einreichungen) m.set(e.fahrer_id, e);
    return m;
  }, [einreichungen]);

  const eingereichtCount = einreichungen.length;
  const geprueftCount = einreichungen.filter((e) => e.geprueft).length;
  const alleGeprueft = eingereichtCount > 0 && geprueftCount === eingereichtCount;

  if (loading) return <Spinner label="Führerscheinabfragen werden geladen …" />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-maja-navy">Führerscheinabfrage</h1>
        <p className="text-sm text-maja-muted">
          Fahrer laden Vorder- und Rückseite hoch. Nach dem Abhaken werden die
          Bilder unwiderruflich gelöscht — dokumentiert bleibt nur, wer wann
          geprüft wurde.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {/* a) Neue Abfrage starten */}
      <section className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold text-maja-navy">Neue Abfrage starten</h2>
        {openAbfrage ? (
          <p className="text-sm text-maja-muted">
            Es läuft bereits eine offene Abfrage (gestartet am {fmt(openAbfrage.gestartet_am)}).
            Bitte zuerst abschließen, bevor eine neue gestartet wird.
          </p>
        ) : (
          <>
            <div>
              <label htmlFor="fs-notiz" className="label">Notiz (optional)</label>
              <input id="fs-notiz" className="input" value={notiz}
                     onChange={(e) => setNotiz(e.target.value)}
                     placeholder="z.B. Quartals-Kontrolle Q2/2026" />
            </div>
            <button type="button" className="btn-primary" disabled={starting} onClick={() => void startAbfrage()}>
              {starting ? 'Wird gestartet …' : 'Neue Abfrage starten'}
            </button>
          </>
        )}
      </section>

      {/* b) Einreichungen + Abhaken */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-maja-navy">Einreichungen</h2>
          {abfragen.length > 0 && (
            <select
              className="input w-auto"
              value={selectedId ?? ''}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {abfragen.map((a) => (
                <option key={a.id} value={a.id}>
                  {fmt(a.gestartet_am)} · {a.status === 'offen' ? 'offen' : 'abgeschlossen'}
                  {a.notiz ? ` · ${a.notiz}` : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        {!selected ? (
          <div className="card p-6 text-sm text-maja-muted">Noch keine Abfrage vorhanden.</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 text-sm text-maja-muted">
              <span>{eingereichtCount} von {fahrer.length} Fahrern eingereicht</span>
              <span>·</span>
              <span>{geprueftCount} von {eingereichtCount} geprüft</span>
              {selected.status === 'offen' && (
                <button
                  type="button"
                  className="btn-secondary ml-auto text-sm"
                  disabled={!alleGeprueft}
                  title={alleGeprueft ? 'Abfrage abschließen' : 'Erst möglich, wenn alle Einreichungen geprüft sind'}
                  onClick={() => setConfirmClose(true)}
                >
                  Abfrage abschließen
                </button>
              )}
            </div>

            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-maja-light text-left text-maja-navy">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Fahrer</th>
                    <th className="px-3 py-2 font-semibold">Eingereicht</th>
                    <th className="px-3 py-2 font-semibold">Eingetragener Name</th>
                    <th className="px-3 py-2 font-semibold">Datum</th>
                    <th className="px-3 py-2 font-semibold text-right">Aktion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-maja-navy/10">
                  {fahrer.map((f) => {
                    const e = einrByFahrer.get(f.id) ?? null;
                    const name = resolveFahrerName(f, f.user ?? null) || displayName(f.user ?? null) || '—';
                    return (
                      <tr key={f.id} className="hover:bg-maja-light/50">
                        <td className="px-3 py-2 font-medium text-maja-ink">{name}</td>
                        <td className="px-3 py-2">
                          {e ? (
                            <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                              ja
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
                              nein
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-maja-ink">{e?.name_eingetragen ?? '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-maja-muted">
                          {e ? fmt(e.eingereicht_am) : '—'}
                        </td>
                        <td className="px-3 py-2">
                          {e ? (
                            <div className="flex items-center justify-end gap-3">
                              {e.geprueft ? (
                                <span className="text-xs font-medium text-emerald-700">
                                  geprüft {fmt(e.geprueft_am)}
                                </span>
                              ) : (
                                <>
                                  {(e.bild_vorderseite_pfad || e.bild_rueckseite_pfad) && (
                                    <button
                                      type="button"
                                      className="text-xs font-medium text-maja-accent hover:underline"
                                      onClick={() => setViewing(e)}
                                    >
                                      Ansehen
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="rounded-md bg-maja-navy px-2.5 py-1 text-xs font-medium text-white hover:bg-maja-accent disabled:opacity-50"
                                    disabled={pruefBusy === e.id}
                                    onClick={() => void markGeprueft(e)}
                                  >
                                    {pruefBusy === e.id ? 'Prüft …' : 'Geprüft'}
                                  </button>
                                </>
                              )}
                            </div>
                          ) : (
                            <span className="block text-right text-xs text-maja-muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {viewing && (
        <BilderModal einreichung={viewing} onClose={() => setViewing(null)} />
      )}

      {confirmClose && (
        <ConfirmDialog
          title="Abfrage abschließen?"
          message="Die Abfrage wird als abgeschlossen markiert. Fahrer werden dann nicht mehr zur Einreichung aufgefordert."
          confirmLabel="Abschließen"
          onConfirm={closeAbfrage}
          onClose={() => setConfirmClose(false)}
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

/** Zeigt Vorder-/Rückseite über kurzlebige signierte URLs (5 Min). */
function BilderModal({
  einreichung, onClose,
}: { einreichung: FuehrerscheinEinreichung; onClose: () => void }) {
  const [urls, setUrls] = useState<{ v: string | null; r: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [v, r] = await Promise.all([
        einreichung.bild_vorderseite_pfad
          ? getFuehrerscheinSignedUrl(einreichung.bild_vorderseite_pfad) : Promise.resolve(null),
        einreichung.bild_rueckseite_pfad
          ? getFuehrerscheinSignedUrl(einreichung.bild_rueckseite_pfad) : Promise.resolve(null),
      ]);
      if (!cancelled) setUrls({ v, r });
    })();
    return () => { cancelled = true; };
  }, [einreichung]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-maja-ink/50 px-4 py-8">
      <div className="card w-full max-w-3xl p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-maja-navy">
            Führerschein — {einreichung.name_eingetragen ?? ''}
          </h2>
          <button type="button" className="btn-secondary text-sm" onClick={onClose}>Schließen</button>
        </div>
        {!urls ? (
          <Spinner label="Bilder werden geladen …" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <BildBox label="Vorderseite" url={urls.v} />
            <BildBox label="Rückseite" url={urls.r} />
          </div>
        )}
        <p className="mt-3 text-xs text-maja-muted">
          Die Links sind aus Datenschutzgründen nur wenige Minuten gültig.
        </p>
      </div>
    </div>
  );
}

function BildBox({ label, url }: { label: string; url: string | null }) {
  return (
    <div className="rounded-lg border border-slate-300 p-2 dark:border-slate-600">
      <div className="mb-1 text-xs font-medium text-maja-ink">{label}</div>
      <div className="flex aspect-[3/2] items-center justify-center overflow-hidden rounded-md bg-maja-light dark:bg-surface-700">
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer">
            <img src={url} alt={label} className="max-h-full w-full object-contain" />
          </a>
        ) : (
          <span className="text-xs text-maja-muted">kein Bild</span>
        )}
      </div>
    </div>
  );
}
