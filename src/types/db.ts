// Domain-Typen für das Frontend — dünne Wrapper über das Supabase-Row-Schema.
// Das eigentliche Database-Schema liegt in ./supabase.ts.

import type { Database } from './supabase';

export type UserRole = Database['public']['Enums']['user_role'];
export type FormularStatus = Database['public']['Enums']['formular_status'];

export type AppUser = Database['public']['Tables']['app_users']['Row'];
export type Auftraggeber = Database['public']['Tables']['auftraggeber']['Row'];
export type Fahrer = Database['public']['Tables']['fahrer']['Row'];
export type FormularZuweisung =
  Database['public']['Tables']['formular_zuweisungen']['Row'];

// ---- Templates: schema und pdfs sind in der DB jsonb.
// Wir casten im Frontend auf spezifische Strukturen.

export type FieldType =
  | 'text' | 'number' | 'date' | 'select' | 'checkboxes'
  | 'textarea' | 'photo' | 'signature' | 'damage_diagram'
  | 'dynamic_photos';

export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  vehicleImage?: string;
}

export interface FormSection {
  id: string;
  title: string;
  fields: FormField[];
}

export interface FormSchema {
  sections: FormSection[];
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

export type FieldMappingEntry =
  | TextEntry | BoxEntry | OptionsEntry | DynamicPhotosEntry;

export type FieldMapping = Record<string, FieldMappingEntry>;

// ---- Mehrere PDFs pro Template -----------------------------

export interface TemplatePdf {
  id: string;        // stable, z.B. "protokoll", "fotos", "belege"
  name: string;      // user-facing Name
  path: string | null; // Storage-Pfad in Bucket pdf-templates (oder null)
  field_mapping: FieldMapping;
}

type TemplateRow = Database['public']['Tables']['formular_templates']['Row'];
export type FormularTemplate = Omit<TemplateRow, 'schema' | 'pdfs'> & {
  schema: FormSchema;
  pdfs: TemplatePdf[];
};

type AfRow = Database['public']['Tables']['ausgefuellte_formulare']['Row'];
export type AusgefuelltesFormular = Omit<AfRow, 'daten'> & {
  daten: Record<string, unknown>;
};

// Foto-Werte im daten-JSON: { storage_path, mime_type?, size_bytes? }
export interface PhotoValue {
  storage_path: string;
  mime_type?: string;
  size_bytes?: number;
}

// Damage-Diagram-Werte: Liste von Markern (x/y in Prozent)
export interface DamageMarker {
  x: number;
  y: number;
  note?: string;
}
