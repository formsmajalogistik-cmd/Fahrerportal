// Domain-Typen für das Frontend — dünne Wrapper über das Supabase-Row-Schema.
// Das eigentliche Database-Schema liegt in ./supabase.ts.

import type { Database } from './supabase';

export type UserRole = Database['public']['Enums']['user_role'];
export type FormularStatus = Database['public']['Enums']['formular_status'];
export type TourStatus = Database['public']['Enums']['tour_status'];
export type TourenArt = Database['public']['Enums']['tourenart'];
export type ProtokollArt = 'app' | 'schriftlich';

export type AppUser = Database['public']['Tables']['app_users']['Row'];
export type Auftraggeber = Database['public']['Tables']['auftraggeber']['Row'];
export type AuftraggeberKontakt = Database['public']['Tables']['auftraggeber_kontakte']['Row'];
export type Preisstufe = Database['public']['Tables']['preisstufen']['Row'];
export type Sonderverguetung = Database['public']['Tables']['sonderverguetungen']['Row'];
export type Rechnung = Database['public']['Tables']['rechnungen']['Row'];
export type RechnungStatus = Rechnung['status'];
export type Rechnungsposition = Database['public']['Tables']['rechnungspositionen']['Row'];
export type Rechnungsadresse = Database['public']['Tables']['rechnungsadressen']['Row'];

// ---- Touren -----------------------------------------------

/** Kontakt-Daten pro Adresse (kontakt_start / _ziel / _rueckfuehrung). */
export interface KontaktVorOrt {
  name?: string;
  telefon?: string;
  email?: string;
}

export type Tour = Database['public']['Tables']['touren']['Row'];
export type TourZusatz = Database['public']['Tables']['tour_zusaetze']['Row'];
export type GreimelZugang = Database['public']['Tables']['greimel_zugaenge']['Row'];
export type EmailFavorit = Database['public']['Tables']['email_favoriten']['Row'];
export type Fahrer = Database['public']['Tables']['fahrer']['Row'];

// ---- Templates: schema und pdfs sind in der DB jsonb.
// Wir casten im Frontend auf spezifische Strukturen.

export type FieldType =
  | 'text' | 'number' | 'date' | 'select' | 'checkboxes'
  | 'textarea' | 'photo' | 'signature' | 'damage_diagram'
  | 'dynamic_photos' | 'checkboxes_with_text'
  | 'address';

/** Sub-Felder eines `address`-Feldes — werden im PDF-Mapping einzeln
 *  positioniert (Schlüssel `<fieldId>.strasse` / `.plz` / `.stadt`). */
export type AddressSubField = 'strasse' | 'plz' | 'stadt';
export const ADDRESS_SUBFIELDS: AddressSubField[] = ['strasse', 'plz', 'stadt'];
export const ADDRESS_LABEL: Record<AddressSubField, string> = {
  strasse: 'Straße',
  plz: 'PLZ',
  stadt: 'Stadt',
};

export interface AddressValue {
  strasse?: string;
  plz?: string;
  stadt?: string;
}

export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  vehicleImage?: string;
  /**
   * Nur für type='date': wenn false → reines Datum (kein Uhrzeit-
   * Input, kein "Jetzt"-Button). Default = true (= Datum + Uhrzeit),
   * damit bestehende Templates ihr aktuelles Verhalten behalten.
   */
  includeTime?: boolean;
}

export interface FormSection {
  id: string;
  title: string;
  fields: FormField[];
}

export interface FormPage {
  id: string;
  title: string;
  sectionIds: string[];
}

export interface FormSchema {
  sections: FormSection[];
  /** Optional: Seiten-Aufteilung. Wenn leer/fehlend, sind alle Sections auf einer Seite. */
  pages?: FormPage[];
}

// ---- Field-Mapping (PDF-Positionen) — discriminated union nach `type`.
//
// text/number/date/textarea  → ein Punkt + optional Schriftgröße
// photo/signature/damage_diagram → ein Punkt + Bounding-Box
// checkboxes/select → pro Option ein Punkt (für Häkchen)
// dynamic_photos → ein Slot-Layout (Startposition + Grid + Anzahl pro Seite)

export interface OptionPosition {
  page: number;
  x: number;
  y: number;
  size?: number; // Häkchen-Größe in PDF-Punkten (Default 12)
}

export type TextEntry = {
  type: 'text' | 'number' | 'date' | 'textarea';
  page: number;
  x: number;
  y: number;
  fontSize?: number;
  /** Maximale Breite in PDF-Punkten, in die der Text passen muss. Wird
   *  überschritten: Schrift verkleinert sich automatisch (bis 7 pt),
   *  dann wird umbrochen (max. 3 Zeilen). Ohne maxWidth verhält sich
   *  das Mapping wie früher (rechtsbündig, einzeilig, kein Schrumpfen). */
  maxWidth?: number;
};

