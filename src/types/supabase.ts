// Supabase Database-Type im Format, das @supabase/supabase-js erwartet.
// Manuell gepflegt passend zu supabase/migrations/001_schema.sql.
// Kann später per `npx supabase gen types typescript --linked` regeneriert werden.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = 'admin' | 'fahrer';
export type FormularStatus = 'draft' | 'submitted';

export type Database = {
  public: {
    Tables: {
      app_users: {
        Row: {
          id: string;
          email: string;
          role: UserRole;
          vorname: string | null;
          nachname: string | null;
        };
        Insert: {
          id: string;
          email: string;
          role?: UserRole;
          vorname?: string | null;
          nachname?: string | null;
        };
        Update: {
          id?: string;
          email?: string;
          role?: UserRole;
          vorname?: string | null;
          nachname?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'app_users_id_fkey';
            columns: ['id'];
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      auftraggeber: {
        Row: {
          id: string;
          name: string;
          kontakt: string | null;
          strasse: string | null;
          plz: string | null;
          ort: string | null;
          email1: string | null;
          email2: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          kontakt?: string | null;
          strasse?: string | null;
          plz?: string | null;
          ort?: string | null;
          email1?: string | null;
          email2?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          kontakt?: string | null;
          strasse?: string | null;
          plz?: string | null;
          ort?: string | null;
          email1?: string | null;
          email2?: string | null;
        };
        Relationships: [];
      };
      fahrer: {
        Row: {
          id: string;
          user_id: string;
          aktiv: boolean;
        };
        Insert: {
          id?: string;
          user_id: string;
          aktiv?: boolean;
        };
        Update: {
          id?: string;
          user_id?: string;
          aktiv?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'fahrer_user_id_fkey';
            columns: ['user_id'];
            referencedRelation: 'app_users';
            referencedColumns: ['id'];
          },
        ];
      };
      formular_templates: {
        Row: {
          id: string;
          name: string;
          auftraggeber_id: string | null;
          schema: Json;
          pdfs: Json;
        };
        Insert: {
          id?: string;
          name: string;
          auftraggeber_id?: string | null;
          schema: Json;
          pdfs?: Json;
        };
        Update: {
          id?: string;
          name?: string;
          auftraggeber_id?: string | null;
          schema?: Json;
          pdfs?: Json;
        };
        Relationships: [
          {
            foreignKeyName: 'formular_templates_auftraggeber_id_fkey';
            columns: ['auftraggeber_id'];
            referencedRelation: 'auftraggeber';
            referencedColumns: ['id'];
          },
        ];
      };
      formular_zuweisungen: {
        Row: {
          id: string;
          fahrer_id: string;
          template_id: string;
        };
        Insert: {
          id?: string;
          fahrer_id: string;
          template_id: string;
        };
        Update: {
          id?: string;
          fahrer_id?: string;
          template_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'formular_zuweisungen_fahrer_id_fkey';
            columns: ['fahrer_id'];
            referencedRelation: 'fahrer';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'formular_zuweisungen_template_id_fkey';
            columns: ['template_id'];
            referencedRelation: 'formular_templates';
            referencedColumns: ['id'];
          },
        ];
      };
      ausgefuellte_formulare: {
        Row: {
          id: string;
          fahrer_id: string;
          template_id: string;
          daten: Json;
          status: FormularStatus;
          created_at: string;
        };
        Insert: {
          id?: string;
          fahrer_id: string;
          template_id: string;
          daten?: Json;
          status?: FormularStatus;
          created_at?: string;
        };
        Update: {
          id?: string;
          fahrer_id?: string;
          template_id?: string;
          daten?: Json;
          status?: FormularStatus;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ausgefuellte_formulare_fahrer_id_fkey';
            columns: ['fahrer_id'];
            referencedRelation: 'fahrer';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ausgefuellte_formulare_template_id_fkey';
            columns: ['template_id'];
            referencedRelation: 'formular_templates';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      is_admin: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
    };
    Enums: {
      user_role: UserRole;
      formular_status: FormularStatus;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
