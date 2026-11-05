import { useEffect, useState } from 'react';
import { erechnungSchemaVorhanden } from './stammdaten';

/**
 * true, sobald Migration 115 in der Datenbank ist. Bis dahin (und
 * während der Prüfung: null) blenden die Masken die neuen Felder aus
 * und schreiben sie nicht — sie verhalten sich exakt wie vorher.
 */
export function useERechnungSchema(): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let aktiv = true;
    void erechnungSchemaVorhanden().then((v) => { if (aktiv) setOk(v); });
    return () => { aktiv = false; };
  }, []);
  return ok;
}