export type BoxEntry = {
  type: 'photo' | 'signature' | 'damage_diagram';
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OptionsEntry = {
  type: 'checkboxes' | 'select';
  options: Record<string, OptionPosition>;
};

export type DynamicPhotosEntry = {
  type: 'dynamic_photos';
  page: number;        // Startseite
  x: number;           // x des ersten Slots (links unten)
  y: number;           // y des oberen Rands des ersten Slots
  width: number;       // Slot-Breite
  height: number;      // Slot-Höhe
  columns: number;     // Anzahl Slots pro Reihe
  perPage: number;     // Maximale Slots pro Seite
  rowGap?: number;     // Vertikaler Abstand zwischen Reihen (Default 12)
  colGap?: number;     // Horizontaler Abstand zwischen Spalten (Default 12)
};

// Mehrfachauswahl-Optionen mit zugehörigem Freitext: pro Option zwei Positionen
// — eine fürs Häkchen, eine für den eingegebenen Text.
export type CheckboxesWithTextEntry = {
  type: 'checkboxes_with_text';
  options: Record<string, {
    checkbox: { page: number; x: number; y: number; size?: number };
    text:     { page: number; x: number; y: number; fontSize?: number };
  }>;
};

export type FieldMappingEntry =
  | TextEntry | BoxEntry | OptionsEntry | DynamicPhotosEntry | CheckboxesWithTextEntry;

export type FieldMapping = Record<string, FieldMappingEntry>;

// ---- Mehrere PDFs pro Template -----------------------------

export interface TemplatePdf {
  id: string;        // stable, z.B. "protokoll", "fotos", "belege"
  name: string;      // user-facing Name
  path: string | null; // Storage-Pfad in Bucket pdf-templates (oder null)
  field_mapping: FieldMapping;
  /**
   * Optional: Muster für den Download-Dateinamen.
   * Platzhalter `{feld_id}` werden durch die jeweiligen Werte aus dem
   * ausgefüllten Formular ersetzt. Beispiel: `Protokoll_{kennzeichen}`.
   * Sonderzeichen werden beim Auflösen durch Unterstriche ersetzt.
   */
  filename_pattern?: string | null;
}

export interface EmailConfig {
  // ---- Vorlage 3: Manuelle E-Mail (aus Eingänge) ----
  // Diese Felder werden im Eingänge-Dialog vorausgefüllt; der Admin wählt
  // die Empfänger dort selbst.
  to?: string;               // historisch — Kompatibilität für alte Templates
  cc?: string;
  subject_pattern?: string;
  body_pattern?: string;
  attach_pdf_ids?: string[];
  /** Absende-Postfach (UPN) für die manuelle E-Mail. */
  from?: string;

  /** Vorlage 1: Bestätigungs-E-Mail bei Formularabschluss. */
  confirmation?: {
    enabled: boolean;
    recipient_self: boolean;   // an den eingeloggten Fahrer (CC)
    recipient_fahrer: boolean; // an die hinterlegte Fahrer-E-Mail
    recipient_extra: string;   // freie Zusatz-Empfänger (komma-separiert, Platzhalter erlaubt)
    from: string;              // Absende-Postfach
    subject: string;
    body: string;
    attach_pdf_ids?: string[]; // optional Anhänge
  };

  /** Vorlage 2: Schieberegler-E-Mail (Fahrer-gesteuerter Versand). */
  sliders?: {
    enabled: boolean;
    count: 1 | 2;
    labels: [string, string];  // [Label Schieberegler 1, Label Schieberegler 2]
    from: string;              // Absende-Postfach
    subject: string;
    body: string;
    attach_pdf_ids?: string[]; // welche PDFs angehängt werden sollen
  };
}

/**
 * Ergebnis-Log eines automatisch versendeten E-Mail-Versuchs nach
 * Formularabschluss. Wird auf ausgefuellte_formulare.email_send_log
 * persistiert, damit der Admin in Eingänge nachvollziehen kann, ob
 * Bestätigungen / Schieberegler-Mails rausgingen.
 */
export interface EmailSendLogEntry {
  type: 'confirmation' | 'slider';
  /** Schieberegler-Index 0 oder 1 — nur bei type='slider'. */
  slider_index?: number;
  recipients: string[];
  sent_at: string;
  success: boolean;
  error?: string;
}

type TemplateRow = Database['public']['Tables']['formular_templates']['Row'];
export type FormularTemplate = Omit<TemplateRow, 'schema' | 'pdfs' | 'email_config'> & {
  schema: FormSchema;
  pdfs: TemplatePdf[];
  email_config: EmailConfig | null;
};

type AfRow = Database['public']['Tables']['ausgefuellte_formulare']['Row'];
export type AusgefuelltesFormular = Omit<AfRow, 'daten'> & {
  daten: Record<string, unknown>;
};

// Foto-Werte im daten-JSON.
// Nach erfolgreichem Upload: storage_path gesetzt.
// Offline / Upload-Queue: pending_id gesetzt — der Blob liegt in IDB.
export interface PhotoValue {
  storage_path?: string;
  pending_id?: string;
  mime_type?: string;
  size_bytes?: number;
}

// Damage-Diagram-Werte: Liste von Markern (x/y in Prozent)
//
// `kind` ist die Schadensart und wird auf dem Diagramm als einzelner
// Buchstabe gerendert (D=Delle, K=Kratzer, S=Steinschlag, U=Unfallschaden).
// Alte Markierungen ohne `kind` werden weiterhin akzeptiert (Fallback "?").
export type DamageKind = 'D' | 'K' | 'S' | 'U';

export const DAMAGE_KIND_LABEL: Record<DamageKind, string> = {
  D: 'Delle',
  K: 'Kratzer',
  S: 'Steinschlag',
  U: 'Unfallschaden',
};

export interface DamageMarker {
  x: number;
  y: number;
  kind?: DamageKind;
  note?: string;
}
