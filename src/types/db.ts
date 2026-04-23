// Minimaler Typ-Schim für Supabase-Client (kann später per `supabase gen types`
// überschrieben werden).

export type UserRole = 'admin' | 'fahrer';
export type FormularStatus = 'draft' | 'submitted';

export interface AppUser {
  id: string;
  email: string;
  role: UserRole;
  vorname: string | null;
  nachname: string | null;
}

export interface Auftraggeber {
  id: string;
  name: string;
  kontakt: string | null;
}

export interface Fahrer {
  id: string;
  user_id: string;
  aktiv: boolean;
}

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

export interface FormularTemplate {
  id: string;
  name: string;
  auftraggeber_id: string | null;
  schema: FormSchema;
  pdf_template: string | null;
  field_mapping: FieldMapping;
}

export interface FormularZuweisung {
  id: string;
  fahrer_id: string;
  template_id: string;
}

export interface AusgefuelltesFormular {
  id: string;
  fahrer_id: string;
  template_id: string;
  daten: Record<string, unknown>;
  status: FormularStatus;
  created_at: string;
}

// Foto-Werte im daten-JSON: { storage_path, mime_type?, size_bytes? }
export interface PhotoValue {
  storage_path: string;
  mime_type?: string;
  size_bytes?: number;
}

// Damage-Diagram-Werte: Liste von Markern (x/y in Prozent des Referenzbilds)
export interface DamageMarker {
  x: number;
  y: number;
  note?: string;
}

type Row<T> = { Row: T; Insert: Partial<T>; Update: Partial<T> };

export interface Database {
  public: {
    Tables: {
      app_users: Row<AppUser>;
      auftraggeber: Row<Auftraggeber>;
      fahrer: Row<Fahrer>;
      formular_templates: Row<FormularTemplate>;
      formular_zuweisungen: Row<FormularZuweisung>;
      ausgefuellte_formulare: Row<AusgefuelltesFormular>;
    };
    Views: Record<string, never>;
    Functions: { is_admin: { Args: Record<string, never>; Returns: boolean } };
    Enums: { user_role: UserRole; formular_status: FormularStatus };
  };
}
