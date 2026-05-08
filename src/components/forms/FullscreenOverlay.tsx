import { useEffect, type ReactNode } from 'react';

/**
 * Vollbild-Modal für Signature- und DamageDiagram-Felder. Bewusst KEIN
 * automatisches Drehen — auf Smartphones führte das CSS-Rotate zu
 * Layout-Problemen mit Touch-Koordinaten. Stattdessen: normales
 * Hochformat-Modal mit voller Bildschirmbreite.
 */
interface Props {
  title: string;
  hint?: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
  confirmDisabled?: boolean;
  /** Optionaler Aktions-Button im Footer links (z.B. „Alles löschen"). */
  destructiveAction?: { label: string; onClick: () => void };
  children: ReactNode;
}

export function FullscreenOverlay({
  title, hint, onCancel, onConfirm,
  confirmLabel = 'Bestätigen',
  confirmDisabled, destructiveAction, children,
}: Props) {
  // body-Scroll-Lock + ESC zum Schließen.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const prevTouch = (document.body.style as CSSStyleDeclaration & { touchAction?: string }).touchAction;
    document.body.style.overflow = 'hidden';
    (document.body.style as CSSStyleDeclaration & { touchAction?: string }).touchAction = 'none';
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      (document.body.style as CSSStyleDeclaration & { touchAction?: string }).touchAction = prevTouch ?? '';
      document.removeEventListener('keydown', onKey);
    };
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-maja-navy/10 bg-white px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-maja-navy">{title}</h2>
          {hint && <p className="text-xs text-maja-muted">{hint}</p>}
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md p-2 text-sm font-medium text-maja-muted hover:bg-maja-light"
        >
          Abbrechen
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-hidden bg-maja-light/30">
        {children}
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-maja-navy/10 bg-white px-4 py-3">
        <div>
          {destructiveAction && (
            <button
              type="button"
              onClick={destructiveAction.onClick}
              className="rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              {destructiveAction.label}
            </button>
          )}
        </div>
        <button type="button" onClick={onConfirm} className="btn-primary" disabled={confirmDisabled}>
          {confirmLabel}
        </button>
      </footer>
    </div>
  );
}
