// Einstellungen: Unterschrift und Firmenstempel des Absenders (092).
//
// Nur für Admins. Beide Bilder landen als PNG im privaten Bucket
// „absender"; angezeigt wird über kurzlebige signierte URLs.
//
// Bewusst dieselben Werkzeuge wie in den Formularen:
//   * Unterschrift → das Zeichen-Overlay aus SignatureField (weißer
//     Untergrund, Finger/Stift, auch auf dem Handy).
//   * Stempel → processStampImage, also dieselbe automatische
//     Freistellung wie beim Stempel-Feld. Ergebnis ist ein PNG mit
//     Transparenz, damit im PDF kein weißer Kasten entsteht.

import { useCallback, useEffect, useRef, useState } from 'react';
import { SignatureOverlay } from './forms/fields/SignatureField';
import { ConfirmDialog } from './ConfirmDialog';
import { processStampImage } from '../lib/stampProcessing';
import { useTestGuard } from '../auth/TestModeContext';
import {
  ABSENDER_BUCKET, ABSENDER_MIGRATION,
  absenderSignedUrl, entferneAbsenderBild, ladeAbsenderSignatur,
  speichereAbsenderBild, type AbsenderBildArt, type AbsenderSignatur,
} from '../lib/absenderSignatur';
import { storageFehlerText } from '../lib/storageFehler';

