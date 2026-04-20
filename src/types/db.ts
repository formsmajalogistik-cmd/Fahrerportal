// Minimaler Typ-Schim für Supabase-Client. Kann später per `supabase gen types` ersetzt werden.

export type UserRole = 'admin' | 'fahrer';
export type FormularStatus = 'draft' | 'submitted';

export interface AppUser {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Auftraggeber {
  id: string;
  name: string;
  kuerzel: string | null;
  kontakt: string | null;
  notizen: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Fahrer {
  id: string;
  user_id: string | null;
  vorname: string;
  nachname: string;
  personalnummer: string | null;
  telefon: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
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
  align?: 'left' | 'center' | 'right';
}

export type FieldMapping = Record<string, FieldMappingEntry>;

export interface FormularTemplate {
  id: string;
  name: string;
  version: number;
  auftraggeber_id: string | null;
  beschreibung: string | null;
  schema_json: FormSchema;
  field_mapping: FieldMapping;
  pdf_template: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FormularZuweisung {
  id: string;
  fahrer_id: string;
  template_id: string;
  gueltig_ab: string | null;
  gueltig_bis: string | null;
  is_active: boolean;
  created_at: string;
}

export interface AusgefuelltesFormular {
  id: string;
  template_id: string;
  fahrer_id: string;
  status: FormularStatus;
  data_json: Record<string, unknown>;
  pdf_path: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Foto {
  id: string;
  formular_id: string;
  field_id: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
}

// Supabase Database-Schim
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
      fotos: Row<Foto>;
    };
    Views: Record<string, never>;
    Functions: { is_admin: { Args: Record<string, never>; Returns: boolean } };
    Enums: { user_role: UserRole; formular_status: FormularStatus };
  };
}
