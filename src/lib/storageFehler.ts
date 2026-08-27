// Verständliche Meldungen für Supabase-Storage-Fehler.
//
// Die rohen Meldungen ("Bucket not found", "new row violates row-level
// security policy") sagen dem Anwender nichts und verschleiern, dass
// meist eine Migration fehlt. Hier wird übersetzt und — wo es eine
// konkrete Ursache gibt — direkt der nächste Schritt genannt.

interface StorageFehlerLike {
  message?: string;
  error?: string;
  statusCode?: string | number;
  name?: string;
}

function text(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  const e = err as StorageFehlerLike;
  return [e.message, e.error, e.name].filter(Boolean).join(' ');
}

/**
 * Übersetzt einen Storage-Fehler. `bucket` und `zweck` fließen in die
 * Meldung ein, damit der Admin weiß, welche Ablage betroffen ist.
 */
export function storageFehlerText(
  err: unknown,
  opts: { bucket: string; migration?: string } = { bucket: '' },
): string {
  const roh = text(err);
  const b = opts.bucket ? `„${opts.bucket}"` : 'Die Ablage';
  const migrationsHinweis = opts.migration
    ? ` Bitte die Datenbank-Migration ${opts.migration} einspielen — sie legt die Ablage an.`
    : '';

  if (/bucket not found|bucket_not_found/i.test(roh)) {
    return `Die Ablage ${b} existiert in der Datenbank noch nicht.${migrationsHinweis}`;
  }
  if (/row-level security|violates row-level/i.test(roh)) {
    return `Keine Berechtigung für die Ablage ${b}. Diese Funktion steht nur Administratoren zur Verfügung.`;
  }
  if (/jwt|not authenticated|invalid token/i.test(roh)) {
    return 'Die Anmeldung ist abgelaufen. Bitte neu anmelden und erneut versuchen.';
  }
  if (/payload too large|exceeded the maximum allowed size|413/i.test(roh)) {
    return 'Die Datei ist zu groß. Bitte ein kleineres Bild verwenden.';
  }
  if (/failed to fetch|networkerror|network request failed/i.test(roh)) {
    return 'Keine Verbindung zum Server. Bitte die Internetverbindung prüfen.';
  }
  if (/mime type|invalid file type/i.test(roh)) {
    return 'Dieses Dateiformat wird nicht unterstützt. Bitte ein PNG oder JPEG verwenden.';
  }
  // Unbekannt: verständlich einleiten, Originaltext für die Fehlersuche
  // anhängen statt ihn zu verschlucken.
  return roh
    ? `Speichern in der Ablage ${b} fehlgeschlagen: ${roh}`
    : `Speichern in der Ablage ${b} fehlgeschlagen.`;
}
