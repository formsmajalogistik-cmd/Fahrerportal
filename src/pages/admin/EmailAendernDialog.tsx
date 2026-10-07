// Einstellungen → Konten: E-Mail-Adresse eines Kontos ändern.
//
// Die Adresse ist Login UND Zustelladresse. Ein Tippfehler würde den
// Fahrer aussperren — daher zweimal eingeben; gespeichert wird erst, wenn
// beide Eingaben (nach Trimmen/Kleinschreibung) übereinstimmen. Die
// eigentliche Prüfung und Änderung macht der Server (api/account.ts).

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { changeEmail, type EmailAenderungErgebnis } from '../../lib/accountApi';
import { useTestGuard } from '../../auth/TestModeContext';
import { formatDateTime } from '../../lib/touren';
import { XIcon } from '../../components/icons';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const norm = (s: string) => s.trim().toLowerCase();

interface Props {
  userId: string;
  name: string;
  aktuelleEmail: string;
  onClose: () => void;
  onGeaendert: (e: EmailAenderungErgebnis) => void;
}

interface Verlauf { id: number; alte_email: string; neue_email: string; am: string; geaendert_von_name: string | null }

export function EmailAendernDialog({ userId, name, aktuelleEmail, onClose, onGeaendert }: Props) {
  const guard = useTestGuard();
  const [neu, setNeu] = useState('');
  const [wdh, setWdh] = useState('');
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [verlauf, setVerlauf] = useState<Verlauf[]>([]);

  useEffect(() => {
    void supabase
      .from('konto_email_aenderungen')
      .select('id, alte_email, neue_email, am, geaendert_von_name')
      .eq('user_id', userId)
      .order('am', { ascending: false })
      .limit(5)
      .then(({ data }) => setVerlauf((data as Verlauf[]) ?? []));
  }, [userId]);

  const a = norm(neu);
  const b = norm(wdh);
  const formatOk = EMAIL_RE.test(a);
  const gleich = a !== '' && a === b;
  const unveraendert = a !== '' && a === norm(aktuelleEmail);
  const speicherbar = formatOk && gleich && !unveraendert && !busy;

  async function speichern() {
    if (guard('E-Mail ändern')) return;
    setBusy(true);
    setFehler(null);
    try {
      const e = await changeEmail(userId, neu, wdh);
      onGeaendert(e);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Ändern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-maja-ink/40 px-4">
      <div className="card w-full max-w-md p-5" role="dialog" aria-modal="true" aria-labelledby="email-aendern-titel">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id="email-aendern-titel" className="text-lg font-semibold text-maja-navy">E-Mail-Adresse ändern</h2>
            <p className="text-xs text-maja-muted">{name}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Schließen"
                  className="rounded-md p-1 text-maja-muted hover:bg-maja-light">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <span className="label">Aktuelle Adresse</span>
            <div className="rounded-lg bg-maja-light/60 px-3 py-2 text-sm text-maja-ink">{aktuelleEmail || '—'}</div>
          </div>
          <div>
            <label className="label" htmlFor="email-neu">Neue Adresse</label>
            <input id="email-neu" type="email" className="input" autoComplete="off" autoFocus
                   value={neu} onChange={(e) => setNeu(e.target.value)} />
            {a !== '' && !formatOk && <p className="mt-1 text-xs text-red-700">Keine gültige E-Mail-Adresse.</p>}
            {unveraendert && <p className="mt-1 text-xs text-red-700">Das ist die bisherige Adresse.</p>}
          </div>
          <div>
            <label className="label" htmlFor="email-wdh">Neue Adresse wiederholen</label>
            <input id="email-wdh" type="email" className="input" autoComplete="off"
                   // Einfügen erlaubt — aber die Wiederholung soll bewusst
                   // getippt werden; der Vergleich fängt Tippfehler ab.
                   value={wdh} onChange={(e) => setWdh(e.target.value)} />
            {b !== '' && !gleich && <p className="mt-1 text-xs text-red-700">Die beiden Eingaben stimmen nicht überein.</p>}
          </div>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Der Fahrer meldet sich danach mit der neuen Adresse an. Das Passwort bleibt unverändert.
            An die neue Adresse geht eine kurze Info-Mail.
          </p>
          {fehler && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</div>}
          {verlauf.length > 0 && (
            <details className="text-xs text-maja-muted">
              <summary className="cursor-pointer">Frühere Änderungen ({verlauf.length})</summary>
              <ul className="mt-1 space-y-0.5">
                {verlauf.map((v) => (
                  <li key={v.id}>
                    {formatDateTime(v.am)}: {v.alte_email} → {v.neue_email}
                    {v.geaendert_von_name ? ` (${v.geaendert_von_name})` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn-primary" disabled={!speicherbar} onClick={() => void speichern()}>
            {busy ? 'Speichern …' : 'Adresse ändern'}
          </button>
        </div>
      </div>
    </div>
  );
}
