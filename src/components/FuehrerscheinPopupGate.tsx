import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useFahrerContext } from '../auth/FahrerContext';
import { useTestMode, useTestGuard } from '../auth/TestModeContext';
import { fahrerName } from '../lib/names';
import { uploadFuehrerscheinBild } from '../lib/fuehrerscheinStorage';
import { LiveCameraField, type CapturedImage } from './LiveCameraField';
import type { FuehrerscheinAbfrage } from '../types/db';

const DATENSCHUTZ_HINWEIS =
  'Datenschutzhinweis: Die hochgeladenen Bilder dienen ausschließlich der '
  + 'Überprüfung der Gültigkeit deiner Fahrerlaubnis. Sie werden vertraulich '
  + 'behandelt und unmittelbar nach der Prüfung durch einen Administrator '
  + 'unwiderruflich gelöscht. Eine Speicherung über die Prüfung hinaus findet '
  + 'nicht statt.';

/**
 * Zeigt das Führerschein-Popup. Rollen-Eingrenzung (Aufgabe 1):
 *
 *  - Fahrer (inkl. Unterkonten): echtes Popup, wenn eine offene Abfrage
 *    existiert, zu der das aktive Konto noch NICHT eingereicht hat.
 *  - Auftraggeber: NIEMALS (Komponente ist ohnehin nur in der AppShell
 *    montiert, die Auftraggeber nicht nutzen — hier zusätzlich hart
 *    ausgeschlossen).
 *  - Admin: kein Fahrer-Popup (AdminShell montiert die Komponente nicht).
 *  - Test-Account in Fahrer-Ansicht (effectiveRole='fahrer'): Demo-Popup
 *    IMMER — unabhängig von einer echten Abfrage. Die Einreichung wird
 *    durch den Test-Guard abgefangen (kein Upload, kein DB-Eintrag,
 *    keine echten Bilder im Bucket).
 *
 * Mount-Ort: AppShell → erscheint erst NACH der Konto-Auswahl.
 */
export function FuehrerscheinPopupGate() {
  const { profile } = useAuth();
  const { activeFahrer } = useFahrerContext();
  const { isTestUser, effectiveRole } = useTestMode();

  const role = profile?.role;
  // Test-Account, der gerade die Fahrer-Ansicht simuliert.
  const isTestFahrer = isTestUser && effectiveRole === 'fahrer';
  // Auftraggeber sind hart ausgeschlossen; nur echter Fahrer oder Test-Fahrer.
  const eligible = role === 'fahrer' || isTestFahrer;

  const fahrerId = activeFahrer?.id ?? null;
  // Dauerhaft von Führerscheinabfragen ausgenommene Konten erhalten kein
  // Popup (z.B. Disponent ohne Fahrtätigkeit). Test-Demo bleibt unberührt.
  const ausgenommen = activeFahrer?.fs_ausgenommen ?? false;
  const [abfrage, setAbfrage] = useState<FuehrerscheinAbfrage | null>(null);
  const [needsSubmit, setNeedsSubmit] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => { void run(); }, 0);
    async function run() {
      if (cancelled) return;
      setDismissed(false);
      setDone(false);
      // Test-Fahrer: Demo immer zeigen, KEINE DB-Abfrage.
      if (isTestFahrer) {
        setAbfrage(null);
        setNeedsSubmit(true);
        return;
      }
      setNeedsSubmit(false);
      setAbfrage(null);
      // Echte Logik nur für die Rolle 'fahrer' mit aktivem Konto.
      if (role !== 'fahrer' || !fahrerId) return;
      // Ausgenommene Konten nie zur Einreichung auffordern.
      if (ausgenommen) return;
      try {
        const { data: open } = await supabase
          .from('fuehrerschein_abfragen')
          .select('*')
          .eq('status', 'offen')
          .order('gestartet_am', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cancelled || !open) return;
        const { data: einr } = await supabase
          .from('fuehrerschein_einreichungen')
          .select('id')
          .eq('abfrage_id', open.id)
          .eq('fahrer_id', fahrerId)
          .maybeSingle();
        if (cancelled) return;
        setAbfrage(open as FuehrerscheinAbfrage);
        setNeedsSubmit(!einr);
      } catch (err) {
        console.warn('[Fuehrerschein] Abfrage-Check fehlgeschlagen', err);
      }
    }
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [fahrerId, isTestFahrer, role, ausgenommen]);

  if (!eligible || !needsSubmit || dismissed) return null;

  if (done) {
    return (
      <Overlay>
        <div className="text-center">
          <h2 className="text-lg font-semibold text-maja-navy">Führerschein übermittelt — danke</h2>
          <p className="mt-2 text-sm text-maja-muted">
            Deine Bilder werden nach der Prüfung durch einen Administrator
            unwiderruflich gelöscht.
          </p>
          <button type="button" className="btn-primary mt-5" onClick={() => setDone(false)}>
            Schließen
          </button>
        </div>
      </Overlay>
    );
  }

  return (
    <Overlay>
      <FuehrerscheinForm
        abfrageId={abfrage?.id ?? 'test-demo'}
        fahrerId={fahrerId ?? 'test-demo'}
        testMode={isTestFahrer}
        defaultName={fahrerName(activeFahrer, profile) || ''}
        onDone={() => { setDone(true); setNeedsSubmit(false); }}
        onLater={() => setDismissed(true)}
      />
    </Overlay>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-maja-ink/50 px-4 py-8">
      <div className="card w-full max-w-lg p-6">{children}</div>
    </div>
  );
}

