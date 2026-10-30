// Zustand einer Übersicht (Seite, Filter, Suche, Sortierung) in der URL —
// z.B. /rechnungen?seite=3&versand=nicht_versendet&suche=Arval. Damit
// führen der Zurück-Knopf der App und das Zurück des Browsers/Handys
// genau auf diesen Stand. Zusätzlich: Scroll-Position und zuletzt
// geöffneter Eintrag (sessionStorage), um ihn kurz hervorzuheben.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams, type Location, type NavigateFunction } from 'react-router-dom';

interface Absprung { suche: string; scrollY: number; id: string }

function lese(schluessel: string): Absprung | null {
  try {
    const roh = sessionStorage.getItem(`liste:${schluessel}`);
    return roh ? JSON.parse(roh) as Absprung : null;
  } catch { return null; }
}

export function useListenZustand(schluessel: string) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();

  const wert = useCallback((name: string, standard = ''): string => params.get(name) ?? standard, [params]);

  /** Filter ändern: ersetzt den History-Eintrag (kein Zurück-Schritt je
   *  Tastendruck) und springt auf Seite 1, außer es wird die Seite gesetzt. */
  const setze = useCallback((patch: Record<string, string | number | null | undefined>) => {
    setParams((alt) => {
      const neu = new URLSearchParams(alt);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === '') neu.delete(k); else neu.set(k, String(v));
      }
      if (!('seite' in patch)) neu.delete('seite');
      return neu;
    }, { replace: true });
  }, [setParams]);

  /** Vor dem Öffnen eines Eintrags: Stand merken. */
  const merkeAbsprung = useCallback((id: string) => {
    try {
      sessionStorage.setItem(`liste:${schluessel}`, JSON.stringify({ suche: location.search, scrollY: window.scrollY, id }));
    } catch { /* egal */ }
  }, [schluessel, location.search]);

  // Nach dem Laden: Scroll-Position wiederherstellen + Eintrag hervorheben.
  const [hervorgehoben, setHervorgehoben] = useState<string | null>(null);
  const erledigt = useRef(false);
  const wiederherstellen = useCallback((geladen: boolean) => {
    if (!geladen || erledigt.current) return;
    erledigt.current = true;
    const a = lese(schluessel);
    if (!a || a.suche !== location.search) return;
    requestAnimationFrame(() => window.scrollTo(0, a.scrollY));
    setHervorgehoben(a.id);
    window.setTimeout(() => setHervorgehoben(null), 2500);
  }, [schluessel, location.search]);

  return { wert, setze, merkeAbsprung, wiederherstellen, hervorgehoben };
}

/** Effekt-Variante: ruft wiederherstellen auf, sobald die Liste geladen ist. */
export function useWiederherstellen(wiederherstellen: (geladen: boolean) => void, geladen: boolean) {
  useEffect(() => { wiederherstellen(geladen); }, [wiederherstellen, geladen]);
}

/**
 * „Zurück" aus einer Detailseite: kam man aus der Liste, ist das ein
 * Schritt zurück in der History (Stand bleibt); sonst die zuletzt
 * gemerkte Listen-URL bzw. die Liste ohne Filter.
 */
export function zurueckZurListe(navigate: NavigateFunction, location: Location, schluessel: string, basis: string) {
  if ((location.state as { vonListe?: boolean } | null)?.vonListe && window.history.length > 1) {
    navigate(-1);
    return;
  }
  const a = lese(schluessel);
  navigate(`${basis}${a?.suche ?? ''}`);
}

export function useZurueckZurListe(schluessel: string, basis: string) {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => zurueckZurListe(navigate, location, schluessel, basis), [navigate, location, schluessel, basis]);
}

/** Gewünschte Seite auf die vorhandenen begrenzen (z.B. nach Filter). */
export function seiteBegrenzen(seite: number, seiten: number): number {
  return Math.min(Math.max(1, Number.isFinite(seite) ? Math.floor(seite) : 1), Math.max(1, seiten));
}
