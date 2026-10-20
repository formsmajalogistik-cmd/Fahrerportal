// Laufendes Speichern des Formularstands — lokal UND zum Server.
//
//   * lokal (IndexedDB) 1,5 s nach der letzten Eingabe — Puffer für Funklöcher
//   * Server 3 s nach der letzten Eingabe, sofort bei Seitenwechsel, wenn
//     die App in den Hintergrund geht (visibilitychange/pagehide, dann mit
//     fetch keepalive) und sobald wieder Verbindung da ist
//   * jeder Server-Save erzeugt/aktualisiert serverseitig einen Snapshot
//     (Trigger, Migration 107)
//
// Siehe lib/entwurfSync (bedingtes Schreiben) und lib/entwurfStand (Laden).

import { useCallback, useEffect, useRef, useState } from 'react';
import { getFormDraft, saveFormDraft } from './offlineDb';
import { entwurfKennzahlen, entwurfZumServer, entwurfZumServerBeimVerlassen, type EntwurfVorgang } from './entwurfSync';
import { diagnose } from './diagnose';

export type SpeicherStatus =
  | { art: 'unbekannt' }
  | { art: 'speichert' }
  | { art: 'server'; zeit: number }
  | { art: 'lokal'; zeit: number; grund: 'offline' | 'fehler'; fehler?: string }
  | { art: 'konflikt' }
  | { art: 'eingereicht' };

const LOKAL_MS = 1500;
const SERVER_MS = 3000;
/** Erfolgreiche Saves höchstens einmal pro Minute ins Diagnose-Log. */
const LOG_TAKT_MS = 60_000;

