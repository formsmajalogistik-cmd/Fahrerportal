// „Adress-Pool bereinigen" — Bestandsdaten blockweise nachziehen (094).
//
// Der ursprüngliche Gesamtdurchlauf als Migration lief im SQL-Editor in
// einen Verbindungs-Timeout. Hier wird stattdessen eine RPC in Blöcken
// aufgerufen, bis nichts mehr offen ist — jeder einzelne Aufruf bleibt
// kurz, und der Fortschritt ist sichtbar.
//
// Neue Werte werden ohnehin schon beim Speichern normalisiert; das hier
// ist ausschließlich für den Altbestand.

import { useCallback, useEffect, useState } from 'react';
import { useTestGuard } from '../auth/TestModeContext';
import {
  bereinigePoolBlock, ladePoolStatus, type PoolStatus,
} from '../lib/feldVorschlaege';

/** Sicherheitsnetz gegen eine Endlosschleife, falls „offen" nie 0 wird. */
const MAX_BLOECKE = 200;

export function AdressPoolBereinigen({ onFertig }: { onFertig?: () => void }) {
  const guard = useTestGuard();
  const [status, setStatus] = useState<PoolStatus | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [start, setStart] = useState(0);
  const [erledigt, setErledigt] = useState(0);
  const [fehler, setFehler] = useState<string | null>(null);
  const [fertig, setFertig] = useState<string | null>(null);

  const laden = useCallback(async () => {
    setStatus(await ladePoolStatus());
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => { void laden(); }, 0);
    return () => window.clearTimeout(t);
  }, [laden]);

  async function bereinigen() {
    if (guard()) return;
    const anfang = status?.offen ?? 0;
    if (anfang === 0) return;
    setLaeuft(true);
    setFehler(null);
    setFertig(null);
    setStart(anfang);
    setErledigt(0);
    let zusammen = 0;
    let umbenannt = 0;
    try {
      for (let i = 0; i < MAX_BLOECKE; i += 1) {
        const schritt = await bereinigePoolBlock(500);
        zusammen += schritt.zusammengefuehrt;
        umbenannt += schritt.umbenannt + schritt.adressbuch;
        setErledigt(Math.max(0, anfang - schritt.offen));
        if (schritt.offen === 0) break;
        // Kein Fortschritt mehr, obwohl noch etwas offen ist: abbrechen
        // statt endlos zu drehen.
        if (schritt.zusammengefuehrt === 0 && schritt.umbenannt === 0
            && schritt.adressbuch === 0) {
          break;
        }
      }
      await laden();
      setFertig(
        `Fertig — ${zusammen} ${zusammen === 1 ? 'Dublette' : 'Dubletten'} zusammengeführt, `
        + `${umbenannt} ${umbenannt === 1 ? 'Wert' : 'Werte'} in einheitliche Schreibweise gebracht.`,
      );
      onFertig?.();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Bereinigung fehlgeschlagen.');
    } finally {
      setLaeuft(false);
    }
  }

  if (!status) return null;

  const prozent = start > 0 ? Math.min(100, Math.round((erledigt / start) * 100)) : 0;
  const sauber = status.offen === 0;

  return (
    <section className="card space-y-3 p-5">
      <div>
        <h2 className="text-sm font-semibold text-maja-navy">Adress-Pool bereinigen</h2>
        <p className="mt-1 text-xs text-maja-muted">
          Bringt bestehende Einträge auf eine einheitliche Schreibweise
          („bremen" → „Bremen") und führt Dubletten zusammen; die
          Häufigkeiten werden dabei addiert. Läuft in kleinen Blöcken und
          kann jederzeit erneut gestartet werden.
        </p>
      </div>

      <dl className="grid gap-2 rounded-lg bg-maja-light/40 p-3 text-xs sm:grid-cols-4">
        <div>
          <dt className="font-medium uppercase tracking-wide text-maja-muted">Einträge</dt>
          <dd className="text-maja-ink">{status.eintraegeGesamt}</dd>
        </div>
        <div>
          <dt className="font-medium uppercase tracking-wide text-maja-muted">Schreibweise offen</dt>
          <dd className="text-maja-ink">{status.offenSchreibweise}</dd>
        </div>
        <div>
          <dt className="font-medium uppercase tracking-wide text-maja-muted">Dubletten-Gruppen</dt>
          <dd className="text-maja-ink">{status.duplikatGruppen}</dd>
        </div>
        <div>
          <dt className="font-medium uppercase tracking-wide text-maja-muted">Adressbuch offen</dt>
          <dd className="text-maja-ink">{status.adressbuchOffen}</dd>
        </div>
      </dl>

      {/* Aufräum-Kandidaten. Bewusst NICHT Teil des Knopfes: Löschen ist
          eine bewusste Entscheidung und läuft über die Liste unten. */}
      {(status.fremdeToepfe > 0 || status.gesamtadressen > 0) && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Zusätzlich liegen im Pool
          {status.fremdeToepfe > 0 && (
            <> <strong>{status.fremdeToepfe}</strong> Einträge in Töpfen, die es
            nicht mehr geben soll (Filter „Sonstige")</>
          )}
          {status.fremdeToepfe > 0 && status.gesamtadressen > 0 && ' und'}
          {status.gesamtadressen > 0 && (
            <> <strong>{status.gesamtadressen}</strong> Straßen-Einträge, die in
            Wahrheit ganze Adressen sind (Filter „Ganze Adressen")</>
          )}
          . Diese werden hier bewusst NICHT automatisch entfernt — sie lassen
          sich unten über den passenden Filter ansehen und gesammelt löschen.
        </p>
      )}

      {laeuft && (
        <div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-maja-navy/10"
            role="progressbar"
            aria-valuenow={prozent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Fortschritt der Bereinigung"
          >
            <div
              className="h-full rounded-full bg-maja-accent transition-[width] duration-200 dark:bg-blue-500"
              style={{ width: `${prozent}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-maja-muted">
            {erledigt} von {start} erledigt …
          </p>
        </div>
      )}

      {fehler && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</div>
      )}
      {fertig && !laeuft && (
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{fertig}</div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-primary"
          disabled={laeuft || sauber}
          onClick={() => void bereinigen()}
        >
          {laeuft ? 'Bereinigt …' : 'Adress-Pool bereinigen'}
        </button>
        {sauber && !laeuft && (
          <span className="text-xs text-maja-muted">
            Alles einheitlich — nichts zu tun.
          </span>
        )}
      </div>
    </section>
  );
}
