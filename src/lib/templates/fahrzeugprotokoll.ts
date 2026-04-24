// Maja-Logistik Standard-Fahrzeugprotokoll.
// Wird sowohl vom Admin-Button "Fahrzeugprotokoll anlegen" als auch vom
// SQL-Seed (supabase/seed/fahrzeugprotokoll.sql) verwendet — beide Quellen
// müssen identische Sektionen/Felder enthalten.

import type { FormSchema } from '../../types/db';

const TANK_OPTIONS = ['0/4', '1/4', '1/2', '3/4', '4/4'];

export const fahrzeugprotokollSchema: FormSchema = {
  sections: [
    {
      id: 'fahrzeugdaten',
      title: 'Fahrzeugdaten',
      fields: [
        { id: 'fahrzeugtyp',         type: 'text', label: 'Fahrzeugtyp', required: true },
        { id: 'kennzeichen',         type: 'text', label: 'Kennzeichen', required: true },
        { id: 'fin',                 type: 'text', label: 'FIN' },
        { id: 'fahrername',          type: 'text', label: 'Fahrername' },
        { id: 'kundenname',          type: 'text', label: 'Kundenname' },
        { id: 'email_kunde',         type: 'text', label: 'E-Mail Kunde' },
        { id: 'fuehrerscheinnummer', type: 'text', label: 'Führerscheinnummer' },
        { id: 'ausstellungsdatum',   type: 'date', label: 'Ausstellungsdatum' },
      ],
    },
    {
      id: 'uebernahme',
      title: 'Übernahme',
      fields: [
        { id: 'uebernahme_datum',    type: 'date',       label: 'Datum', required: true },
        { id: 'uebernahme_adresse',  type: 'text',       label: 'Adresse' },
        {
          id: 'uebernahme_gegebenheiten',
          type: 'checkboxes',
          label: 'Gegebenheiten',
          options: ['Dunkelheit', 'Regen', 'Schnee/Eis', 'Außen verschmutzt', 'Innen verschmutzt'],
        },
        { id: 'uebernahme_tank',     type: 'select',     label: 'Tank/Akku', options: TANK_OPTIONS },
        { id: 'uebernahme_km',       type: 'number',     label: 'Kilometerstand', required: true },
      ],
    },
    {
      id: 'uebergabe',
      title: 'Übergabe',
      fields: [
        { id: 'uebergabe_datum',      type: 'date',     label: 'Datum' },
        { id: 'uebergabe_adresse',    type: 'text',     label: 'Adresse' },
        { id: 'uebergabe_neuschaden', type: 'textarea', label: 'Neuschaden Bemerkung' },
        { id: 'uebergabe_tank',       type: 'select',   label: 'Tank/Akku', options: TANK_OPTIONS },
        { id: 'uebergabe_km',         type: 'number',   label: 'Kilometerstand' },
      ],
    },
    {
      id: 'zubehoer',
      title: 'Fahrzeugzubehör',
      fields: [
        {
          id: 'zubehoer_liste',
          type: 'checkboxes',
          label: 'Zubehör',
          options: [
            'Fahrzeugschein', 'Tire Fit', 'Warndreieck', 'Reserverad',
            'Verbandskasten', 'Navigation', 'Service Plan', 'Navi SD/DVD',
            'Warnweste', 'Bordwerkzeug', 'Betr. Anleitung', 'Fußmatten',
            'Kofferraumabdeckung', 'Antenne', 'Aschenbecher',
            'Infomappe Rent-a-Car', 'Ladekabel E-Fahrzeug',
          ],
        },
        { id: 'anzahl_schluessel', type: 'number', label: 'Anzahl Schlüssel' },
      ],
    },
    {
      id: 'schaeden',
      title: 'Schäden',
      fields: [
        { id: 'schadendiagramm', type: 'damage_diagram', label: 'Schadendiagramm' },
        { id: 'bemerkung_1',     type: 'textarea',       label: 'Bemerkung 1' },
        { id: 'bemerkung_2',     type: 'textarea',       label: 'Bemerkung 2' },
        { id: 'bemerkung_3',     type: 'textarea',       label: 'Bemerkung 3' },
        { id: 'bemerkung_4',     type: 'textarea',       label: 'Bemerkung 4' },
      ],
    },
    {
      id: 'schaeden_innen',
      title: 'Schäden Innen',
      fields: [
        {
          id: 'zustand_innen',
          type: 'checkboxes',
          label: 'Zustand',
          options: ['Vordersitze', 'Rücksitze', 'Innenverkleidung', 'Teppichboden', 'Dachhimmel', 'Kofferraum', 'Armaturen'],
        },
      ],
    },
    {
      id: 'reifen',
      title: 'Reifen',
      fields: [
        {
          id: 'reifentyp',
          type: 'checkboxes',
          label: 'Reifentyp',
          options: ['Sommer', 'Ganzjahr', 'Winter', 'Zweiter Reifensatz'],
        },
        { id: 'wartezeit_min', type: 'number', label: 'Wartezeit in Min' },
      ],
    },
    {
      id: 'fotos_uebernahme',
      title: 'Fotos Übernahme',
      fields: [
        { id: 'foto_front',            type: 'photo', label: 'Frontseite',        required: true },
        { id: 'foto_windschutz',       type: 'photo', label: 'Windschutzscheibe' },
        { id: 'foto_heck',             type: 'photo', label: 'Heckansicht',       required: true },
        { id: 'foto_fahrerseite',      type: 'photo', label: 'Fahrerseite' },
        { id: 'foto_beifahrerseite',   type: 'photo', label: 'Beifahrerseite' },
        { id: 'foto_innenraum_vorn',   type: 'photo', label: 'Innenraum vorn' },
      ],
    },
    {
      id: 'unterschriften',
      title: 'Unterschriften',
      fields: [
        { id: 'signatur_uebergebender',  type: 'signature', label: 'Unterschrift Übergebender',  required: true },
        { id: 'signatur_uebernehmender', type: 'signature', label: 'Unterschrift Übernehmender', required: true },
        { id: 'signatur_fahrer',         type: 'signature', label: 'Unterschrift Fahrer',        required: true },
      ],
    },
  ],
};

export const FAHRZEUGPROTOKOLL_DEFAULT_NAME = 'Fahrzeugprotokoll';
