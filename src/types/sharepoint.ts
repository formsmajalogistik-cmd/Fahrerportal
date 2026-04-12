/**
 * Formular (Form) - active form assigned to the authenticated driver.
 * Matches the fields returned by GET /api/formulare.
 */
export interface Formular {
  id: number;
  formularname: string;
  art: 'Wiederkehrend' | 'Einmalig' | string;
  filloutUrl: string;
  aktiv: boolean;
}

/**
 * OffenesFormular - an in-progress form instance that a driver has started
 * but not yet completed. Matches the fields returned by /api/offene.
 */
export interface OffenesFormular {
  id: number;
  benutzername: string;
  formularname: string;
  fahrzeug: string;
  begonnen: string; // ISO timestamp
  status: 'Offen' | 'Abgeschlossen' | string;
}
