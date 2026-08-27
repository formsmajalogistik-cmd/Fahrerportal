// Belege nachträglich zu einem eingereichten Formular ergänzen.
//
// Die ergänzten Belege wandern in dieselbe dynamic_photos-Liste wie die
// Fahrer-Belege (siehe lib/belegeErgaenzen.ts) — dadurch greifen
// Beleg-Slots, Seiten-Duplizierung und "PDFs zusammenführen" ohne
// jede Sonderbehandlung in der PDF-Erzeugung.

import { useEffect, useMemo, useState } from 'react';
import { XIcon } from '../../components/icons';
import { Spinner } from '../../components/Spinner';
import { useScrollLock } from '../../lib/useScrollLock';
import { useTestGuard } from '../../auth/TestModeContext';
import { useAuth } from '../../auth/AuthContext';
import { downloadFromOneDrive } from '../../lib/onedrive';
import {
  belegFelder, belegeAusDaten, istErgaenzt, ladeBelegHoch, speichereBelege,
  standardBelegFeld,
  type ErgaenzterBeleg,
} from '../../lib/belegeErgaenzen';
import type { AusgefuelltesFormular, FormSchema } from '../../types/db';

interface Props {
  formular: Pick<AusgefuelltesFormular, 'id' | 'created_at' | 'daten'>;
  templateName: string;
  schema: FormSchema | null | undefined;
  onClose: () => void;
  /** Wird nach dem Speichern aufgerufen — der Aufrufer lädt neu. */
  onSaved: () => void;
}

