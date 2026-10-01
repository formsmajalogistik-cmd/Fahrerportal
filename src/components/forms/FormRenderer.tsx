import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormField, FormSchema, FormSection } from '../../types/db';
import { schadenfotoZiel } from '../../lib/bildFeldArt';
import { zusatzbilderAusWert } from '../../lib/pendingFoto';
import { zusatzbildSpeichern } from '../../lib/zusatzbildUpload';
import { diagnose } from '../../lib/diagnose';
import { useSync } from '../../sync/SyncContext';
import { ErrorBoundary } from '../ErrorBoundary';
import { TextField } from './fields/TextField';
import { NumberField } from './fields/NumberField';
import { DateField } from './fields/DateField';
import { SelectField } from './fields/SelectField';
import { CheckboxesField } from './fields/CheckboxesField';
import { CheckboxesWithTextField } from './fields/CheckboxesWithTextField';
import { TextareaField } from './fields/TextareaField';
import { PhotoField } from './fields/PhotoField';
import { SignatureField } from './fields/SignatureField';
import { DamageDiagramField } from './fields/DamageDiagramField';
import { DynamicPhotosField } from './fields/DynamicPhotosField';
import { AddressField } from './fields/AddressField';
import { StampField } from './fields/StampField';

/**
 * Neuer Feldwert — oder eine Funktion „vorheriger Wert → neuer Wert".
 * Die Funktionsform brauchen Felder, die erst nach einem asynchronen
 * Schritt (Upload) anhängen; mit einem fertigen Wert schrieben sie den
 * Stand vom Beginn des Uploads zurück und verlören Zwischenänderungen.
 */
export type FeldWert = unknown | ((vorher: unknown) => unknown);

interface Props {
  schema: FormSchema;
  data: Record<string, unknown>;
  onChange: (fieldId: string, value: FeldWert) => void;
  disabled?: boolean;
  /** OneDrive-Ordner des Formulars — Photos landen unter <folder>/Fotos/ */
  oneDriveFolder: string;
  /** ID der Formular-Instanz (ausgefuellte_formulare.id) — Photo-Felder
   *  brauchen sie für die Upload-Queue. */
  formularId?: string;
  /** Optional: nur diese Sections rendern (für Seitenfilterung). */
  sections?: FormSection[];
}

