import { useCallback, useRef, useState } from 'react';

interface Options {
  /** Schwellwert in ms — typisch 500. */
  durationMs?: number;
  /** Maximaler Finger-Drift bevor der Press abgebrochen wird (px). */
  moveTolerancePx?: number;
}

export interface LongPressBindings {
  pressing: boolean;
  handlers: {
    onTouchStart: React.TouchEventHandler;
    onTouchMove: React.TouchEventHandler;
    onTouchEnd: React.TouchEventHandler;
    onTouchCancel: React.TouchEventHandler;
    onMouseDown: React.MouseEventHandler;
    onMouseMove: React.MouseEventHandler;
    onMouseUp: React.MouseEventHandler;
    onMouseLeave: React.MouseEventHandler;
  };
}

/**
 * Simpler Long-Press-Hook ohne Library. Feuert onLongPress nach
 * durationMs, wenn der Finger nicht zu weit verrutscht. onShortClick
 * wird nur gefeuert, wenn das Press unter der Schwelle bleibt.
 */
export function useLongPress(
  onLongPress: () => void,
  onShortClick?: () => void,
  { durationMs = 500, moveTolerancePx = 10 }: Options = {},
): LongPressBindings {
  const timerRef = useRef<number | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const firedLongRef = useRef(false);
  // Wird true, sobald der Finger die Drift-Toleranz überschreitet —
  // dann gilt der Gesture als Scroll, weder Long-Press noch Short-Click
  // wird ausgelöst.
  const cancelledRef = useRef(false);
  const [pressing, setPressing] = useState(false);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setPressing(false);
  }, []);

  const start = useCallback((x: number, y: number) => {
    firedLongRef.current = false;
    cancelledRef.current = false;
    setPressing(true);
    startPosRef.current = { x, y };
    timerRef.current = window.setTimeout(() => {
      firedLongRef.current = true;
      setPressing(false);
      onLongPress();
    }, durationMs);
  }, [durationMs, onLongPress]);

  const move = useCallback((x: number, y: number) => {
    const s = startPosRef.current;
    if (!s) return;
    const dx = x - s.x;
    const dy = y - s.y;
    if (dx * dx + dy * dy > moveTolerancePx * moveTolerancePx) {
      // Gesture wurde zum Scroll — short-click bei touchend unterdrücken.
      cancelledRef.current = true;
      clear();
    }
  }, [moveTolerancePx, clear]);

  const end = useCallback(() => {
    const wasLong = firedLongRef.current;
    const cancelled = cancelledRef.current;
    clear();
    if (!wasLong && !cancelled && onShortClick) onShortClick();
  }, [clear, onShortClick]);

  return {
    pressing,
    handlers: {
      onTouchStart: (e) => {
        const t = e.touches[0];
        if (t) start(t.clientX, t.clientY);
      },
      onTouchMove: (e) => {
        const t = e.touches[0];
        if (t) move(t.clientX, t.clientY);
      },
      onTouchEnd: () => end(),
      onTouchCancel: () => clear(),
      onMouseDown: (e) => start(e.clientX, e.clientY),
      onMouseMove: (e) => move(e.clientX, e.clientY),
      onMouseUp: () => end(),
      onMouseLeave: () => clear(),
    },
  };
}