/** Data-URL → Blob, ohne Umweg über fetch(). */
function dataUrlZuBlob(dataUrl: string): Blob {
  const [kopf, daten] = dataUrl.split(',');
  const mime = /:(.*?);/.exec(kopf)?.[1] ?? 'image/png';
  const bin = atob(daten ?? '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Karomuster — macht Transparenz in der Vorschau sichtbar. */
const karo: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg, #e2e8f0 25%, transparent 25%),'
    + 'linear-gradient(-45deg, #e2e8f0 25%, transparent 25%),'
    + 'linear-gradient(45deg, transparent 75%, #e2e8f0 75%),'
    + 'linear-gradient(-45deg, transparent 75%, #e2e8f0 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
};

export function AbsenderSignaturEinstellungen() {
  const guard = useTestGuard();
  const [sig, setSig] = useState<AbsenderSignatur | null>(null);
  const [loading, setLoading] = useState(true);
  const [urls, setUrls] = useState<{ unterschrift: string | null; stempel: string | null }>({
    unterschrift: null, stempel: null,
  });
  const [busy, setBusy] = useState<AbsenderBildArt | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [zeichnen, setZeichnen] = useState(false);
  const [loeschen, setLoeschen] = useState<AbsenderBildArt | null>(null);
  const kameraRef = useRef<HTMLInputElement>(null);
  const galerieRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const laden = useCallback(async () => {
    const s = await ladeAbsenderSignatur();
    setSig(s);
    const [u, st] = await Promise.all([
      s?.unterschrift_pfad ? absenderSignedUrl(s.unterschrift_pfad) : Promise.resolve(null),
      s?.stempel_pfad ? absenderSignedUrl(s.stempel_pfad) : Promise.resolve(null),
    ]);
    setUrls({ unterschrift: u, stempel: st });
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => { void laden(); }, 0);
    return () => window.clearTimeout(t);
  }, [laden]);

  async function speichern(art: AbsenderBildArt, blob: Blob) {
    if (guard()) return;
    setBusy(art); setFehler(null);
    try {
      await speichereAbsenderBild(art, blob);
      await laden();
    } catch (err) {
      setFehler(storageFehlerText(err, {
        bucket: ABSENDER_BUCKET, migration: ABSENDER_MIGRATION,
      }));
    } finally {
      setBusy(null);
    }
  }

  async function entfernen(art: AbsenderBildArt) {
    if (guard()) return;
    setBusy(art); setFehler(null);
    try {
      await entferneAbsenderBild(art);
      await laden();
    } catch (err) {
      setFehler(storageFehlerText(err, {
        bucket: ABSENDER_BUCKET, migration: ABSENDER_MIGRATION,
      }));
    } finally {
      setBusy(null);
      setLoeschen(null);
    }
  }

  /** Stempel-Foto: erst freistellen, dann als PNG ablegen. */
  async function stempelDatei(file: File) {
    setBusy('stempel'); setFehler(null); setHinweis(null);
    try {
      const res = await processStampImage(file);
      if (!res.processed) {
        setHinweis('Automatische Freistellung nicht möglich — das Original wird verwendet. '
          + 'Ein Foto auf hellem, gleichmäßigem Untergrund gelingt meist besser.');
      }
      await speichern('stempel', res.blob);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Stempel-Verarbeitung fehlgeschlagen.');
      setBusy(null);
    }
  }

  /** Direkt-Upload (Unterschrift oder Stempel) — ohne Freistellung,
   *  weil hochgeladene PNGs die Transparenz in der Regel schon haben. */
  async function uploadDatei(art: AbsenderBildArt, file: File) {
    setHinweis(null);
    await speichern(art, file);
  }

  if (loading) {
    return (
      <section className="card p-5">
        <h2 className="text-sm font-semibold text-maja-navy">Unterschrift &amp; Firmenstempel</h2>
        <p className="mt-2 text-xs text-maja-muted">Wird geladen …</p>
      </section>
    );
  }

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-maja-navy">Unterschrift &amp; Firmenstempel</h2>
        <p className="mt-1 text-xs text-maja-muted">
          Werden im Unterschriftsbereich der Briefe automatisch eingesetzt —
          pro Brief abwählbar. Ist nichts hinterlegt, bleibt dort wie bisher
          eine Linie zum Unterschreiben von Hand. Beides gilt nur für dieses
          Konto und liegt in einem nicht öffentlich erreichbaren Ablageort.
        </p>
      </div>

      {fehler && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</div>
      )}
      {hinweis && <p className="text-xs text-maja-muted">{hinweis}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        {/* ---------------- Unterschrift ---------------- */}
        <div className="space-y-2">
          <span className="label">Unterschrift</span>
          {/* Vorschau IMMER auf Weiß — der dunkle Strich ginge auf der
              getönten Dark-Mode-Fläche sonst unter. */}
          <div
            className="flex h-28 items-center justify-center overflow-hidden rounded-lg border border-maja-navy/20 !bg-white dark:border-slate-400"
            style={{ backgroundColor: '#FFFFFF' }}
          >
            {urls.unterschrift ? (
              <img src={urls.unterschrift} alt="Hinterlegte Unterschrift"
                   className="h-full w-full object-contain p-2" />
            ) : (
              <span className="text-xs text-maja-muted">Noch keine Unterschrift hinterlegt</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary text-sm"
                    disabled={busy === 'unterschrift'}
                    onClick={() => setZeichnen(true)}>
              {sig?.unterschrift_pfad ? 'Neu zeichnen' : 'Unterschrift zeichnen'}
            </button>
            <button type="button" className="btn-secondary text-sm"
                    disabled={busy === 'unterschrift'}
                    onClick={() => uploadRef.current?.click()}>
              Bild hochladen
            </button>
            {sig?.unterschrift_pfad && (
              <button type="button"
                      className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                      disabled={busy === 'unterschrift'}
                      onClick={() => setLoeschen('unterschrift')}>
                Entfernen
              </button>
            )}
          </div>
          <p className="text-xs text-maja-muted">
            Zeichnen funktioniert auch am Handy mit dem Finger. Beim Hochladen
            am besten ein PNG mit transparentem Hintergrund.
          </p>
        </div>

        {/* ---------------- Firmenstempel ---------------- */}
        <div className="space-y-2">
          <span className="label">Firmenstempel</span>
          <div
            className="flex h-28 items-center justify-center overflow-hidden rounded-lg border border-maja-navy/20 bg-white dark:border-slate-400"
            style={urls.stempel ? karo : undefined}
          >
            {urls.stempel ? (
              <img src={urls.stempel} alt="Hinterlegter Firmenstempel"
                   className="h-full w-full object-contain p-2" />
            ) : (
              <span className="text-xs text-maja-muted">Noch kein Stempel hinterlegt</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary text-sm"
                    disabled={busy === 'stempel'}
                    onClick={() => kameraRef.current?.click()}>
              {sig?.stempel_pfad ? 'Neu aufnehmen' : 'Stempel fotografieren'}
            </button>
            <button type="button" className="btn-secondary text-sm"
                    disabled={busy === 'stempel'}
                    onClick={() => galerieRef.current?.click()}>
              Bild hochladen
            </button>
            {sig?.stempel_pfad && (
              <button type="button"
                      className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                      disabled={busy === 'stempel'}
                      onClick={() => setLoeschen('stempel')}>
                Entfernen
              </button>
            )}
          </div>
          <p className="text-xs text-maja-muted">
            {busy === 'stempel'
              ? 'Stempel wird verarbeitet …'
              : 'Stempel auf ein weißes Blatt drücken und abfotografieren — '
                + 'der Papierhintergrund wird automatisch freigestellt.'}
          </p>
        </div>
      </div>

      {/* Unterschrift-Upload: ohne Freistellung. */}
      <input ref={uploadRef} type="file" accept="image/png,image/jpeg" className="hidden"
             onChange={(e) => {
               const f = e.target.files?.[0];
               if (f) void uploadDatei('unterschrift', f);
               e.target.value = '';
             }} />
      {/* Stempel per Kamera: mit Freistellung. */}
      <input ref={kameraRef} type="file" accept="image/*" capture="environment" className="hidden"
             onChange={(e) => {
               const f = e.target.files?.[0];
               if (f) void stempelDatei(f);
               e.target.value = '';
             }} />
      {/* Stempel aus der Galerie: ebenfalls mit Freistellung — ein
          abfotografierter Stempel bringt sonst seinen Papierrand mit. */}
      <input ref={galerieRef} type="file" accept="image/*" className="hidden"
             onChange={(e) => {
               const f = e.target.files?.[0];
               if (f) void stempelDatei(f);
               e.target.value = '';
             }} />

      {zeichnen && (
        <SignatureOverlay
          title="Absender"
          initial={null}
          onCancel={() => setZeichnen(false)}
          onConfirm={(url) => {
            setZeichnen(false);
            if (url) void speichern('unterschrift', dataUrlZuBlob(url));
          }}
        />
      )}

      {loeschen && (
        <ConfirmDialog
          title={loeschen === 'unterschrift' ? 'Unterschrift entfernen?' : 'Firmenstempel entfernen?'}
          message="Das Bild wird gelöscht. Bereits erzeugte PDFs bleiben unverändert; neue Briefe erhalten dann wieder eine leere Unterschriftslinie."
          confirmLabel="Entfernen"
          destructive
          onConfirm={async () => { await entfernen(loeschen); }}
          onClose={() => setLoeschen(null)}
        />
      )}
    </section>
  );
}
