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
export type TourStatus = 'geplant' | 'aktiv' | 'abgeschlossen';
export type TourenArt = 'AB' | 'ABC' | 'ABA';
export type ProtokollArt = 'app' | 'schriftlich';

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
          save_to_gallery: boolean;
        };
        Insert: {
          id: string;
          email: string;
          role?: UserRole;
          vorname?: string | null;
          nachname?: string | null;
          save_to_gallery?: boolean;
        };
        Update: {
          id?: string;
          email?: string;
          role?: UserRole;
          vorname?: string | null;
          nachname?: string | null;
          save_to_gallery?: boolean;
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
          preisliste_pdf_url: string | null;
          aba_aufschlag_prozent: number | null;
          externe_app_name: string | null;
          externe_app_url: string | null;
          rechnungsformat: Json | null;
          kundennummer: string | null;
          sachbearbeiter: string | null;
          kunden_uid: string | null;
          zahlungsziel_tage: number | null;
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
          preisliste_pdf_url?: string | null;
          aba_aufschlag_prozent?: number | null;
          externe_app_name?: string | null;
          externe_app_url?: string | null;
          rechnungsformat?: Json | null;
          kundennummer?: string | null;
          sachbearbeiter?: string | null;
          kunden_uid?: string | null;
          zahlungsziel_tage?: number | null;
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
          preisliste_pdf_url?: string | null;
          aba_aufschlag_prozent?: number | null;
          externe_app_name?: string | null;
          externe_app_url?: string | null;
          rechnungsformat?: Json | null;
          kundennummer?: string | null;
          sachbearbeiter?: string | null;
          kunden_uid?: string | null;
          zahlungsziel_tage?: number | null;
        };
        Relationships: [];
      };
      rechnungsadressen: {
        Row: {
          id: string;
          auftraggeber_id: string;
          firma: string;
          ansprechpartner: string | null;
          strasse: string | null;
          plz_ort: string | null;
          land: string | null;
          ist_standard: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          auftraggeber_id: string;
          firma: string;
          ansprechpartner?: string | null;
          strasse?: string | null;
          plz_ort?: string | null;
          land?: string | null;
          ist_standard?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          auftraggeber_id?: string;
          firma?: string;
          ansprechpartner?: string | null;
          strasse?: string | null;
          plz_ort?: string | null;
          land?: string | null;
          ist_standard?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'rechnungsadressen_auftraggeber_id_fkey';
            columns: ['auftraggeber_id'];
            referencedRelation: 'auftraggeber';
            referencedColumns: ['id'];
          },
        ];
      };
      preisstufen: {
        Row: {
          id: string;
          auftraggeber_id: string;
          km_von: number;
          km_bis: number;
          preis: number;
          e_fahrzeug_aufschlag: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          auftraggeber_id: string;
          km_von: number;
          km_bis: number;
          preis?: number;
          e_fahrzeug_aufschlag?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          auftraggeber_id?: string;
          km_von?: number;
          km_bis?: number;
          preis?: number;
          e_fahrzeug_aufschlag?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'preisstufen_auftraggeber_id_fkey';
            columns: ['auftraggeber_id'];
            referencedRelation: 'auftraggeber';
            referencedColumns: ['id'];
          },
        ];
      };
      sonderverguetungen: {
        Row: {
          id: string;
          auftraggeber_id: string;
          bezeichnung: string;
          preis: number;
          einheit: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          auftraggeber_id: string;
          bezeichnung: string;
          preis?: number;
          einheit: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          auftraggeber_id?: string;
          bezeichnung?: string;
          preis?: number;
          einheit?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'sonderverguetungen_auftraggeber_id_fkey';
            columns: ['auftraggeber_id'];
            referencedRelation: 'auftraggeber';
            referencedColumns: ['id'];
          },
        ];
      };
      touren: {
        Row: {
          id: string;
          tour_id: string | null;
          start_stadt: string;
          ziel_stadt: string;
          rueckfuehrung_stadt: string | null;
          km_hin: number | null;
          km_rueck: number | null;
          km_gesamt: number | null;
          adresse_start: string | null;
          adresse_ziel: string | null;
          adresse_rueckfuehrung: string | null;
          kundenname: string | null;
          auftraggeber_id: string | null;
          fahrer_id: string | null;
          status: TourStatus;
          startdatum: string;
          enddatum: string;
          verguetung: number | null;
          tourenart: TourenArt | null;
          sondervereinbarung: string | null;
          ist_sondervereinbarung: boolean;
          kennzeichen: string[];
          barauslagen: number;
          fahrer_honorar: number;
          info: string | null;
          protokoll_art: ProtokollArt | null;
          schriftliches_protokoll_id: string | null;
          greimel_zugang_id: string | null;
          ist_e_fahrzeug: boolean;
          fin: string | null;
          kontakt_id: string | null;
          eingang_id: string | null;
          kontakt_start: Json | null;
          kontakt_ziel: Json | null;
          kontakt_rueckfuehrung: Json | null;
          app_notiz: string | null;
          protokoll_daten_felder: string[];
          rechnungsdatum_abweichend: boolean;
          rechnungsdatum: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tour_id?: string | null;
          start_stadt: string;
          ziel_stadt: string;
          rueckfuehrung_stadt?: string | null;
          km_hin?: number | null;
          km_rueck?: number | null;
          km_gesamt?: number | null;
          adresse_start?: string | null;
          adresse_ziel?: string | null;
          adresse_rueckfuehrung?: string | null;
          kundenname?: string | null;
          auftraggeber_id?: string | null;
          fahrer_id?: string | null;
          status?: TourStatus;
          startdatum: string;
          enddatum: string;
          verguetung?: number | null;
          tourenart?: TourenArt | null;
          sondervereinbarung?: string | null;
          ist_sondervereinbarung?: boolean;
          kennzeichen?: string[];
          barauslagen?: number;
          fahrer_honorar?: number;
          info?: string | null;
          protokoll_art?: ProtokollArt | null;
          schriftliches_protokoll_id?: string | null;
          greimel_zugang_id?: string | null;
          ist_e_fahrzeug?: boolean;
          fin?: string | null;
          kontakt_id?: string | null;
          eingang_id?: string | null;
          kontakt_start?: Json | null;
          kontakt_ziel?: Json | null;
          kontakt_rueckfuehrung?: Json | null;
          app_notiz?: string | null;
          protokoll_daten_felder?: string[];
          rechnungsdatum_abweichend?: boolean;
          rechnungsdatum?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tour_id?: string | null;
          start_stadt?: string;
          ziel_stadt?: string;
          rueckfuehrung_stadt?: string | null;
          km_hin?: number | null;
          km_rueck?: number | null;
          km_gesamt?: number | null;
          adresse_start?: string | null;
          adresse_ziel?: string | null;
          adresse_rueckfuehrung?: string | null;
          kundenname?: string | null;
          auftraggeber_id?: string | null;
          fahrer_id?: string | null;
          status?: TourStatus;
          startdatum?: string;
          enddatum?: string;
          verguetung?: number | null;
          tourenart?: TourenArt | null;
          sondervereinbarung?: string | null;
          ist_sondervereinbarung?: boolean;
          kennzeichen?: string[];
          barauslagen?: number;
          fahrer_honorar?: number;
          info?: string | null;
          protokoll_art?: ProtokollArt | null;
          schriftliches_protokoll_id?: string | null;
          greimel_zugang_id?: string | null;
          ist_e_fahrzeug?: boolean;
          fin?: string | null;
          kontakt_id?: string | null;
          eingang_id?: string | null;
          kontakt_start?: Json | null;
          kontakt_ziel?: Json | null;
          kontakt_rueckfuehrung?: Json | null;
          app_notiz?: string | null;
          protokoll_daten_felder?: string[];
          rechnungsdatum_abweichend?: boolean;
          rechnungsdatum?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'touren_auftraggeber_id_fkey';
            columns: ['auftraggeber_id'];
            referencedRelation: 'auftraggeber';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'touren_fahrer_id_fkey';
            columns: ['fahrer_id'];
            referencedRelation: 'fahrer';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'touren_kontakt_id_fkey';
            columns: ['kontakt_id'];
            referencedRelation: 'auftraggeber_kontakte';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'touren_eingang_id_fkey';
            columns: ['eingang_id'];
            referencedRelation: 'ausgefuellte_formulare';
            referencedColumns: ['id'];
          },
        ];
      };
      auftraggeber_kontakte: {
        Row: {
          id: string;
          auftraggeber_id: string;
          name: string;
          telefon: string | null;
          email: string | null;
          position: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          auftraggeber_id: string;
          name: string;
          telefon?: string | null;
          email?: string | null;
          position?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          auftraggeber_id?: string;
          name?: string;
          telefon?: string | null;
          email?: string | null;
          position?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'auftraggeber_kontakte_auftraggeber_id_fkey';
            columns: ['auftraggeber_id'];
            referencedRelation: 'auftraggeber';
            referencedColumns: ['id'];
          },
        ];
      };
      greimel_zugaenge: {
        Row: {
          id: string;
          titel: string;
          benutzername: string;
          passwort: string;
          link: string | null;
          fahrer_ids: string[];
          sichtbar_fuer_alle: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          titel: string;
          benutzername: string;
          passwort: string;
          link?: string | null;
          fahrer_ids?: string[];
          sichtbar_fuer_alle?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          titel?: string;
          benutzername?: string;
          passwort?: string;
          link?: string | null;
          fahrer_ids?: string[];
          sichtbar_fuer_alle?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tour_zusaetze: {
        Row: {
          id: string;
          tour_id: string;
          kategorie: string;
          anzahl: number;
          betrag: number;
          notiz: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tour_id: string;
          kategorie: string;
          anzahl?: number;
          betrag: number;
          notiz?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tour_id?: string;
          kategorie?: string;
          anzahl?: number;
          betrag?: number;
          notiz?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tour_zusaetze_tour_id_fkey';
            columns: ['tour_id'];
            referencedRelation: 'touren';
            referencedColumns: ['id'];
          },
        ];
      };
      fahrer: {
        Row: {
          id: string;
          user_id: string;
          aktiv: boolean;
          vorname: string | null;
          nachname: string | null;
          haupt_user_id: string | null;
          ist_unterkonto: boolean;
        };
        Insert: {
          id?: string;
          user_id: string;
          aktiv?: boolean;
          vorname?: string | null;
          nachname?: string | null;
          haupt_user_id?: string | null;
          ist_unterkonto?: boolean;
        };
        Update: {
          id?: string;
          user_id?: string;
          aktiv?: boolean;
          vorname?: string | null;
          nachname?: string | null;
          haupt_user_id?: string | null;
          ist_unterkonto?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'fahrer_user_id_fkey';
            columns: ['user_id'];
            referencedRelation: 'app_users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'fahrer_haupt_user_id_fkey';
            columns: ['haupt_user_id'];
            referencedRelation: 'fahrer';
            referencedColumns: ['id'];
          },
        ];
      };
      formular_templates: {
        Row: {
          id: string;
          name: string;
          schema: Json;
          pdfs: Json;
          email_config: Json | null;
          sichtbar: boolean;
        };
        Insert: {
          id?: string;
          name: string;
          schema: Json;
          pdfs?: Json;
          email_config?: Json | null;
          sichtbar?: boolean;
        };
        Update: {
          id?: string;
          name?: string;
          schema?: Json;
          pdfs?: Json;
          email_config?: Json | null;
          sichtbar?: boolean;
        };
        Relationships: [];
      };
      ausgefuellte_formulare: {
        Row: {
          id: string;
          fahrer_id: string;
          template_id: string;
          daten: Json;
          status: FormularStatus;
          created_at: string;
          gesehen_am: string | null;
          zwischenprotokoll_url: string | null;
          zwischenprotokoll_erstellt_am: string | null;
        };
        Insert: {
          id?: string;
          fahrer_id: string;
          template_id: string;
          daten?: Json;
          status?: FormularStatus;
          created_at?: string;
          gesehen_am?: string | null;
          zwischenprotokoll_url?: string | null;
          zwischenprotokoll_erstellt_am?: string | null;
        };
        Update: {
          id?: string;
          fahrer_id?: string;
          template_id?: string;
          daten?: Json;
          status?: FormularStatus;
          created_at?: string;
          gesehen_am?: string | null;
          zwischenprotokoll_url?: string | null;
          zwischenprotokoll_erstellt_am?: string | null;
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
      calculate_tour_price: {
        Args: {
          p_auftraggeber_id: string | null;
          p_km: number | null;
          p_tourenart?: string | null;
          p_ist_e_fahrzeug?: boolean | null;
        };
        Returns: number | null;
      };
      update_my_profile: {
        Args: {
          p_vorname: string | null;
          p_nachname: string | null;
          p_save_to_gallery: boolean;
        };
        Returns: void;
      };
      release_completed_greimel_zugaenge: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      expand_fahrer_with_subaccounts: {
        Args: { p_ids: string[] };
        Returns: string[];
      };
    };
    Enums: {
      user_role: UserRole;
      formular_status: FormularStatus;
      tour_status: TourStatus;
      tourenart: TourenArt;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
