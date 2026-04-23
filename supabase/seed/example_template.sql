-- Beispiel-Template: Maja-Fahrzeugprotokoll
-- Optional — im Supabase SQL Editor ausführen, um ein Demo-Template zu erhalten.
-- Ersetze 'Maja-Logistik' bei Bedarf durch einen existierenden Auftraggeber.

-- 1) Sicherstellen, dass es einen Auftraggeber "Maja-Logistik" gibt
insert into public.auftraggeber (name, kontakt)
  values ('Maja-Logistik', 'dispo@maja-logistik.de')
  on conflict do nothing;

-- 2) Template anlegen
insert into public.formular_templates (name, auftraggeber_id, schema, pdf_template, field_mapping)
values (
  'Fahrzeugprotokoll',
  (select id from public.auftraggeber where name = 'Maja-Logistik' limit 1),
  $${
    "sections": [
      {
        "id": "fahrzeug",
        "title": "Fahrzeugdaten",
        "fields": [
          { "id": "fahrzeugtyp", "type": "text",   "label": "Fahrzeugtyp", "required": true },
          { "id": "kennzeichen", "type": "text",   "label": "Kennzeichen", "required": true },
          { "id": "km_stand",    "type": "number", "label": "Kilometerstand", "required": true },
          { "id": "datum",       "type": "date",   "label": "Datum", "required": true },
          { "id": "zustand",     "type": "select", "label": "Zustand",
            "options": ["neuwertig", "gut", "gebraucht", "beschädigt"] }
        ]
      },
      {
        "id": "ausstattung",
        "title": "Ausstattung",
        "fields": [
          { "id": "zubehoer", "type": "checkboxes", "label": "Zubehör",
            "options": ["Ersatzrad", "Warndreieck", "Verbandskasten", "Ladegerät"] },
          { "id": "bemerkung", "type": "textarea", "label": "Bemerkung" }
        ]
      },
      {
        "id": "fotos",
        "title": "Fotos",
        "fields": [
          { "id": "foto_front", "type": "photo", "label": "Foto Front", "required": true },
          { "id": "foto_heck",  "type": "photo", "label": "Foto Heck",  "required": true }
        ]
      },
      {
        "id": "schaeden",
        "title": "Schäden",
        "fields": [
          { "id": "schadensskizze", "type": "damage_diagram", "label": "Schadensskizze" }
        ]
      },
      {
        "id": "unterschrift",
        "title": "Unterschrift",
        "fields": [
          { "id": "signatur_fahrer", "type": "signature", "label": "Unterschrift Fahrer", "required": true }
        ]
      }
    ]
  }$$::jsonb,
  'maja-fahrzeugprotokoll.pdf',
  $${
    "fahrzeugtyp":     { "page": 1, "x": 120, "y": 680 },
    "kennzeichen":     { "page": 1, "x": 120, "y": 650 },
    "km_stand":        { "page": 1, "x": 120, "y": 620 },
    "datum":           { "page": 1, "x": 400, "y": 680 },
    "zustand":         { "page": 1, "x": 400, "y": 650 },
    "zubehoer":        { "page": 1, "x": 120, "y": 500 },
    "bemerkung":       { "page": 1, "x": 120, "y": 440 },
    "foto_front":      { "page": 2, "x":  50, "y": 500, "width": 240, "height": 180 },
    "foto_heck":       { "page": 2, "x": 310, "y": 500, "width": 240, "height": 180 },
    "signatur_fahrer": { "page": 3, "x": 120, "y": 150, "width": 200, "height": 80 }
  }$$::jsonb
);
