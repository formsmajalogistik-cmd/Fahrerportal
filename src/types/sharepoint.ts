/** Formular (Form) - form template assigned to a driver */
export interface Formular {
  id: number;
  titel: string;
  beschreibung: string;
  kategorie: string;
  version: string;
  faelligkeitsDatum?: string;
  status: 'Zugewiesen' | 'In Bearbeitung' | 'Abgeschlossen' | 'Überfällig';
  prioritaet: 'Hoch' | 'Mittel' | 'Niedrig';
  pflicht: boolean;
}

/** OffenesFormular - pending/open form submission */
export interface OffenesFormular {
  id: number;
  formularId: number;
  formularTitel: string;
  eingereichtAm?: string;
  status: 'Offen' | 'In Prüfung' | 'Genehmigt' | 'Abgelehnt';
  kommentar?: string;
}
