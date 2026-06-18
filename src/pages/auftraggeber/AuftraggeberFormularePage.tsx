import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/AuthContext';
import { useTestMode, useTestGuard } from '../../auth/TestModeContext';
import { Spinner } from '../../components/Spinner';
import { uploadToOneDrive } from '../../lib/onedrive';
import { sanitizeFilename } from '../../lib/pdfGenerate';
import { formatDate, tourTitel } from '../../lib/touren';
import type { FormularWunsch, TourKundensicht } from '../../types/db';

/**
 * Formulare-Reiter für Auftraggeber-Profile:
 *  1. Freigegebene Templates (RLS liefert NUR Templates mit Freigabe
 *     für den eigenen Auftraggeber) — können eigenen Touren zugewiesen
 *     werden. Keine App/Schriftlich-Auswahl: die Zuweisung läuft immer
 *     über die SECURITY-DEFINER-RPC `auftraggeber_formular_zuweisen`.
 *  2. Formular-Wunsch: PDF-Vorlage + Notiz einreichen.
 *
 * Eingereichte Protokolle werden hier bewusst NICHT gelistet — sie
 * sind direkt an der jeweiligen Tour in der Tourenliste einsehbar und
 * herunterladbar.
 */

interface TemplateLite { id: string; name: string }

export function AuftraggeberFormularePage() {
  const { profile, session } = useAuth();
  const { isTestUser, effectiveAuftraggeberId } = useTestMode();
  // Effektive Auftraggeber-ID: bei Test-Usern aus dem Banner, sonst
  // aus dem eigenen Profil.
  const scopeAuftraggeberId = isTestUser
    ? effectiveAuftraggeberId
    : (profile?.auftraggeber_id ?? null);
  const [templates, setTemplates] = useState<TemplateLite[]>([]);
  const [wuensche, setWuensche] = useState<FormularWunsch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignTemplate, setAssignTemplate] = useState<TemplateLite | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    // Templates: für echte Auftraggeber filtert RLS auf Freigaben; im
    // Test-Modus wird zusätzlich nach dem gewählten Auftraggeber
    // gefiltert (sonst sähe der Test-User alle Templates).
    let tplQuery = supabase.from('formular_templates').select('id, name').order('name');
    if (isTestUser && scopeAuftraggeberId) {
      const { data: freigaben } = await supabase
        .from('template_auftraggeber_freigaben')
        .select('template_id')
        .eq('auftraggeber_id', scopeAuftraggeberId);
      const ids = (freigaben ?? []).map((r) => r.template_id);
      tplQuery = supabase.from('formular_templates')
        .select('id, name')
        .in('id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000'])
        .order('name');
    }

    // Formular-Wünsche: RLS filtert für echte AG; Test-User explizit.
    let wQuery = supabase.from('formular_wuensche').select('*').order('created_at', { ascending: false });
    if (isTestUser && scopeAuftraggeberId) {
      wQuery = supabase.from('formular_wuensche').select('*')
        .eq('auftraggeber_id', scopeAuftraggeberId)
        .order('created_at', { ascending: false });
    }

    const [tplRes, wRes] = await Promise.all([tplQuery, wQuery]);
    if (tplRes.error) setError(tplRes.error.message);
    setTemplates((tplRes.data as TemplateLite[]) ?? []);
    setWuensche((wRes.data as FormularWunsch[]) ?? []);
    setLoading(false);
  }, [isTestUser, scopeAuftraggeberId]);

  useEffect(() => {
    // Deferred, damit setLoading nicht synchron im Effect läuft
    // (react-hooks/set-state-in-effect).
    const t = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(t);
  }, [load]);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4500);
  }

  if (loading) return <Spinner label="Formulare werden geladen …" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-maja-navy">Formulare</h1>
        <p className="text-sm text-maja-muted">
          Freigegebene Formulare Ihren Touren zuweisen. Eingereichte
          Protokolle finden Sie direkt bei der jeweiligen Tour.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 1. Freigegebene Templates */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-maja-muted">
          Verfügbare Formulare
        </h2>
        {templates.length === 0 ? (
          <div className="card p-5 text-sm text-maja-muted">
            Für Ihr Konto sind noch keine Formulare freigegeben.
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {templates.map((t) => (
              <li key={t.id} className="card flex flex-col p-4">
                <h3 className="text-sm font-semibold text-maja-navy">{t.name}</h3>
                <button
                  type="button"
                  className="btn-secondary mt-3 text-sm"
                  onClick={() => setAssignTemplate(t)}
                >
                  Formular hinzufügen
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 2. Formular-Wunsch einreichen */}
      <WunschSection
        wuensche={wuensche}
        auftraggeberId={scopeAuftraggeberId}
        userId={session?.user.id ?? null}
        onSubmitted={() => { showToast('Formular-Vorlage eingereicht.'); void load(); }}
      />

      {assignTemplate && (
        <AssignToTourDialog
          template={assignTemplate}
          onClose={() => setAssignTemplate(null)}
          onAssigned={(tourLabel) => {
            setAssignTemplate(null);
            showToast(`„${assignTemplate.name}" der Tour ${tourLabel} zugewiesen.`);
          }}
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

// ---- Formular einer Tour zuweisen ----------------------------------

function AssignToTourDialog({
  template, onClose, onAssigned,
}: {
  template: { id: string; name: string };
  onClose: () => void;
  onAssigned: (tourLabel: string) => void;
}) {
  const { isTestUser, effectiveAuftraggeberId } = useTestMode();
  const [touren, setTouren] = useState<TourKundensicht[]>([]);
  const [loading, setLoading] = useState(true);
  const [tourId, setTourId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (isTestUser && effectiveAuftraggeberId) {
        const { data } = await supabase.from('touren')
          .select('id, tour_id, start_stadt, ziel_stadt, rueckfuehrung_stadt, startdatum, bestaetigt')
          .eq('auftraggeber_id', effectiveAuftraggeberId)
          .order('startdatum', { ascending: false })
          .limit(200);
        if (cancelled) return;
        setTouren((data as unknown as TourKundensicht[]) ?? []);
      } else {
        const { data } = await supabase
          .from('touren_kundensicht').select('*')
          .order('startdatum', { ascending: false }).limit(200);
        if (cancelled) return;
        setTouren((data as unknown as TourKundensicht[]) ?? []);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isTestUser, effectiveAuftraggeberId]);

  const guard = useTestGuard();
  async function handleAssign() {
    if (!tourId) { setError('Bitte eine Tour auswählen.'); return; }
    if (guard()) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc('auftraggeber_formular_zuweisen', {
      p_tour_id: tourId,
      p_template_id: template.id,
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    const t = touren.find((x) => x.id === tourId);
    onAssigned(t?.tour_id ?? tourTitel(t ?? null) ?? '');
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-maja-ink/40 px-4">
      <div className="card w-full max-w-md p-6">
        <h2 className="mb-1 text-lg font-semibold text-maja-navy">
          „{template.name}" einer Tour zuweisen
        </h2>
        <p className="mb-4 text-xs text-maja-muted">
          Das Formular wird der gewählten Tour als Protokoll zugewiesen.
        </p>
        {loading ? (
          <Spinner label="Touren werden geladen …" />
        ) : touren.length === 0 ? (
          <p className="text-sm text-maja-muted">Keine Touren vorhanden.</p>
        ) : (
          <div>
            <label htmlFor="assign-tour" className="label">Tour</label>
            <select
              id="assign-tour"
              className="input"
              value={tourId}
              onChange={(e) => setTourId(e.target.value)}
            >
              <option value="">— Tour wählen —</option>
              {touren.map((t) => (
                <option key={t.id} value={t.id}>
                  {(t.tour_id ? `${t.tour_id} · ` : '') + tourTitel(t)}
                  {` · ${formatDate(t.startdatum)}`}
                  {!t.bestaetigt ? ' (In Prüfung)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        {error && (
          <div role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="button" className="btn-primary" onClick={() => void handleAssign()}
                  disabled={busy || !tourId}>
            {busy ? 'Weist zu …' : 'Zuweisen'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Formular-Wunsch (PDF-Vorlage einreichen) -----------------------

function WunschSection({
  wuensche, auftraggeberId, userId, onSubmitted,
}: {
  wuensche: FormularWunsch[];
  auftraggeberId: string | null;
  userId: string | null;
  onSubmitted: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [notiz, setNotiz] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guard = useTestGuard();
  async function handleSubmit() {
    setError(null);
    if (!file) { setError('Bitte eine PDF-Datei auswählen.'); return; }
    if (!auftraggeberId || !userId) {
      setError('Ihrem Konto ist kein Auftraggeber zugeordnet.');
      return;
    }
    if (guard()) return;
    setBusy(true);
    try {
      const cleanName = sanitizeFilename(file.name.replace(/\.pdf$/i, '')) || 'vorlage';
      const path = `Maja-Logistik/Formular-Wuensche/${Date.now()}_${cleanName}.pdf`;
      await uploadToOneDrive(path, file);
      const { error: err } = await supabase.from('formular_wuensche').insert({
        auftraggeber_id: auftraggeberId,
        eingereicht_von: userId,
        pdf_url: path,
        notiz: notiz.trim() || null,
      });
      if (err) throw new Error(err.message);
      setFile(null);
      setNotiz('');
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Einreichen fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-maja-muted">
        Formular-Vorlage einreichen
      </h2>
      <div className="card space-y-3 p-4">
        <p className="text-xs text-maja-muted">
          Sie benötigen ein eigenes Formular? Laden Sie Ihre PDF-Vorlage
          hoch — das Maja-Logistik-Team baut daraus ein ausfüllbares
          Formular.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="btn-secondary cursor-pointer text-sm">
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (f && f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) {
                  setError('Nur PDF-Dateien werden akzeptiert.');
                  return;
                }
                setError(null);
                setFile(f);
              }}
            />
            {file ? 'Andere PDF wählen' : 'PDF auswählen'}
          </label>
          {file && <span className="text-sm text-maja-ink">{file.name}</span>}
        </div>
        <div>
          <label htmlFor="wunsch-notiz" className="label">Worum geht es? (optional)</label>
          <textarea
            id="wunsch-notiz"
            className="input min-h-[60px]"
            value={notiz}
            onChange={(e) => setNotiz(e.target.value)}
          />
        </div>
        {error && (
          <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <div>
          <button type="button" className="btn-primary" disabled={busy || !file}
                  onClick={() => void handleSubmit()}>
            {busy ? 'Lädt hoch …' : 'Vorlage einreichen'}
          </button>
        </div>
      </div>

      {wuensche.length > 0 && (
        <ul className="space-y-2">
          {wuensche.map((w) => (
            <li key={w.id} className="card flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div className="min-w-0">
                <span className="font-medium text-maja-navy">
                  {w.pdf_url.split('/').pop()}
                </span>
                {w.notiz && <span className="ml-2 text-maja-muted">{w.notiz}</span>}
                <span className="ml-2 text-xs text-maja-muted">{formatDate(w.created_at)}</span>
              </div>
              <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                w.status === 'offen'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-emerald-100 text-emerald-700'
              }`}>
                {w.status === 'offen' ? 'Offen' : 'Erledigt'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
