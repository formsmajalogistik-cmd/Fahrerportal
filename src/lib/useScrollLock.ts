import { useEffect } from 'react';

/**
 * Sperrt das Scrollen des Hintergrunds, solange ein Modal/Overlay offen
 * ist. Der Modal-Inhalt selbst bleibt scrollbar (die Sperre sitzt auf
 * <body>, nicht auf dem Overlay).
 *
 * Warum nicht nur `overflow: hidden`?
 * ----------------------------------
 * Auf iOS/Safari ignoriert der Body `overflow: hidden` — der Nutzer
 * scrollt den Hintergrund trotzdem („Scroll-Chaining"). Dort hilft nur,
 * den Body auf `position: fixed` zu setzen und ihn um die aktuelle
 * Scroll-Position nach oben zu verschieben. Beim Schließen wird die
 * Position exakt wiederhergestellt — sonst springt die Seite nach oben.
 *
 * Mehrere gleichzeitig offene Overlays (z.B. Tour-Detail + Routen-
 * Dialog) werden über einen Zähler gehalten: erst wenn das letzte
 * Overlay schließt, wird die Sperre aufgehoben. Damit ist das
 * Zurücksetzen auch bei ESC, Hintergrund-Klick und „Abbrechen"
 * zuverlässig — es hängt nur am Unmount des Effects.
 *
 * @param active false schaltet die Sperre ab (z.B. bei variant="embedded").
 */
export function useScrollLock(active = true): void {
  useEffect(() => {
    if (!active) return;
    if (typeof document === 'undefined') return;
    lock();
    return () => { unlock(); };
  }, [active]);
}

let sperren = 0;
let gemerkteScrollPosition = 0;
let vorherigeStile: {
  overflow: string; position: string; top: string;
  left: string; right: string; width: string;
} | null = null;

/** iOS erkennen — dort braucht es die position:fixed-Variante. */
function istIos(): boolean {
  const ua = navigator.userAgent || '';
  // iPadOS ≥ 13 meldet sich als "Macintosh", hat aber Touch.
  return /iPad|iPhone|iPod/.test(ua)
    || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function lock(): void {
  sperren += 1;
  if (sperren > 1) return;
  const body = document.body;
  vorherigeStile = {
    overflow: body.style.overflow,
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
  };
  gemerkteScrollPosition = window.scrollY || window.pageYOffset || 0;
  body.style.overflow = 'hidden';
  if (istIos()) {
    body.style.position = 'fixed';
    body.style.top = `-${gemerkteScrollPosition}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
  }
}

function unlock(): void {
  sperren = Math.max(0, sperren - 1);
  if (sperren > 0) return;
  const body = document.body;
  const war = vorherigeStile;
  vorherigeStile = null;
  const warFixed = body.style.position === 'fixed';
  body.style.overflow = war?.overflow ?? '';
  body.style.position = war?.position ?? '';
  body.style.top = war?.top ?? '';
  body.style.left = war?.left ?? '';
  body.style.right = war?.right ?? '';
  body.style.width = war?.width ?? '';
  if (warFixed) {
    // Scroll-Position wiederherstellen (iOS-Pfad).
    window.scrollTo(0, gemerkteScrollPosition);
  }
}
