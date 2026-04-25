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

// ---- Templates: schema & field_mapping sind in der DB jsonb.
// Wir casten im Frontend auf spezifische Strukturen.

export type FieldType =
  | 'text' | 'number' | 'date' | 'select' | 'checkboxes'
  | 'textarea' | 'photo' | 'signature' | 'damage_diagram';

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

// ---- Field-Mapping (PDF-Positionen)
//
// Drei Mapping-Modi je nach Feldtyp:
//
//   text   — text/number/date/textarea: ein Punkt + optional Schriftgröße
//   box    — photo/signature/damage_diagram: ein Punkt + Bounding-Box
//   options — checkboxes/select: pro Option ein Punkt (für Häkchen)
//
// Beispiel:
//   {
//     "fahrzeugtyp": { "type": "text", "page": 1, "x": 120, "y": 680 },
//     "foto_front":  { "type": "photo", "page": 2, "x": 50, "y": 500, "width": 240, "height": 180 },
//     "zubehoer":    {
//       "type": "checkboxes",
//       "options": {
//         "Fahrzeugschein": { "page": 1, "x": 50, "y": 400 },
//         "Tire Fit":       { "page": 1, "x": 200, "y": 400 }
//       }
//     }
//   }

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

export type FieldMappingEntry = TextEntry | BoxEntry | OptionsEntry;

export type FieldMapping = Record<string, FieldMappingEntry>;

type TemplateRow = Database['public']['Tables']['formular_templates']['Row'];
export type FormularTemplate = Omit<TemplateRow, 'schema' | 'field_mapping'> & {
  schema: FormSchema;
  field_mapping: FieldMapping;
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
