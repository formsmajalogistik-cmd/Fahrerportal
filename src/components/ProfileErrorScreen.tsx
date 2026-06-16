import { useState } from 'react';
import { MajaLogo } from './Brand';

interface Props {
  onRetry: () => void | Promise<void>;
  onLogout: () => void | Promise<void>;
}

/**
 * Vollbild-Fehlerseite, wenn eine gültige Session existiert, das
 * Profil (inkl. Rolle) aber nicht geladen werden konnte. Verhindert,
 * dass die App in die leere „Fahrer"-Default-Ansicht fällt. Bietet
 * „Erneut versuchen" (Profil neu laden) und „Abmelden" — kein
 * Sackgassen-Zustand.
 */
export function ProfileErrorScreen({ onRetry, onLogout }: Props) {
  const [busy, setBusy] = useState<'retry' | 'logout' | null>(null);

  return (
    <div className="flex min-h-screen items-center justify-center bg-maja-light px-4">
      <div className="card w-full max-w-md p-6 text-center">
        <div className="mb-4 flex justify-center">
          <MajaLogo className="h-9" />
        </div>
        <h1 className="text-lg font-semibold text-maja-navy">
          Profil konnte nicht geladen werden
        </h1>
        <p className="mt-2 text-sm text-maja-muted">
          Du bist angemeldet, aber dein Benutzerprofil ließ sich gerade nicht
          laden. Das liegt meist an einer kurzzeitig schlechten Verbindung.
          Bitte versuche es erneut.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            className="btn-primary"
            disabled={busy !== null}
            onClick={async () => { setBusy('retry'); try { await onRetry(); } finally { setBusy(null); } }}
          >
            {busy === 'retry' ? 'Lädt …' : 'Erneut versuchen'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy !== null}
            onClick={async () => { setBusy('logout'); try { await onLogout(); } finally { setBusy(null); } }}
          >
            {busy === 'logout' ? 'Abmelden …' : 'Abmelden'}
          </button>
        </div>
      </div>
    </div>
  );
}