export function useEntwurfSync(args: {
  formularId: string | null;
  aktiv: boolean;             // false: schreibgeschützt, eingereicht, Konfliktauswahl offen
  data: Record<string, unknown>;
  dirty: boolean;
  /** Nach erfolgreichem Server-Save: Stand gilt als gespeichert. */
  onGespeichert: (datenJson: string) => void;
}) {
  const { formularId, aktiv, data, dirty, onGespeichert } = args;
  const [status, setStatus] = useState<SpeicherStatus>({ art: 'unbekannt' });
  const serverStandRef = useRef<string | null>(null);
  const zuletztGesendetRef = useRef<Record<string, unknown> | null>(null);
  const dataRef = useRef(data);
  const dirtyRef = useRef(dirty);
  const aktivRef = useRef(aktiv);
  const laeuftRef = useRef(false);
  const nochmalRef = useRef<EntwurfVorgang | null>(null);
  const logRef = useRef<{ lokal: number; server: number; fehler: string }>({ lokal: 0, server: 0, fehler: '' });
  const onGespeichertRef = useRef(onGespeichert);
  /** Für das Nachziehen eines weiteren Saves aus serverSichern heraus. */
  const serverSichernRef = useRef<(v: EntwurfVorgang) => Promise<boolean>>(async () => false);
  useEffect(() => {
    dataRef.current = data; dirtyRef.current = dirty; aktivRef.current = aktiv;
    onGespeichertRef.current = onGespeichert;
  }, [data, dirty, aktiv, onGespeichert]);

  const lokalSichern = useCallback(async (serverOffen: boolean) => {
    if (!formularId) return;
    const daten = dataRef.current;
    try {
      await saveFormDraft({
        id: formularId, data: daten, serverUpdatedAt: null, savedAt: Date.now(),
        serverStand: serverStandRef.current, serverOffen,
      });
      const jetzt = Date.now();
      if (jetzt - logRef.current.lokal > LOG_TAKT_MS) {
        logRef.current.lokal = jetzt;
        diagnose('entwurf_lokal_gespeichert', entwurfKennzahlen(daten), 'entwurf', formularId);
      }
    } catch (err) {
      diagnose('entwurf_lokal_fehler', { fehler: err instanceof Error ? err.message : String(err) }, 'entwurf', formularId);
    }
  }, [formularId]);

  const serverSichern = useCallback(async (vorgang: EntwurfVorgang, ohnePruefung = false): Promise<boolean> => {
    if (!formularId || !aktivRef.current) return false;
    if (laeuftRef.current) { nochmalRef.current = vorgang; return false; }
    laeuftRef.current = true;
    const daten = dataRef.current;
    setStatus({ art: 'speichert' });
    const r = await entwurfZumServer({
      formularId, daten, vorgang,
      erwarteterStand: ohnePruefung ? null : serverStandRef.current,
      zuletztGesendet: zuletztGesendetRef.current,
    });
    laeuftRef.current = false;
    const k = entwurfKennzahlen(daten);
    const jetzt = Date.now();
    if (r.ok) {
      if (r.stand) serverStandRef.current = r.stand;
      zuletztGesendetRef.current = null;
      const json = JSON.stringify(daten);
      onGespeichertRef.current(json);
      setStatus({ art: 'server', zeit: jetzt });
      // Lokale Kopie mit dem neuen Server-Stand markieren.
      const nochOffen = JSON.stringify(dataRef.current) !== json;
      try {
        const lokal = await getFormDraft(formularId);
        await saveFormDraft({
          id: formularId, data: nochOffen ? dataRef.current : daten, serverUpdatedAt: null,
          savedAt: lokal?.savedAt ?? jetzt, serverStand: serverStandRef.current, serverOffen: nochOffen,
        });
      } catch { /* lokal egal — der Server hat den Stand */ }
      if (vorgang !== 'autosave' || jetzt - logRef.current.server > LOG_TAKT_MS) {
        logRef.current.server = jetzt;
        diagnose('entwurf_server_gespeichert', { ok: true, vorgang, ...k }, 'entwurf', formularId);
      }
    } else {
      if (r.grund === 'eingereicht') setStatus({ art: 'eingereicht' });
      else if (r.grund === 'konflikt') setStatus({ art: 'konflikt' });
      else setStatus({ art: 'lokal', zeit: jetzt, grund: r.grund === 'offline' ? 'offline' : 'fehler', fehler: r.fehler });
      const sig = `${r.grund}:${r.fehler ?? ''}`;
      if (sig !== logRef.current.fehler || jetzt - logRef.current.server > LOG_TAKT_MS) {
        logRef.current.fehler = sig; logRef.current.server = jetzt;
        diagnose('entwurf_server_gespeichert', { ok: false, vorgang, grund: r.grund, fehler: (r.fehler ?? '').slice(0, 200), ...k }, 'entwurf', formularId);
      }
    }
    // Während des Speicherns kam ein weiterer Anlass → gleich nachziehen.
    const naechster = nochmalRef.current;
    nochmalRef.current = null;
    if (naechster && dirtyRef.current) void serverSichernRef.current(naechster);
    return r.ok;
  }, [formularId]);
  useEffect(() => { serverSichernRef.current = serverSichern; }, [serverSichern]);

  // Entprellt: lokal nach 1,5 s, Server nach 3 s.
  useEffect(() => {
    if (!formularId || !aktiv || !dirty) return;
    const tLokal = window.setTimeout(() => { void lokalSichern(true); }, LOKAL_MS);
    const tServer = window.setTimeout(() => { void serverSichern('autosave'); }, SERVER_MS);
    return () => { window.clearTimeout(tLokal); window.clearTimeout(tServer); };
  }, [formularId, aktiv, dirty, data, lokalSichern, serverSichern]);

  // Hintergrund / Verlassen: sofort sichern. Wieder sichtbar / online: nachholen.
  useEffect(() => {
    if (!formularId || !aktiv) return;
    function verlassen(grund: string) {
      if (!dirtyRef.current || !formularId) return;
      void lokalSichern(true);
      const daten = dataRef.current;
      const keepalive = entwurfZumServerBeimVerlassen({ formularId, daten, erwarteterStand: serverStandRef.current });
      if (keepalive) zuletztGesendetRef.current = daten;
      else void serverSichern('hintergrund');
      diagnose('entwurf_hintergrund', { grund, keepalive, ...entwurfKennzahlen(daten) }, 'entwurf', formularId);
    }
    const sichtbarkeit = () => {
      if (document.visibilityState === 'hidden') verlassen('hintergrund');
      else if (dirtyRef.current) void serverSichern('autosave');
    };
    const pagehide = () => verlassen('pagehide');
    const online = () => { if (dirtyRef.current) void serverSichern('nachgeholt'); };
    document.addEventListener('visibilitychange', sichtbarkeit);
    window.addEventListener('pagehide', pagehide);
    window.addEventListener('online', online);
    return () => {
      document.removeEventListener('visibilitychange', sichtbarkeit);
      window.removeEventListener('pagehide', pagehide);
      window.removeEventListener('online', online);
    };
  }, [formularId, aktiv, lokalSichern, serverSichern]);

  /** Seitenwechsel im Formular → sofort zum Server. */
  const seitenwechsel = useCallback(() => {
    if (dirtyRef.current) void serverSichern('seitenwechsel');
  }, [serverSichern]);

  /** Beim Laden bzw. nach eigenen Schreibvorgängen (Zwischenprotokoll) setzen. */
  const setServerStand = useCallback((stand: string | null) => { serverStandRef.current = stand; }, []);
  /** Eigener Schreibvorgang ohne Antwort-Stand: Inhalt merken (kein Fehlalarm „Konflikt"). */
  const merkeGesendet = useCallback((d: Record<string, unknown>) => { zuletztGesendetRef.current = d; }, []);

  return { status, setStatus, serverSichern, seitenwechsel, setServerStand, merkeGesendet };
}
