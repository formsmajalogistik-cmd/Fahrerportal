import { useCallback, useEffect, useRef, useState } from 'react';

interface Options {
  /** Long-Press-Schwelle in ms — typisch 600. */
  durationMs?: number;
  /**
   * Maximaler Finger-Drift (px), bei dem der Long-Press-Timer noch
   * läuft. Tap-vs-Scroll-Unterscheidung übernimmt der Browser via
   * synthetischem click-Event, daher kann diese Toleranz deutlich
   * großzügiger sein als für Tap-Detection allein.
   */
  moveTolerancePx?: number;
  /** Wird ausgelöst nach durationMs ohne nennenswerte Bewegung. */
  onLongPress: () => void;
  /** Wird beim normalen Tap / Click ausgelöst — Browser-nativ. */
  onClick?: () => void;
}

export interface LongPressBindings {
  /** True während aktiv gedrückt wird — für visuelles Feedback. */
  pressing: boolean;
  bind: {
    onClick: React.MouseEventHandler;
    onTouchStart: React.TouchEventHandler;
    onTouchMove: React.TouchEventHandler;
    onTouchEnd: React.TouchEventHandler;
    onTouchCancel: React.TouchEventHandler;
    onContextMenu: React.MouseEventHandler;
    onMouseDown: React.MouseEventHandler;
    onMouseMove: React.MouseEventHandler;
    onMouseUp: React.MouseEventHandler;
    onMouseLeave: React.MouseEventHandler;
  };
}

/**
 * Long-Press-Hook mit nativer Tap-Erkennung über onClick.
 *
 * - Tap: kommt direkt über onClick — Browser entscheidet selbst, ob
 *   die Geste ein Tap oder ein Scroll war. Keine eigene Heuristik.
 * - Long-Press: setTimeout(durationMs); nur bei Drift > moveTolerancePx
 *   wird der Timer abgebrochen. Nach Auslösen wird der nachfolgende
 *   click (vom touchend ausgelöst) für 500 ms unterdrückt, damit das
 *   geöffnete Popup nicht sofort wieder zugeklickt wird.
 */
export function useLongPress(
  { onLongPress, onClick, durationMs = 600, moveTolerancePx = 30 }: Options,
): LongPressBindings {
  const timerRef = useRef<number | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const firedLongAtRef = useRef(0);
  const [pressing, setPressing] = useState(false);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setPressing(false);
  }, []);

  const start = useCallback((x: number, y: number) => {
    startPosRef.current = { x, y };
    setPressing(true);
    timerRef.current = window.setTimeout(() => {
      firedLongAtRef.current = Date.now();
      setPressing(false);
      // Haptisches Feedback (Android). iOS ignoriert es stillschweigend.
      try { navigator.vibrate?.(50); } catch { /* noop */ }
      onLongPress();
    }, durationMs);
  }, [durationMs, onLongPress]);

  const move = useCallback((x: number, y: number) => {
    const s = startPosRef.current;
    if (!s || timerRef.current === null) return;
    const dx = x - s.x;
    const dy = y - s.y;
    if (dx * dx + dy * dy > moveTolerancePx * moveTolerancePx) {
      // Drift überschritten — Long-Press abbrechen. Den onClick lassen
      // wir unverändert; der Browser feuert ihn ohnehin nicht, wenn die
      // Geste zum Scroll wurde.
      clear();
    }
  }, [moveTolerancePx, clear]);

  // Aufräumen, falls die Komponente während eines aktiven Press unmountet.
  useEffect(() => () => clear(), [clear]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    // Wenn ein Long-Press gerade gefeuert hat, soll der nachfolgende
    // synthetische Click vom touchend nicht das gerade geöffnete Popup
    // wieder schließen.
    if (Date.now() - firedLongAtRef.current < 500) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onClick?.();
  }, [onClick]);

  return {
    pressing,
    bind: {
      onClick: handleClick,
      onTouchStart: (e) => {
        const t = e.touches[0];
        if (t) start(t.clientX, t.clientY);
      },
      onTouchMove: (e) => {
        const t = e.touches[0];
        if (t) move(t.clientX, t.clientY);
      },
      onTouchEnd: () => clear(),
      onTouchCancel: () => clear(),
      // Verhindert Browser-Kontextmenü (Bild-Speichern etc.) auf Long-
      // Touch und Rechtsklick.
      onContextMenu: (e) => { e.preventDefault(); },
      onMouseDown: (e) => start(e.clientX, e.clientY),
      onMouseMove: (e) => move(e.clientX, e.clientY),
      onMouseUp: () => clear(),
      onMouseLeave: () => clear(),
    },
  };
}