export function BelegeErgaenzenDialog({
  formular, templateName, schema, onClose, onSaved,
}: Props) {
  useScrollLock();
  const guard = useTestGuard();
  const { profile } = useAuth();

  const felder = useMemo(() => belegFelder(schema), [schema]);
  // Vorauswahl ist die BELEG-Sektion, nicht einfach das erste Bild-Feld.
  // Lässt sie sich nicht eindeutig bestimmen, bleibt die Auswahl leer und
  // der Admin entscheidet — lieber nachfragen als still in den
  // Zusatzbildern landen.
  const standard = useMemo(() => standardBelegFeld(schema), [schema]);
  const [feldId, setFeldId] = useState<string>(standard?.id ?? '');
  const [liste, setListe] = useState<ErgaenzterBeleg[]>(
    () => belegeAusDaten(formular.daten as Record<string, unknown>, standard?.id ?? ''),
  );
  const [kennzeichen, setKennzeichen] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Feldwechsel: Liste des gewählten Beleg-Feldes laden.
  useEffect(() => {
    if (!feldId) return;
    const t = window.setTimeout(() => {
      setListe(belegeAusDaten(formular.daten as Record<string, unknown>, feldId));
      setDirty(false);
    }, 0);
    return () => window.clearTimeout(t);
  }, [feldId, formular.daten]);

  async function dateienHinzufuegen(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (!feldId) { setFehler('Bitte zuerst die Beleg-Sektion wählen.'); return; }
    if (guard()) return;
    setFehler(null);
    const neu: ErgaenzterBeleg[] = [];
    try {
      for (const datei of Array.from(files)) {
        const teile = await ladeBelegHoch({
          formular,
          templateName,
          datei,
          kennzeichen,
          benutzerId: profile?.id ?? null,
          onFortschritt: (text) => setBusy(text),
        });
        neu.push(...teile);
      }
      setListe((cur) => [...cur, ...neu]);
      setDirty(true);
      setKennzeichen('');
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Upload fehlgeschlagen.');
    } finally {
      setBusy(null);
    }
  }

  function verschieben(index: number, delta: -1 | 1) {
    const ziel = index + delta;
    if (ziel < 0 || ziel >= liste.length) return;
    const next = liste.slice();
    [next[index], next[ziel]] = [next[ziel], next[index]];
    setListe(next);
    setDirty(true);
  }

  function entfernen(index: number) {
    setListe((cur) => cur.filter((_, i) => i !== index));
    setDirty(true);
  }

  async function speichern() {
    if (!feldId) { setFehler('Bitte zuerst die Beleg-Sektion wählen.'); return; }
    if (guard()) return;
    setBusy('Speichern …');
    setFehler(null);
    const res = await speichereBelege(formular.id, feldId, liste);
    setBusy(null);
    if (!res.ok) { setFehler(res.fehler ?? 'Speichern fehlgeschlagen.'); return; }
    setDirty(false);
    onSaved();
    onClose();
  }

  const anzahlErgaenzt = liste.filter(istErgaenzt).length;
  const gewaehltesFeld = felder.find((f) => f.id === feldId) ?? null;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8">
      <div className="card w-full max-w-3xl p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-maja-navy">Belege ergänzen</h2>
            <p className="text-xs text-maja-muted">
              Bilder oder PDFs hinzufügen. Bei PDFs wird jede Seite ein eigener
              Beleg. Anschließend „PDFs neu erzeugen", damit sie in der PDF
              erscheinen.
            </p>
          </div>
          <button
            type="button" onClick={onClose}
            className="rounded-md p-1 text-maja-muted hover:bg-maja-light"
            aria-label="Schließen"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {felder.length === 0 ? (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Dieses Template hat keine Beleg-Sektion (Feld vom Typ
            „dynamic_photos"). Ohne eine solche Sektion gibt es in der PDF
            keinen Platz für Belege.
          </div>
        ) : (
          <div className="space-y-4">
            {(felder.length > 1 || !feldId) && (
              <div>
                <label htmlFor="be-feld" className="label">Beleg-Sektion</label>
                <select
                  id="be-feld" className="input"
                  value={feldId}
                  onChange={(e) => setFeldId(e.target.value)}
                  disabled={!!busy}
                >
                  {!feldId && <option value="">— bitte wählen —</option>}
                  {felder.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                      {f.art === 'zusatz' ? ' (Zusatzbilder — nicht in der Belege-PDF)' : ''}
                    </option>
                  ))}
                </select>
                {!feldId ? (
                  <p className="mt-1 text-sm text-amber-900">
                    In diesem Template ist keine eindeutige Beleg-Sektion zu
                    erkennen. Bitte die richtige Sektion wählen — Zusatzbilder
                    erscheinen NICHT in der Belege-PDF.
                  </p>
                ) : gewaehltesFeld?.art === 'zusatz' ? (
                  <p className="mt-1 text-sm text-amber-900">
                    Achtung: „{gewaehltesFeld.label}" ist die Zusatzbilder-Sektion.
                    Hier abgelegte Dateien erscheinen nicht in der Belege-PDF.
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-maja-muted">
                    Ergänzte Belege landen in dieser Sektion und damit in der
                    Belege-PDF.
                  </p>
                )}
              </div>
            )}

            {/* Upload */}
            <div className="rounded-lg border border-dashed border-maja-navy/25 p-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <div>
                  <label htmlFor="be-kz" className="label">
                    Kennzeichen (optional)
                  </label>
                  <input
                    id="be-kz" className="input"
                    placeholder="z.B. M-XY 1234"
                    value={kennzeichen}
                    onChange={(e) => setKennzeichen(e.target.value)}
                    disabled={!!busy}
                  />
                  <p className="mt-1 text-xs text-maja-muted">
                    Wird als Overlay fest in die gleich hochgeladenen Belege
                    gebrannt.
                  </p>
                </div>
                <label className="btn-primary cursor-pointer">
                  <input
                    type="file"
                    className="hidden"
                    multiple
                    accept="image/jpeg,image/png,image/jpg,application/pdf"
                    disabled={!!busy}
                    onChange={(e) => {
                      void dateienHinzufuegen(e.target.files);
                      e.currentTarget.value = '';
                    }}
                  />
                  Dateien wählen
                </label>
              </div>
            </div>

            {busy && (
              <div className="flex items-center gap-2 rounded-lg bg-maja-light/60 px-3 py-2 text-sm text-maja-ink">
                <Spinner /> <span>{busy}</span>
              </div>
            )}
            {fehler && (
              <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {fehler}
              </div>
            )}

            {/* Liste */}
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-maja-navy">
                  Belege in dieser Sektion ({liste.length})
                </h3>
                <span className="text-xs text-maja-muted">
                  {anzahlErgaenzt} nachträglich ergänzt · Reihenfolge = Reihenfolge in der PDF
                </span>
              </div>
              {liste.length === 0 ? (
                <p className="rounded-lg bg-maja-light/60 px-3 py-3 text-sm text-maja-muted">
                  Noch keine Belege. Auch ein Formular ganz ohne Fahrer-Belege
                  lässt sich hier befüllen.
                </p>
              ) : (
                <ul className="divide-y divide-maja-navy/10 rounded-lg border border-maja-navy/15">
                  {liste.map((b, i) => (
                    <BelegZeile
                      key={b.storage_path ?? `idx-${i}`}
                      beleg={b}
                      index={i}
                      anzahl={liste.length}
                      formularId={formular.id}
                      disabled={!!busy}
                      onHoch={() => verschieben(i, -1)}
                      onRunter={() => verschieben(i, 1)}
                      onEntfernen={() => entfernen(i)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={!!busy}>
            Abbrechen
          </button>
          <button
            type="button" className="btn-primary"
            onClick={() => void speichern()}
            disabled={!!busy || !dirty || felder.length === 0}
          >
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Eine Zeile der Beleg-Liste.
 *
 * Fahrer-Belege sind bewusst NICHT entfernbar — sie gehören zur
 * eingereichten Dokumentation. Umsortieren ist erlaubt, weil die
 * Reihenfolge nur die Darstellung in der PDF bestimmt.
 */
function BelegZeile({
  beleg, index, anzahl, formularId, disabled, onHoch, onRunter, onEntfernen,
}: {
  beleg: ErgaenzterBeleg;
  index: number;
  anzahl: number;
  formularId: string;
  disabled: boolean;
  onHoch: () => void;
  onRunter: () => void;
  onEntfernen: () => void;
}) {
  const ergaenzt = istErgaenzt(beleg);
  const [vorschau, setVorschau] = useState<string | null>(null);

  // Vorschau nur für ergänzte Belege laden — die Fahrer-Belege sind oft
  // viele und liegen alle in OneDrive; sie alle zu ziehen wäre teuer.
  useEffect(() => {
    if (!ergaenzt || !beleg.storage_path) return;
    let abgebrochen = false;
    let url: string | null = null;
    void (async () => {
      try {
        const blob = await downloadFromOneDrive(beleg.storage_path!, { formularId });
        if (abgebrochen) return;
        url = URL.createObjectURL(blob);
        setVorschau(url);
      } catch { /* Vorschau ist optional */ }
    })();
    return () => {
      abgebrochen = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [ergaenzt, beleg.storage_path, formularId]);

  const name = beleg.dateiname
    ?? beleg.storage_path?.split('/').pop()
    ?? `Beleg ${index + 1}`;

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2">
      <span className="w-6 shrink-0 text-xs font-semibold text-maja-muted">
        {index + 1}.
      </span>
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded border border-maja-navy/15 bg-maja-light/60">
        {vorschau ? (
          <img src={vorschau} alt="" className="h-full w-full object-cover" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1 basis-40">
        <div className="truncate text-sm text-maja-ink">{name}</div>
        <div className="text-xs text-maja-muted">
          {ergaenzt ? (
            <>
              <span className="mr-1 inline-flex items-center rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800 dark:!bg-sky-900 dark:!text-sky-100">
                Ergänzt
              </span>
              {beleg.ergaenzt_am
                ? new Date(beleg.ergaenzt_am).toLocaleString('de-DE')
                : ''}
              {beleg.kennzeichen ? ` · ${beleg.kennzeichen}` : ''}
            </>
          ) : (
            'Vom Fahrer erfasst'
          )}
        </div>
      </div>
      {/* Auf Mobile eigene Zeile — sonst quetschen die Buttons den
          Dateinamen auf drei Zeichen zusammen. */}
      <div className="flex w-full shrink-0 items-center justify-end gap-1 sm:w-auto">
        <button
          type="button" className="btn-secondary px-2 py-1 text-xs"
          onClick={onHoch} disabled={disabled || index === 0}
          aria-label="Nach oben"
        >↑</button>
        <button
          type="button" className="btn-secondary px-2 py-1 text-xs"
          onClick={onRunter} disabled={disabled || index === anzahl - 1}
          aria-label="Nach unten"
        >↓</button>
        {ergaenzt && (
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            onClick={onEntfernen} disabled={disabled}
          >
            Entfernen
          </button>
        )}
      </div>
    </li>
  );
}
