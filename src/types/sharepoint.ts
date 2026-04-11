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