function FuehrerscheinForm({
  abfrageId, fahrerId, testMode, defaultName, onDone, onLater,
}: {
  abfrageId: string;
  fahrerId: string;
  testMode: boolean;
  defaultName: string;
  onDone: () => void;
  onLater: () => void;
}) {
  const guard = useTestGuard();
  const [name, setName] = useState(defaultName);
  const [vorderseite, setVorderseite] = useState<CapturedImage | null>(null);
  const [rueckseite, setRueckseite] = useState<CapturedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    // Testmodus: Einreichung wird abgefangen — kein Upload, kein DB-
    // Eintrag, keine echten Bilder im Bucket. Nur der Hinweis-Toast.
    if (testMode) { guard(); return; }
    if (!vorderseite) { setError('Bitte die Vorderseite live aufnehmen.'); return; }
    if (!rueckseite) { setError('Bitte die Rückseite live aufnehmen.'); return; }
    if (!name.trim()) { setError('Bitte deinen Namen eintragen.'); return; }
    setBusy(true);
    try {
      const vPath = await uploadFuehrerscheinBild(vorderseite.file, abfrageId, fahrerId, 'vorderseite');
      const rPath = await uploadFuehrerscheinBild(rueckseite.file, abfrageId, fahrerId, 'rueckseite');
      const { error: err } = await supabase.from('fuehrerschein_einreichungen').insert({
        abfrage_id: abfrageId,
        fahrer_id: fahrerId,
        name_eingetragen: name.trim(),
        bild_vorderseite_pfad: vPath,
        bild_rueckseite_pfad: rPath,
        vorderseite_aufgenommen_am: vorderseite.takenAt,
        rueckseite_aufgenommen_am: rueckseite.takenAt,
      });
      if (err) throw new Error(err.message);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Übermittlung fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-maja-navy">
        Führerscheinkontrolle{testMode ? ' (Testmodus)' : ''}
      </h2>
      <p className="mt-1 text-sm text-maja-ink">
        Bitte nimm Vorder- und Rückseite deines Führerscheins live mit der
        Kamera auf (keine Galerie-Auswahl möglich).
      </p>

      <div className="mt-3 rounded-lg border border-maja-navy/15 bg-maja-light/60 px-3 py-2 text-xs text-maja-ink dark:bg-surface-700">
        {DATENSCHUTZ_HINWEIS}
      </div>

      {testMode && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Testmodus — diese Einreichung wird nicht gespeichert und es werden
          keine Bilder hochgeladen.
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <LiveCameraField label="Vorderseite *" value={vorderseite} onChange={setVorderseite} disabled={busy} />
        <LiveCameraField label="Rückseite *" value={rueckseite} onChange={setRueckseite} disabled={busy} />
      </div>

      <div className="mt-4">
        <label htmlFor="fs-name" className="label">Name *</label>
        <input
          id="fs-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Vor- und Nachname"
          disabled={busy}
        />
      </div>

      {error && (
        <div role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-5 flex justify-between gap-2">
        <button type="button" className="btn-secondary" onClick={onLater} disabled={busy}>
          Später
        </button>
        <button type="button" className="btn-primary" onClick={() => void handleSubmit()} disabled={busy}>
          {busy ? 'Wird übermittelt …' : 'Absenden'}
        </button>
      </div>
    </div>
  );
}
