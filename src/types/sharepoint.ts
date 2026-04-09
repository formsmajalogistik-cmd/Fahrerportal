/** Fahrer (Driver) list item */
export interface Fahrer {
  id: number;
  name: string;
  vorname: string;
  email: string;
  telefon: string;
  fuehrerscheinklasse: string;
  status: 'Aktiv' | 'Inaktiv' | 'Urlaub';
  fahrzeug?: string;
  eintrittsdatum?: string;
}

/** Formulare (Form templates) list item */
export interface Formular {
  id: number;
  titel: string;
  beschreibung: string;
  kategorie: string;
  version: string;
  gueltigAb?: string;
  gueltigBis?: string;
  pflicht: boolean;
  status: 'Aktiv' | 'Entwurf' | 'Archiviert';
}

/** Fahrerzuweisung (Driver-Form assignment) list item */
export interface Fahrerzuweisung {
  id: number;
  fahrerId: number;
  fahrerName: string;
  formularId: number;
  formularTitel: string;
  zuweisungsDatum: string;
  faelligkeitsDatum: string;
  status: 'Zugewiesen' | 'In Bearbeitung' | 'Abgeschlossen' | 'Überfällig';
  prioritaet: 'Hoch' | 'Mittel' | 'Niedrig';
}

/** Offene Formulare (Open/pending forms) list item */
export interface OffenesFormular {
  id: number;
  formularId: number;
  formularTitel: string;
  fahrerId: number;
  fahrerName: string;
  eingereichtAm?: string;
  status: 'Offen' | 'In Prüfung' | 'Genehmigt' | 'Abgelehnt';
  kommentar?: string;
  antworten?: Record<string, unknown>;
}

/** SharePoint list item wrapper from Graph API */
export interface SPListItem {
  id: string;
  fields: Record<string, unknown>;
}

/** SharePoint list response */
export interface SPListResponse {
  value: SPListItem[];
  '@odata.nextLink'?: string;
}

/** Dashboard statistics */
export interface DashboardStats {
  totalFahrer: number;
  aktiveFahrer: number;
  totalFormulare: number;
  offeneFormulare: number;
  ueberfaellig: number;
  abgeschlossen: number;
}
