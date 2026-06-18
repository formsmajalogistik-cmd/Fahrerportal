import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useFahrerContext } from '../auth/FahrerContext';
import { fahrerName } from '../lib/names';
import { uploadFuehrerscheinBild } from '../lib/fuehrerscheinStorage';
import type { FuehrerscheinAbfrage } from '../types/db';

const DATENSCHUTZ_HINWEIS =
  'Datenschutzhinweis: Die hochgeladenen Bilder dienen ausschließlich der '
  + 'Überprüfung der Gültigkeit deiner Fahrerlaubnis. Sie werden vertraulich '
  + 'behandelt und unmittelbar nach der Prüfung durch einen Administrator '
  + 'unwiderruflich gelöscht. Eine Speicherung über die Prüfung hinaus findet '
  + 'nicht statt.';

/**
 * Zeigt für eingeloggte Fahrer ein Popup, wenn eine offene Führerschein-
 * Abfrage existiert, zu der das aktive Konto noch NICHT eingereicht hat.
 * Mount-Ort: AppShell — damit erscheint das Popup erst NACH der Konto-
 * Auswahl (App.tsx rendert die Shell erst, wenn kein Picker mehr offen
 * ist). „Später" schließt es nur für die aktuelle Sitzung; beim nächsten
 * Laden erscheint es erneut, bis eingereicht wurde.
 */
export function FuehrerscheinPopupGate() {
  const { profile } = useAuth();
  const { activeFahrer } = useFahrerContext();
  const [abfrage, setAbfrage] = useState<FuehrerscheinAbfrage | null>(null);
  const [needsSubmit, setNeedsSubmit] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [done, setDone] = useState(false);

  const fahrerId = activeFahrer?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    // Deferred (kein synchroner setState im Effect-Body) + bei
    // Konto-Wechsel State zurücksetzen.
    const t = window.setTimeout(() => { void check(); }, 0);
    async function check() {
      if (cancelled) return;
      setDismissed(false);
      setDone(false);
      setNeedsSubmit(false);
      setAbfrage(null);
      if (!fahrerId) return;
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
          .eq('fahrer_id', fahrerId!)
          .maybeSingle();
        if (cancelled) return;
        setAbfrage(open as FuehrerscheinAbfrage);
        setNeedsSubmit(!einr);
      } catch (err) {
        console.warn('[Fuehrerschein] Abfrage-Check fehlgeschlagen', err);
      }
    }
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [fahrerId]);

  if (!fahrerId || !abfrage || !needsSubmit || dismissed) return null;

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
        abfrageId={abfrage.id}
        fahrerId={fahrerId}
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
  abfrageId, fahrerId, defaultName, onDone, onLater,
}: {
  abfrageId: string;
  fahrerId: string;
  defaultName: string;
  onDone: () => void;
  onLater: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [vorderseite, setVorderseite] = useState<File | null>(null);
  const [rueckseite, setRueckseite] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    if (!vorderseite) { setError('Bitte die Vorderseite hochladen.'); return; }
    if (!rueckseite) { setError('Bitte die Rückseite hochladen.'); return; }
    if (!name.trim()) { setError('Bitte deinen Namen eintragen.'); return; }
    setBusy(true);
    try {
      const vPath = await uploadFuehrerscheinBild(vorderseite, abfrageId, fahrerId, 'vorderseite');
      const rPath = await uploadFuehrerscheinBild(rueckseite, abfrageId, fahrerId, 'rueckseite');
      const { error: err } = await supabase.from('fuehrerschein_einreichungen').insert({
        abfrage_id: abfrageId,
        fahrer_id: fahrerId,
        name_eingetragen: name.trim(),
        bild_vorderseite_pfad: vPath,
        bild_rueckseite_pfad: rPath,
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
      <h2 className="text-lg font-semibold text-maja-navy">Führerscheinkontrolle</h2>
      <p className="mt-1 text-sm text-maja-ink">
        Bitte lade Vorder- und Rückseite deines Führerscheins hoch.
      </p>

      <div className="mt-3 rounded-lg border border-maja-navy/15 bg-maja-light/60 px-3 py-2 text-xs text-maja-ink dark:bg-surface-700">
        {DATENSCHUTZ_HINWEIS}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <SeiteUpload label="Vorderseite *" file={vorderseite} onPick={setVorderseite} disabled={busy} />
        <SeiteUpload label="Rückseite *" file={rueckseite} onPick={setRueckseite} disabled={busy} />
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

function SeiteUpload({
  label, file, onPick, disabled,
}: {
  label: string;
  file: File | null;
  onPick: (f: File | null) => void;
  disabled?: boolean;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (!file) {
      queueMicrotask(() => { if (!cancelled) setPreviewUrl(null); });
      return () => { cancelled = true; };
    }
    const url = URL.createObjectURL(file);
    queueMicrotask(() => { if (!cancelled) setPreviewUrl(url); });
    return () => { cancelled = true; URL.revokeObjectURL(url); };
  }, [file]);

  return (
    <div className="rounded-lg border border-slate-300 p-2 dark:border-slate-600">
      <div className="mb-1 text-xs font-medium text-maja-ink">{label}</div>
      <div className="flex aspect-[3/2] items-center justify-center overflow-hidden rounded-md bg-maja-light dark:bg-surface-700">
        {previewUrl ? (
          <img src={previewUrl} alt={label} className="h-full w-full object-contain" />
        ) : (
          <span className="text-xs text-maja-muted">kein Bild</span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" className="btn-secondary px-2 py-1 text-xs"
                disabled={disabled} onClick={() => cameraRef.current?.click()}>
          {file ? 'Neu' : 'Foto'}
        </button>
        <button type="button" className="btn-secondary px-2 py-1 text-xs"
                disabled={disabled} onClick={() => galleryRef.current?.click()}>
          Galerie
        </button>
        {file && (
          <button type="button" className="px-1 text-xs font-medium text-red-600 hover:underline"
                  disabled={disabled} onClick={() => onPick(null)}>
            Entfernen
          </button>
        )}
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
             onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ''; }} />
      <input ref={galleryRef} type="file" accept="image/*" className="hidden"
             onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ''; }} />
    </div>
  );
}
