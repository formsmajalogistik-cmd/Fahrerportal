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

export interface FieldMappingEntry {
  page: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  fontSize?: number;
}

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
