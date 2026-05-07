import { useEffect, type ReactNode } from 'react';

/**
 * Vollbild-Overlay für Signature- und DamageDiagram-Felder. Auf
 * Hochformat-Geräten wird der Inhalt mittels CSS-Transform um 90°
 * gedreht, damit die volle Bildschirmbreite zur Verfügung steht.
 *
 * - body-Scroll wird während des Overlays gesperrt.
 * - ESC schließt (über `onCancel`).
 * - „Bestätigen"/„Abbrechen" sind sticky am unteren Rand.
 */
interface Props {
  title: string;
  hint?: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirmDisabled?: boolean;
  children: ReactNode;
}

export function FullscreenOverlay({
  title, hint, onCancel, onConfirm, confirmDisabled, children,
}: Props) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [onCancel]);

  // Auf Hochformat-Geräten (Höhe > Breite, Touch) drehen wir das Overlay um
  // 90° — dadurch wird die "lange" Bildschirmkante zur Breite des Canvas.
  const isPortrait = typeof window !== 'undefined'
    && window.innerHeight > window.innerWidth
    && (window.matchMedia?.('(pointer: coarse)').matches ?? false);

  return (
    <div className="fixed inset-0 z-50 bg-maja-ink/90">
      {isPortrait ? (
        <div
          className="absolute left-1/2 top-1/2 origin-center"
          style={{
            transform: 'translate(-50%, -50%) rotate(90deg)',
            width: '100vh',
            height: '100vw',
          }}
        >
          <OverlayBody
            title={title}
            hint={hint}
            onCancel={onCancel}
            onConfirm={onConfirm}
            confirmDisabled={confirmDisabled}
          >
            {children}
          </OverlayBody>
        </div>
      ) : (
        <div className="absolute inset-0">
          <OverlayBody
            title={title}
            hint={hint}
            onCancel={onCancel}
            onConfirm={onConfirm}
            confirmDisabled={confirmDisabled}
          >
            {children}
          </OverlayBody>
        </div>
      )}
    </div>
  );
}

function OverlayBody({
  title, hint, onCancel, onConfirm, confirmDisabled, children,
}: Props) {
  return (
    <div className="flex h-full w-full flex-col bg-white">
      <header className="flex items-center justify-between gap-3 border-b border-maja-navy/10 bg-white px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-maja-navy">{title}</h2>
          {hint && <p className="text-xs text-maja-muted">{hint}</p>}
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md p-2 text-maja-muted hover:bg-maja-light"
          aria-label="Schließen"
        >
          ✕
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-auto bg-maja-light/30 p-3">
        {children}
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-maja-navy/10 bg-white px-4 py-3">
        <button type="button" onClick={onCancel} className="btn-secondary">Abbrechen</button>
        <button type="button" onClick={onConfirm} className="btn-primary" disabled={confirmDisabled}>
          Bestätigen
        </button>
      </footer>
    </div>
  );
}