export function FormRenderer({ schema, data, onChange, disabled, oneDriveFolder, formularId, sections }: Props) {
  const visible = sections ?? schema.sections ?? [];

  const { triggerSync } = useSync();

  // Ziel für Fotos nach dem Setzen eines Schadenpunkts: das Zusatzbilder-
  // Feld (lib/bildFeldArt) — NICHT einfach das erste Bild-Feld, das kann
  // die Beleg-Sektion sein.
  const schadenfotoFeld = useMemo(() => schadenfotoZiel(schema), [schema]);

  // Meldet das Diagramm neue Punkte, fragen wir nach einem Foto. Der
  // Dialog erscheint auch ohne Zusatzbilder-Feld — dann mit Hinweis,
  // statt die Aufnahme still ins Leere laufen zu lassen.
  const [photoPrompt, setPhotoPrompt] = useState<{ count: number } | null>(null);
  const [fotoStatus, setFotoStatus] = useState<{ art: 'laeuft' | 'ok' | 'fehler'; text: string } | null>(null);
  useEffect(() => {
    if (disabled) return;
    function onAdded(ev: Event) {
      const detail = (ev as CustomEvent<{ count: number }>).detail;
      if (!detail || detail.count <= 0) return;
      diagnose('foto_dialog_geoeffnet', {
        neue_punkte: detail.count, ziel: schadenfotoFeld?.id ?? null,
      });
      if (!schadenfotoFeld) diagnose('foto_dialog_kein_ziel', { neue_punkte: detail.count });
      setPhotoPrompt({ count: detail.count });
    }
    window.addEventListener('maja:damage-points-added', onAdded);
    return () => window.removeEventListener('maja:damage-points-added', onAdded);
  }, [disabled, schadenfotoFeld]);

  // ESC schließt den Dialog wie „Überspringen".
  useEffect(() => {
    if (!photoPrompt) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { diagnose('foto_dialog_uebersprungen', { weg: 'esc' }); setPhotoPrompt(null); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [photoPrompt]);

  // Eigene Datei-Felder für den Dialog — IMMER gerendert, unabhängig von
  // der Formularseite. Vorher wurde das Kamera-Feld der Zusatzbilder per
  // getElementById gesucht; lag es auf einer anderen Seite, gab es das
  // Element nicht und „Foto aufnehmen" tat nichts.
  const kameraRef = useRef<HTMLInputElement>(null);
  const galerieRef = useRef<HTMLInputElement>(null);
  const restPunkte = useRef(0);

  // Kamera geschlossen ohne Foto: moderne Browser melden `cancel`.
  useEffect(() => {
    const els = [kameraRef.current, galerieRef.current].filter((x): x is HTMLInputElement => !!x);
    const onCancel = () => diagnose('kamera_abgebrochen', {});
    els.forEach((el) => el.addEventListener('cancel', onCancel));
    return () => els.forEach((el) => el.removeEventListener('cancel', onCancel));
  }, []);

  function oeffneAuswahl(art: 'kamera' | 'galerie') {
    if (!schadenfotoFeld || !photoPrompt) return;
    restPunkte.current = photoPrompt.count - 1;
    const el = art === 'kamera' ? kameraRef.current : galerieRef.current;
    diagnose('kamera_geoeffnet', { art, ziel: schadenfotoFeld.id, input_vorhanden: !!el });
    // Direkt in der Nutzergeste klicken — iOS blockiert verzögerte Aufrufe.
    el?.click();
    // Dialog sofort schließen: bricht der Fahrer die Kamera ab, kommt
    // kein Ereignis zurück, und die Skizze muss trotzdem bedienbar sein.
    setPhotoPrompt(null);
  }

  async function fotoGewaehlt(file: File) {
    const ziel = schadenfotoFeld;
    if (!ziel) return;
    const rest = restPunkte.current;
    restPunkte.current = 0;
    setFotoStatus({ art: 'laeuft', text: `Foto wird in „${ziel.label}" gespeichert …` });
    try {
      const { wert, inWarteschlange } = await zusatzbildSpeichern(file, {
        feldId: ziel.id, oneDriveFolder, formularId, quelle: 'schaden',
      });
      onChange(ziel.id, (vorher: unknown) => [...zusatzbilderAusWert(vorher), wert]);
      if (inWarteschlange) triggerSync();
      diagnose('foto_gespeichert', { ziel: ziel.id, warteschlange: inWarteschlange });
      setFotoStatus({
        art: 'ok',
        text: inWarteschlange
          ? `Foto in „${ziel.label}" gesichert — wird hochgeladen, sobald Empfang da ist.`
          : `Foto in „${ziel.label}" gespeichert.`,
      });
      // Mehrere neue Schäden: nach jedem Foto das nächste anbieten.
      if (rest > 0) setPhotoPrompt({ count: rest });
    } catch (err) {
      setFotoStatus({ art: 'fehler', text: err instanceof Error ? err.message : 'Foto konnte nicht gespeichert werden.' });
    }
  }

  // Status-Hinweis nach ein paar Sekunden ausblenden (Fehler bleiben, bis
  // sie weggetippt werden).
  useEffect(() => {
    if (!fotoStatus || fotoStatus.art !== 'ok') return;
    const t = window.setTimeout(() => setFotoStatus(null), 4000);
    return () => window.clearTimeout(t);
  }, [fotoStatus]);

  function ueberspringen(weg: string) {
    diagnose('foto_dialog_uebersprungen', { weg });
    setPhotoPrompt(null);
  }

  return (
    <div className="space-y-6">
      {visible.map((section) => {
        // Aufeinanderfolgende Photo-Felder werden zu einer Gruppe gebündelt
        // und gemeinsam in einem 2-Spalten-Grid gerendert. Alle anderen
        // Feldtypen bleiben einspaltig.
        const groups: Array<{ kind: 'photos' | 'other'; fields: FormField[] }> = [];
        for (const f of section.fields ?? []) {
          if (!f || typeof f !== 'object' || !f.id || !f.type) continue;
          const kind = f.type === 'photo' ? 'photos' : 'other';
          const last = groups[groups.length - 1];
          if (last && last.kind === kind) last.fields.push(f);
          else groups.push({ kind, fields: [f] });
        }
        return (
          <section key={section.id} className="card p-6">
            <h2 className="mb-4 text-lg font-semibold text-maja-navy">{section.title}</h2>
            <div className="space-y-5">
              {groups.map((g, gi) => g.kind === 'photos' ? (
                // Mobile 2, Tablet 3, Desktop 4 Bilder pro Reihe — Cards
                // bleiben quadratisch-knapp und füllen die Breite besser.
                <div key={gi} className="grid grid-cols-2 items-start gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {g.fields.map((field) => (
                    <FieldErrorWrapper key={field.id} field={field}>
                      <FieldSwitch
                        field={field}
                        value={data[field.id]}
                        onChange={(v) => onChange(field.id, v)}
                        disabled={disabled}
                        oneDriveFolder={oneDriveFolder}
                        formularId={formularId}
                      />
                    </FieldErrorWrapper>
                  ))}
                </div>
              ) : (
                g.fields.map((field) => (
                  <FieldErrorWrapper key={field.id} field={field}>
                    <FieldSwitch
                      field={field}
                      value={data[field.id]}
                      onChange={(v) => onChange(field.id, v)}
                      disabled={disabled}
                      oneDriveFolder={oneDriveFolder}
                      formularId={formularId}
                    />
                  </FieldErrorWrapper>
                ))
              ))}
            </div>
          </section>
        );
      })}

      {/* Datei-Felder des Foto-Dialogs — immer im DOM, siehe oben. */}
      <input
        ref={kameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void fotoGewaehlt(f);
        }}
      />
      <input
        ref={galerieRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void fotoGewaehlt(f);
        }}
      />

      {photoPrompt && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-maja-ink/40 px-4 pb-6 pt-12 sm:items-center"
          // Tipp auf den Hintergrund = Überspringen.
          onClick={(e) => { if (e.target === e.currentTarget) ueberspringen('hintergrund'); }}
        >
          <div className="card w-full max-w-sm p-5" role="dialog" aria-modal="true">
            <h3 className="text-base font-semibold text-maja-navy">
              {photoPrompt.count === 1
                ? 'Foto vom Schaden aufnehmen?'
                : `${photoPrompt.count} neue Schäden — Fotos aufnehmen?`}
            </h3>
            {schadenfotoFeld ? (
              <p className="mt-1 text-xs text-maja-muted">
                Die Aufnahme wird automatisch zum Foto-Feld
                „{schadenfotoFeld.label}" hinzugefügt.
                {photoPrompt.count > 1 && ' Nach jedem Foto wird das nächste angeboten.'}
              </p>
            ) : (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Dieses Formular hat kein Feld für Zusatzbilder — Schadenfotos
                können hier nicht abgelegt werden. Der Schaden ist trotzdem
                gespeichert. Bitte die Verwaltung informieren, falls Fotos
                nötig sind.
              </p>
            )}
            <div className="mt-4 grid gap-2">
              {schadenfotoFeld && (
                <>
                  <button type="button" className="btn-primary" onClick={() => oeffneAuswahl('kamera')}>
                    Foto aufnehmen
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => oeffneAuswahl('galerie')}>
                    Aus Galerie wählen
                  </button>
                </>
              )}
              <button type="button"
                      className={schadenfotoFeld ? 'text-xs text-maja-muted hover:underline' : 'btn-secondary'}
                      onClick={() => ueberspringen('knopf')}>
                {schadenfotoFeld ? 'Überspringen — Punkt(e) ohne Foto belassen' : 'Verstanden'}
              </button>
            </div>
          </div>
        </div>
      )}

      {fotoStatus && (
        <div
          role={fotoStatus.art === 'fehler' ? 'alert' : 'status'}
          // Oben, nicht unten: unten liegt der Foto-Dialog für den nächsten
          // Schaden — dort verdeckte die Meldung „Foto aufnehmen".
          className={`fixed left-1/2 top-4 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-start gap-3 rounded-lg px-4 py-2 text-sm shadow-lg ${
            fotoStatus.art === 'fehler' ? 'bg-red-600 text-white'
              : fotoStatus.art === 'ok' ? 'bg-emerald-600 text-white'
              : 'bg-maja-navy text-white'
          }`}
        >
          <span>{fotoStatus.text}</span>
          {fotoStatus.art !== 'laeuft' && (
            <button type="button" className="font-semibold underline" onClick={() => setFotoStatus(null)}>
              OK
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FieldErrorWrapper({ field, children }: { field: FormField; children: React.ReactNode }) {
  const showPrefillHint = field.prefill?.enabled && !field.prefill?.editable;
  return (
    <ErrorBoundary
      fallback={({ error, reset }) => (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <div className="font-medium">
            Feld „{field.label}" konnte nicht gerendert werden
          </div>
          <div className="mt-1 text-xs">{error.message}</div>
          <button onClick={reset}
                  className="mt-2 text-xs font-medium text-maja-accent hover:underline">
            Erneut versuchen
          </button>
        </div>
      )}
    >
      <div className="relative">
        {children}
        {showPrefillHint && (
          <span className="pointer-events-none absolute right-2 top-0 -translate-y-2 rounded bg-maja-light px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-maja-muted dark:bg-slate-700 dark:text-slate-300">
            vorgegeben
          </span>
        )}
      </div>
    </ErrorBoundary>
  );
}

interface FieldProps {
  field: FormField;
  value: unknown;
  onChange: (v: FeldWert) => void;
  disabled?: boolean;
  oneDriveFolder: string;
  formularId?: string;
}

function FieldSwitch({ field, value, onChange, disabled, oneDriveFolder, formularId }: FieldProps) {
  // Read-only-Prefill: Wenn das Feld als „vorausfüllbar" markiert ist und
  // der Fahrer es NICHT ändern darf, wird es zusätzlich zum form-level
  // disabled gesperrt.
  const effDisabled = disabled
    || (field.prefill?.enabled === true && field.prefill?.editable !== true);
  switch (field.type) {
    case 'text':
      return <TextField field={field} value={value} onChange={onChange} disabled={effDisabled} />;
    case 'number':
      return <NumberField field={field} value={value} onChange={onChange} disabled={effDisabled} />;
    case 'date':
      return <DateField field={field} value={value} onChange={onChange} disabled={effDisabled} />;
    case 'select':
      return <SelectField field={field} value={value} onChange={onChange} disabled={effDisabled} />;
    case 'checkboxes':
      return <CheckboxesField field={field} value={value} onChange={onChange} disabled={effDisabled} />;
    case 'checkboxes_with_text':
      return <CheckboxesWithTextField field={field} value={value} onChange={onChange} disabled={effDisabled} />;
    case 'textarea':
      return <TextareaField field={field} value={value} onChange={onChange} disabled={effDisabled} />;
    case 'photo':
      return (
        <PhotoField
          field={field} value={value}
          oneDriveFolder={oneDriveFolder}
          formularId={formularId}
          onChange={onChange} disabled={effDisabled}
        />
      );
    case 'signature':
      return <SignatureField field={field} value={value} onChange={onChange} disabled={effDisabled} />;
    case 'damage_diagram':
      return <DamageDiagramField field={field} value={value} onChange={onChange} disabled={effDisabled} />;
    case 'dynamic_photos':
      return (
        <DynamicPhotosField
          field={field} value={value}
          oneDriveFolder={oneDriveFolder}
          formularId={formularId}
          onChange={onChange} disabled={effDisabled}
        />
      );
    case 'address':
      return <AddressField field={field} value={value} onChange={onChange} disabled={effDisabled} />;
    case 'stamp':
      return (
        <StampField
          field={field} value={value}
          oneDriveFolder={oneDriveFolder}
          formularId={formularId}
          onChange={onChange} disabled={effDisabled}
        />
      );
    default:
      return (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Unbekannter Feldtyp: <code>{(field as FormField).type}</code>
        </div>
      );
  }
}
