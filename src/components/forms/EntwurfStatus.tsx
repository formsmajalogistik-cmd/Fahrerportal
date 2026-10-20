// Anzeigen rund ums sichere Speichern des Formulars:
//   * SpeicherStatusZeile — „Auf Server gespeichert: 13:46" bzw. „Nur auf
//     diesem Gerät gespeichert — wird übertragen, sobald online"
//   * EntwurfKonfliktDialog — Server und Gerät haben unterschiedliche
//     Stände: der Fahrer wählt, statt dass still entschieden wird
//   * InstallHinweis — einmalig, wenn das Formular im Browser statt in der
//     installierten App ausgefüllt wird (iOS löscht Website-Speicher eher)

import { useState } from 'react';
import type { SpeicherStatus } from '../../lib/useEntwurfSync';
import { istIos } from '../../lib/entwurfStand';

function uhrzeit(ms: number): string {
  return new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export function SpeicherStatusZeile({ status, onKonfliktLoesen }: {
  status: SpeicherStatus;
  onKonfliktLoesen?: (wahl: 'meiner' | 'server') => void;
}) {
  // 'zugewiesen' zeigt die Formularseite als eigenen Hinweis an.
  if (status.art === 'unbekannt' || status.art === 'eingereicht' || status.art === 'zugewiesen') return null;
  if (status.art === 'konflikt') {
    return (
      <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <p className="font-semibold">Auf dem Server liegt inzwischen ein anderer Stand (z.B. von einem anderen Gerät).</p>
        <p className="mt-0.5">Deine Eingaben sind auf diesem Gerät gespeichert, wurden aber nicht übertragen.</p>
        {onKonfliktLoesen && (
          <div className="mt-1.5 flex flex-wrap gap-2">
            <button type="button" className="btn-primary px-3 py-1 text-xs" onClick={() => onKonfliktLoesen('meiner')}>
              Meinen Stand übernehmen
            </button>
            <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => onKonfliktLoesen('server')}>
              Server-Stand laden
            </button>
          </div>
        )}
      </div>
    );
  }
  const text = status.art === 'speichert'
    ? 'Speichert …'
    : status.art === 'server'
      ? `Auf Server gespeichert: ${uhrzeit(status.zeit)}`
      : status.grund === 'offline'
        ? 'Nur auf diesem Gerät gespeichert — wird übertragen, sobald online'
        : 'Nur auf diesem Gerät gespeichert — Übertragung wird wiederholt';
  const farbe = status.art === 'lokal'
    ? 'text-amber-700 dark:!text-amber-300'
    : 'text-maja-muted';
  return (
    <p role="status" aria-live="polite" className={`text-xs ${farbe}`} title={status.art === 'lokal' ? status.fehler : undefined}>
      {status.art === 'server' && <span aria-hidden="true">✓ </span>}
      {text}
    </p>
  );
}

export interface KonfliktStand {
  felder: number;
  zeit: string | null;   // lesbare Zeit
}

export function EntwurfKonfliktDialog({ server, geraet, onWahl }: {
  server: KonfliktStand;
  geraet: KonfliktStand;
  onWahl: (wahl: 'server' | 'geraet') => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-maja-ink/40 sm:items-center sm:px-4 dark:bg-black/60">
      <div role="dialog" aria-modal="true" aria-labelledby="konflikt-titel" className="card w-full max-w-md rounded-b-none p-5 sm:rounded-xl">
        <h2 id="konflikt-titel" className="text-base font-semibold text-maja-navy">Welcher Stand soll weitergelten?</h2>
        <p className="mt-1 text-sm text-maja-ink">
          Für dieses Formular gibt es zwei unterschiedliche Stände. Bitte wähle, mit welchem du weitermachen willst.
        </p>
        <div className="mt-3 grid gap-2">
          <button type="button" className="rounded-lg border border-maja-navy/15 bg-white px-4 py-3 text-left text-sm hover:bg-maja-light dark:!border-slate-600 dark:!bg-slate-800 dark:hover:!bg-slate-700"
                  onClick={() => onWahl('server')}>
            <div className="font-semibold text-maja-ink">Stand vom Server</div>
            <div className="text-xs text-maja-muted">{server.felder} ausgefüllte Felder{server.zeit ? ` · zuletzt ${server.zeit}` : ''}</div>
          </button>
          <button type="button" className="rounded-lg border border-maja-navy/15 bg-white px-4 py-3 text-left text-sm hover:bg-maja-light dark:!border-slate-600 dark:!bg-slate-800 dark:hover:!bg-slate-700"
                  onClick={() => onWahl('geraet')}>
            <div className="font-semibold text-maja-ink">Stand auf diesem Gerät</div>
            <div className="text-xs text-maja-muted">{geraet.felder} ausgefüllte Felder{geraet.zeit ? ` · zuletzt ${geraet.zeit}` : ''}</div>
          </button>
        </div>
        <p className="mt-3 text-xs text-maja-muted">
          Der nicht gewählte Stand bleibt auf dem Server als Version erhalten; das Büro kann ihn bei Bedarf wiederherstellen.
        </p>
      </div>
    </div>
  );
}

const INSTALL_KEY = 'maja:installhinweis-gesehen';

export function InstallHinweis() {
  const [weg, setWeg] = useState(() => {
    try { return localStorage.getItem(INSTALL_KEY) === '1'; } catch { return false; }
  });
  if (weg) return null;
  const ios = istIos();
  return (
    <div role="note" className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:!border-sky-400/30 dark:!bg-sky-950/40 dark:!text-sky-100">
      <p className="font-semibold">Für zuverlässiges Speichern bitte die App zum Home-Bildschirm hinzufügen.</p>
      <p className="mt-0.5">
        {ios
          ? <>Unten auf <strong>Teilen</strong> (Quadrat mit Pfeil) tippen → <strong>„Zum Home-Bildschirm"</strong> → <strong>Hinzufügen</strong>. Danach die App über das neue Symbol öffnen.</>
          : <>Im Browser-Menü <strong>„Zum Startbildschirm hinzufügen"</strong> bzw. <strong>„App installieren"</strong> wählen und die App danach über das neue Symbol öffnen.</>}
      </p>
      <p className="mt-0.5 opacity-80">Dein Formular wird so oder so laufend auf dem Server gesichert.</p>
      <button type="button" className="mt-1.5 font-semibold underline" onClick={() => {
        try { localStorage.setItem(INSTALL_KEY, '1'); } catch { /* egal */ }
        setWeg(true);
      }}>
        Verstanden
      </button>
    </div>
  );
}
