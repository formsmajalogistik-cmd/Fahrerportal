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

export type UserRole = 'admin' | 'fahrer' | 'auftraggeber' | 'test';
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
          telefon: string | null;
          position: string | null;
          auftraggeber_id: string | null;
        };
        Insert: {
          id: string;
          email: string;
          role?: UserRole;
          vorname?: string | null;
          nachname?: string | null;
          telefon?: string | null;
          position?: string | null;
          auftraggeber_id?: string | null;
        };
        Update: {
          id?: string;
          email?: string;
          role?: UserRole;
          vorname?: string | null;
          nachname?: string | null;
          telefon?: string | null;
          position?: string | null;
          auftraggeber_id?: string | null;
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
          fin_rueck: string | null;
          abgelehnt: boolean;
          ablehnungsgrund: string | null;
          abgelehnt_am: string | null;
          ablehnung_bestaetigt_am: string | null;
          zurueckgestellt: boolean;
          zurueckgestellt_am: string | null;
          kontakt_id: string | null;
          eingang_id: string | null;
          eingang_id_bc: string | null;
          kontakt_start: Json | null;
          kontakt_ziel: Json | null;
          kontakt_rueckfuehrung: Json | null;
          app_notiz: string | null;
          protokoll_daten_felder: string[];
          protokoll_daten_felder_bc: string[];
          rechnungsdatum_abweichend: boolean;
          rechnungsdatum: string | null;
          bearbeitet_markiert_am: string | null;
          bestaetigt: boolean;
          erstellt_von: string | null;
          erstellt_von_rolle: string | null;
          created_at: string;
          updated_at: string;
          vorgefuellte_daten: Json | null;
          fahrzeugmodell: string | null;
          abholzeit: string | null;
          abgabezeit: string | null;
          rueckfuehrung_zeit: string | null;
          zeit_hinweis_start: string | null;
          zeit_hinweis_ziel: string | null;
          zeit_hinweis_rueckfuehrung: string | null;
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
          fin_rueck?: string | null;
          abgelehnt?: boolean;
          ablehnungsgrund?: string | null;
          abgelehnt_am?: string | null;
          ablehnung_bestaetigt_am?: string | null;
          zurueckgestellt?: boolean;
          zurueckgestellt_am?: string | null;
          kontakt_id?: string | null;
          eingang_id?: string | null;
          eingang_id_bc?: string | null;
          kontakt_start?: Json | null;
          kontakt_ziel?: Json | null;
          kontakt_rueckfuehrung?: Json | null;
          app_notiz?: string | null;
          protokoll_daten_felder?: string[];
          protokoll_daten_felder_bc?: string[];
          rechnungsdatum_abweichend?: boolean;
          rechnungsdatum?: string | null;
          bearbeitet_markiert_am?: string | null;
          bestaetigt?: boolean;
          erstellt_von?: string | null;
          erstellt_von_rolle?: string | null;
          created_at?: string;
          updated_at?: string;
          vorgefuellte_daten?: Json | null;
          fahrzeugmodell?: string | null;
          abholzeit?: string | null;
          abgabezeit?: string | null;
          rueckfuehrung_zeit?: string | null;
          zeit_hinweis_start?: string | null;
          zeit_hinweis_ziel?: string | null;
          zeit_hinweis_rueckfuehrung?: string | null;
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
          fin_rueck?: string | null;
          abgelehnt?: boolean;
          ablehnungsgrund?: string | null;
          abgelehnt_am?: string | null;
          ablehnung_bestaetigt_am?: string | null;
          zurueckgestellt?: boolean;
          zurueckgestellt_am?: string | null;
          kontakt_id?: string | null;
          eingang_id?: string | null;
          eingang_id_bc?: string | null;
          kontakt_start?: Json | null;
          kontakt_ziel?: Json | null;
          kontakt_rueckfuehrung?: Json | null;
          app_notiz?: string | null;
          protokoll_daten_felder?: string[];
          protokoll_daten_felder_bc?: string[];
          rechnungsdatum_abweichend?: boolean;
          rechnungsdatum?: string | null;
          bearbeitet_markiert_am?: string | null;
          bestaetigt?: boolean;
          erstellt_von?: string | null;
          erstellt_von_rolle?: string | null;
          created_at?: string;
          updated_at?: string;
          vorgefuellte_daten?: Json | null;
          fahrzeugmodell?: string | null;
          abholzeit?: string | null;
          abgabezeit?: string | null;
          rueckfuehrung_zeit?: string | null;
          zeit_hinweis_start?: string | null;
          zeit_hinweis_ziel?: string | null;
          zeit_hinweis_rueckfuehrung?: string | null;
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
          {
            foreignKeyName: 'touren_eingang_id_bc_fkey';
            columns: ['eingang_id_bc'];
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
      email_favoriten: {
        Row: {
          id: string;
          email: string;
          name: string | null;
          ist_favorit: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          name?: string | null;
          ist_favorit?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          name?: string | null;
          ist_favorit?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      fuehrerschein_abfragen: {
        Row: {
          id: string;
          gestartet_von: string | null;
          gestartet_am: string;
          status: 'offen' | 'abgeschlossen';
          notiz: string | null;
        };
        Insert: {
          id?: string;
          gestartet_von?: string | null;
          gestartet_am?: string;
          status?: 'offen' | 'abgeschlossen';
          notiz?: string | null;
        };
        Update: {
          id?: string;
          gestartet_von?: string | null;
          gestartet_am?: string;
          status?: 'offen' | 'abgeschlossen';
          notiz?: string | null;
        };
        Relationships: [];
      };
      fuehrerschein_einreichungen: {
        Row: {
          id: string;
          abfrage_id: string;
          fahrer_id: string;
          name_eingetragen: string | null;
          bild_vorderseite_pfad: string | null;
          bild_rueckseite_pfad: string | null;
          eingereicht_am: string;
          geprueft: boolean;
          geprueft_am: string | null;
          geprueft_von: string | null;
          vorderseite_aufgenommen_am: string | null;
          rueckseite_aufgenommen_am: string | null;
          manuell_erledigt: boolean;
          manuell_grund: string | null;
        };
        Insert: {
          id?: string;
          abfrage_id: string;
          fahrer_id: string;
          name_eingetragen?: string | null;
          bild_vorderseite_pfad?: string | null;
          bild_rueckseite_pfad?: string | null;
          eingereicht_am?: string;
          geprueft?: boolean;
          geprueft_am?: string | null;
          geprueft_von?: string | null;
          vorderseite_aufgenommen_am?: string | null;
          rueckseite_aufgenommen_am?: string | null;
          manuell_erledigt?: boolean;
          manuell_grund?: string | null;
        };
        Update: {
          id?: string;
          abfrage_id?: string;
          fahrer_id?: string;
          name_eingetragen?: string | null;
          bild_vorderseite_pfad?: string | null;
          bild_rueckseite_pfad?: string | null;
          eingereicht_am?: string;
          geprueft?: boolean;
          geprueft_am?: string | null;
          geprueft_von?: string | null;
          vorderseite_aufgenommen_am?: string | null;
          rueckseite_aufgenommen_am?: string | null;
          manuell_erledigt?: boolean;
          manuell_grund?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'fuehrerschein_einreichungen_abfrage_id_fkey';
            columns: ['abfrage_id'];
            referencedRelation: 'fuehrerschein_abfragen';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'fuehrerschein_einreichungen_fahrer_id_fkey';
            columns: ['fahrer_id'];
            referencedRelation: 'fahrer';
            referencedColumns: ['id'];
          },
        ];
      };
      template_auftraggeber_freigaben: {
        Row: {
          template_id: string;
          auftraggeber_id: string;
          created_at: string;
        };
        Insert: {
          template_id: string;
          auftraggeber_id: string;
          created_at?: string;
        };
        Update: {
          template_id?: string;
          auftraggeber_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'template_auftraggeber_freigaben_template_id_fkey';
            columns: ['template_id'];
            referencedRelation: 'formular_templates';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'template_auftraggeber_freigaben_auftraggeber_id_fkey';
            columns: ['auftraggeber_id'];
            referencedRelation: 'auftraggeber';
            referencedColumns: ['id'];
          },
        ];
      };
      formular_wuensche: {
        Row: {
          id: string;
          auftraggeber_id: string;
          eingereicht_von: string | null;
          pdf_url: string;
          notiz: string | null;
          status: 'offen' | 'erledigt';
          created_at: string;
        };
        Insert: {
          id?: string;
          auftraggeber_id: string;
          eingereicht_von?: string | null;
          pdf_url: string;
          notiz?: string | null;
          status?: 'offen' | 'erledigt';
          created_at?: string;
        };
        Update: {
          id?: string;
          auftraggeber_id?: string;
          eingereicht_von?: string | null;
          pdf_url?: string;
          notiz?: string | null;
          status?: 'offen' | 'erledigt';
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'formular_wuensche_auftraggeber_id_fkey';
            columns: ['auftraggeber_id'];
            referencedRelation: 'auftraggeber';
            referencedColumns: ['id'];
          },
        ];
      };
      routen_cache: {
        Row: {
          id: string;
          origin_norm: string;
          destination_norm: string;
          routes: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          origin_norm: string;
          destination_norm: string;
          routes: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          origin_norm?: string;
          destination_norm?: string;
          routes?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      app_settings: {
        Row: {
          key: string;
          value: Json;
          updated_at: string;
        };
        Insert: {
          key: string;
          value: Json;
          updated_at?: string;
        };
        Update: {
          key?: string;
          value?: Json;
          updated_at?: string;
        };
        Relationships: [];
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
          kennzeichen: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tour_id: string;
          kategorie: string;
          anzahl?: number;
          betrag: number;
          notiz?: string | null;
          kennzeichen?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tour_id?: string;
          kategorie?: string;
          anzahl?: number;
          betrag?: number;
          notiz?: string | null;
          kennzeichen?: string | null;
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
      tour_protokoll_zuweisungen: {
        Row: {
          id: string;
          tour_id: string;
          template_id: string;
          vorgefuellte_daten: Json | null;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          tour_id: string;
          template_id: string;
          vorgefuellte_daten?: Json | null;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          tour_id?: string;
          template_id?: string;
          vorgefuellte_daten?: Json | null;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tour_protokoll_zuweisungen_tour_id_fkey';
            columns: ['tour_id'];
            referencedRelation: 'touren';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tour_protokoll_zuweisungen_template_id_fkey';
            columns: ['template_id'];
            referencedRelation: 'formular_templates';
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
          fs_ausgenommen: boolean;
        };
        Insert: {
          id?: string;
          user_id: string;
          aktiv?: boolean;
          vorname?: string | null;
          nachname?: string | null;
          haupt_user_id?: string | null;
          ist_unterkonto?: boolean;
          fs_ausgenommen?: boolean;
        };
        Update: {
          id?: string;
          user_id?: string;
          aktiv?: boolean;
          vorname?: string | null;
          nachname?: string | null;
          haupt_user_id?: string | null;
          ist_unterkonto?: boolean;
          fs_ausgenommen?: boolean;
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
          ist_einmalig: boolean;
          archiviert: boolean;
          archiviert_am: string | null;
          pdfs_zusammenfuehren: boolean;
        };
        Insert: {
          id?: string;
          name: string;
          schema: Json;
          pdfs?: Json;
          email_config?: Json | null;
          sichtbar?: boolean;
          ist_einmalig?: boolean;
          archiviert?: boolean;
          archiviert_am?: string | null;
          pdfs_zusammenfuehren?: boolean;
        };
        Update: {
          id?: string;
          name?: string;
          schema?: Json;
          pdfs?: Json;
          email_config?: Json | null;
          sichtbar?: boolean;
          ist_einmalig?: boolean;
          archiviert?: boolean;
          archiviert_am?: string | null;
          pdfs_zusammenfuehren?: boolean;
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
          pdf_paths: Json;
          pdf_status: string | null;
          pdf_fehler: string | null;
          email_send_log: Json;
          email_versendet_am: string | null;
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
          pdf_paths?: Json;
          pdf_status?: string | null;
          pdf_fehler?: string | null;
          email_send_log?: Json;
          email_versendet_am?: string | null;
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
          pdf_paths?: Json;
          pdf_status?: string | null;
          pdf_fehler?: string | null;
          email_send_log?: Json;
          email_versendet_am?: string | null;
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
      rechnungen: {
        Row: {
          id: string;
          rechnungsnummer: string;
          auftraggeber_id: string;
          rechnungsadresse_id: string | null;
          datum: string;
          leistungszeitraum_von: string;
          leistungszeitraum_bis: string;
          anrede: string | null;
          netto_summe: number;
          ust_satz: number;
          ust_betrag: number;
          brutto_summe: number;
          status: 'entwurf' | 'offen' | 'bezahlt';
          bezahlt_am: string | null;
          pdf_url: string | null;
          belege_pdf_url: string | null;
          email_versendet_am: string | null;
          notizen: string | null;
          ist_auslagen_rechnung: boolean;
          ansprechpartner: string | null;
          sachbearbeiter: string | null;
          kundennummer: string | null;
          rechnungsadresse_firma: string | null;
          rechnungsadresse_strasse: string | null;
          rechnungsadresse_plz_ort: string | null;
          rechnungsadresse_land: string | null;
          rechnungsempfaenger_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          rechnungsnummer?: string;
          auftraggeber_id: string;
          rechnungsadresse_id?: string | null;
          datum?: string;
          leistungszeitraum_von: string;
          leistungszeitraum_bis: string;
          anrede?: string | null;
          netto_summe?: number;
          ust_satz?: number;
          ust_betrag?: number;
          brutto_summe?: number;
          status?: 'entwurf' | 'offen' | 'bezahlt';
          bezahlt_am?: string | null;
          pdf_url?: string | null;
          belege_pdf_url?: string | null;
          email_versendet_am?: string | null;
          notizen?: string | null;
          ist_auslagen_rechnung?: boolean;
          ansprechpartner?: string | null;
          sachbearbeiter?: string | null;
          kundennummer?: string | null;
          rechnungsadresse_firma?: string | null;
          rechnungsadresse_strasse?: string | null;
          rechnungsadresse_plz_ort?: string | null;
          rechnungsadresse_land?: string | null;
          rechnungsempfaenger_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          rechnungsnummer?: string;
          auftraggeber_id?: string;
          rechnungsadresse_id?: string | null;
          datum?: string;
          leistungszeitraum_von?: string;
          leistungszeitraum_bis?: string;
          anrede?: string | null;
          netto_summe?: number;
          ust_satz?: number;
          ust_betrag?: number;
          brutto_summe?: number;
          status?: 'entwurf' | 'offen' | 'bezahlt';
          bezahlt_am?: string | null;
          pdf_url?: string | null;
          belege_pdf_url?: string | null;
          email_versendet_am?: string | null;
          notizen?: string | null;
          ist_auslagen_rechnung?: boolean;
          ansprechpartner?: string | null;
          sachbearbeiter?: string | null;
          kundennummer?: string | null;
          rechnungsadresse_firma?: string | null;
          rechnungsadresse_strasse?: string | null;
          rechnungsadresse_plz_ort?: string | null;
          rechnungsadresse_land?: string | null;
          rechnungsempfaenger_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'rechnungen_auftraggeber_id_fkey';
            columns: ['auftraggeber_id'];
            referencedRelation: 'auftraggeber';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rechnungen_rechnungsadresse_id_fkey';
            columns: ['rechnungsadresse_id'];
            referencedRelation: 'rechnungsadressen';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rechnungen_rechnungsempfaenger_id_fkey';
            columns: ['rechnungsempfaenger_id'];
            referencedRelation: 'auftraggeber_kontakte';
            referencedColumns: ['id'];
          },
        ];
      };
      rechnungspositionen: {
        Row: {
          id: string;
          rechnung_id: string;
          position_nr: number;
          bezeichnung: string;
          unterzeilen: string[];
          menge: number;
          einzelpreis: number;
          gesamtpreis: number;
          tour_id: string | null;
          zusatz_id: string | null;
          ist_manuell: boolean;
          ust_satz: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          rechnung_id: string;
          position_nr: number;
          bezeichnung: string;
          unterzeilen?: string[];
          menge?: number;
          einzelpreis: number;
          gesamtpreis: number;
          tour_id?: string | null;
          zusatz_id?: string | null;
          ist_manuell?: boolean;
          ust_satz?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          rechnung_id?: string;
          position_nr?: number;
          bezeichnung?: string;
          unterzeilen?: string[];
          menge?: number;
          einzelpreis?: number;
          gesamtpreis?: number;
          tour_id?: string | null;
          zusatz_id?: string | null;
          ist_manuell?: boolean;
          ust_satz?: number | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'rechnungspositionen_rechnung_id_fkey';
            columns: ['rechnung_id'];
            referencedRelation: 'rechnungen';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rechnungspositionen_tour_id_fkey';
            columns: ['tour_id'];
            referencedRelation: 'touren';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rechnungspositionen_zusatz_id_fkey';
            columns: ['zusatz_id'];
            referencedRelation: 'tour_zusaetze';
            referencedColumns: ['id'];
          },
        ];
      };
      tour_dokumente: {
        Row: {
          id: string;
          tour_id: string;
          bezeichnung: string | null;
          onedrive_path: string;
          dateiname: string;
          content_type: string | null;
          hochgeladen_von: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tour_id: string;
          bezeichnung?: string | null;
          onedrive_path: string;
          dateiname: string;
          content_type?: string | null;
          hochgeladen_von?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tour_id?: string;
          bezeichnung?: string | null;
          onedrive_path?: string;
          dateiname?: string;
          content_type?: string | null;
          hochgeladen_von?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      tour_notizen_auftraggeber: {
        Row: {
          id: string;
          tour_id: string;
          auftraggeber_id: string;
          notiz: string | null;
          erstellt_von: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tour_id: string;
          auftraggeber_id: string;
          notiz?: string | null;
          erstellt_von?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tour_id?: string;
          auftraggeber_id?: string;
          notiz?: string | null;
          erstellt_von?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tour_notizen_auftraggeber_tour_id_fkey';
            columns: ['tour_id'];
            referencedRelation: 'touren';
            referencedColumns: ['id'];
          },
        ];
      };
      tour_ansprechpartner: {
        Row: {
          id: string;
          tour_id: string;
          station: 'start' | 'ziel' | 'rueckfuehrung';
          name: string | null;
          telefon: string | null;
          email: string | null;
          sortierung: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          tour_id: string;
          station: 'start' | 'ziel' | 'rueckfuehrung';
          name?: string | null;
          telefon?: string | null;
          email?: string | null;
          sortierung?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          tour_id?: string;
          station?: 'start' | 'ziel' | 'rueckfuehrung';
          name?: string | null;
          telefon?: string | null;
          email?: string | null;
          sortierung?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tour_ansprechpartner_tour_id_fkey';
            columns: ['tour_id'];
            referencedRelation: 'touren';
            referencedColumns: ['id'];
          },
        ];
      };
      tour_aenderungen: {
        Row: {
          id: string;
          tour_id: string;
          geaendert_von: string | null;
          geaendert_am: string;
          feld: string;
          wert_alt: string | null;
          wert_neu: string | null;
          gesehen_am: string | null;
          gesehen_von: string | null;
        };
        Insert: {
          id?: string;
          tour_id: string;
          geaendert_von?: string | null;
          geaendert_am?: string;
          feld: string;
          wert_alt?: string | null;
          wert_neu?: string | null;
          gesehen_am?: string | null;
          gesehen_von?: string | null;
        };
        Update: {
          id?: string;
          tour_id?: string;
          geaendert_von?: string | null;
          geaendert_am?: string;
          feld?: string;
          wert_alt?: string | null;
          wert_neu?: string | null;
          gesehen_am?: string | null;
          gesehen_von?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'tour_aenderungen_tour_id_fkey';
            columns: ['tour_id'];
            referencedRelation: 'touren';
            referencedColumns: ['id'];
          },
        ];
      };
      gutschriften: {
        Row: {
          id: string;
          gutschrift_nr: string;
          auftraggeber_id: string | null;
          rechnungsempfaenger_id: string | null;
          rechnung_id: string | null;
          datum: string;
          leistungszeitraum_von: string | null;
          leistungszeitraum_bis: string | null;
          anrede: string | null;
          einleitungstext: string | null;
          schlusstext: string | null;
          interne_notizen: string | null;
          adress_snapshot: Json | null;
          kundennummer: string | null;
          sachbearbeiter: string | null;
          ust_satz: number;
          netto_summe: number;
          ust_summe: number;
          brutto_summe: number;
          status: 'entwurf' | 'final';
          pdf_url: string | null;
          email_versendet_am: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gutschrift_nr?: string;
          auftraggeber_id?: string | null;
          rechnungsempfaenger_id?: string | null;
          rechnung_id?: string | null;
          datum?: string;
          leistungszeitraum_von?: string | null;
          leistungszeitraum_bis?: string | null;
          anrede?: string | null;
          einleitungstext?: string | null;
          schlusstext?: string | null;
          interne_notizen?: string | null;
          adress_snapshot?: Json | null;
          kundennummer?: string | null;
          sachbearbeiter?: string | null;
          ust_satz?: number;
          netto_summe?: number;
          ust_summe?: number;
          brutto_summe?: number;
          status?: 'entwurf' | 'final';
          pdf_url?: string | null;
          email_versendet_am?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          gutschrift_nr?: string;
          auftraggeber_id?: string | null;
          rechnungsempfaenger_id?: string | null;
          rechnung_id?: string | null;
          datum?: string;
          leistungszeitraum_von?: string | null;
          leistungszeitraum_bis?: string | null;
          anrede?: string | null;
          einleitungstext?: string | null;
          schlusstext?: string | null;
          interne_notizen?: string | null;
          adress_snapshot?: Json | null;
          kundennummer?: string | null;
          sachbearbeiter?: string | null;
          ust_satz?: number;
          netto_summe?: number;
          ust_summe?: number;
          brutto_summe?: number;
          status?: 'entwurf' | 'final';
          pdf_url?: string | null;
          email_versendet_am?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'gutschriften_rechnung_id_fkey';
            columns: ['rechnung_id'];
            referencedRelation: 'rechnungen';
            referencedColumns: ['id'];
          },
        ];
      };
      gutschriftspositionen: {
        Row: {
          id: string;
          gutschrift_id: string;
          position_nr: number;
          bezeichnung: string;
          unterzeilen: Json;
          menge: number;
          einzelpreis: number;
          gesamtpreis: number;
          ust_satz: number | null;
          tour_id: string | null;
          ist_manuell: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          gutschrift_id: string;
          position_nr?: number;
          bezeichnung?: string;
          unterzeilen?: Json;
          menge?: number;
          einzelpreis?: number;
          gesamtpreis?: number;
          ust_satz?: number | null;
          tour_id?: string | null;
          ist_manuell?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          gutschrift_id?: string;
          position_nr?: number;
          bezeichnung?: string;
          unterzeilen?: Json;
          menge?: number;
          einzelpreis?: number;
          gesamtpreis?: number;
          ust_satz?: number | null;
          tour_id?: string | null;
          ist_manuell?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'gutschriftspositionen_gutschrift_id_fkey';
            columns: ['gutschrift_id'];
            referencedRelation: 'gutschriften';
            referencedColumns: ['id'];
          },
        ];
      };
      feld_vorschlaege: {
        Row: {
          id: string;
          feld_typ: string;
          wert: string;
          anzahl: number;
          letzte_nutzung: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          feld_typ: string;
          wert: string;
          anzahl?: number;
          letzte_nutzung?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          feld_typ?: string;
          wert?: string;
          anzahl?: number;
          letzte_nutzung?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      touren_kundensicht: {
        Row: {
          id: string;
          tour_id: string | null;
          start_stadt: string;
          ziel_stadt: string;
          rueckfuehrung_stadt: string | null;
          kundenname: string | null;
          auftraggeber_id: string | null;
          startdatum: string;
          enddatum: string;
          tourenart: TourenArt | null;
          kennzeichen: string[];
          ist_e_fahrzeug: boolean;
          fin: string | null;
          fin_rueck: string | null;
          fahrzeugmodell: string | null;
          abholzeit: string | null;
          abgabezeit: string | null;
          rueckfuehrung_zeit: string | null;
          zeit_hinweis_start: string | null;
          zeit_hinweis_ziel: string | null;
          zeit_hinweis_rueckfuehrung: string | null;
          abgelehnt: boolean;
          ablehnungsgrund: string | null;
          abgelehnt_am: string | null;
          ablehnung_bestaetigt_am: string | null;
          adresse_start: string | null;
          adresse_ziel: string | null;
          adresse_rueckfuehrung: string | null;
          kontakt_start: Json | null;
          kontakt_ziel: Json | null;
          kontakt_rueckfuehrung: Json | null;
          protokoll_art: ProtokollArt | null;
          info: string | null;
          bestaetigt: boolean;
          erstellt_von: string | null;
          created_at: string;
          eingang_id: string | null;
          eingang_id_bc: string | null;
          /** Tour steht auf einer Rechnung/Gutschrift → nicht mehr
           *  vom Auftraggeber bearbeitbar (Migration 079). */
          abgerechnet: boolean;
        };
        Relationships: [];
      };
    };
    Functions: {
      is_admin: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      is_auftraggeber: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      is_test: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      current_auftraggeber_id: {
        Args: Record<PropertyKey, never>;
        Returns: string | null;
      };
      ag_tour_ansprechpartner_setzen: {
        Args: { p_tour_id: string; p_station: string; p_liste: Json };
        Returns: Json;
      };
      ag_tour_aktualisieren: {
        Args: { p_tour_id: string; p_daten: Json };
        Returns: Json;
      };
      tour_ist_abgerechnet: {
        Args: { p_tour_id: string };
        Returns: boolean;
      };
      next_gutschrift_nr: {
        Args: { p_year?: number };
        Returns: string;
      };
      feld_vorschlaege_merken: {
        Args: { p_eintraege: Json };
        Returns: number;
      };
      auftraggeber_formular_zuweisen: {
        Args: { p_tour_id: string; p_template_id: string };
        Returns: void;
      };
      next_rechnungsnummer: {
        Args: { p_year?: number };
        Returns: string;
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
          p_telefon?: string | null;
          p_position?: string | null;
        };
        Returns: void;
      };
      release_completed_greimel_zugaenge: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      release_orphaned_greimel_zugaenge: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      ag_ablehnung_bestaetigen: {
        Args: { p_tour_id: string };
        Returns: boolean;
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
