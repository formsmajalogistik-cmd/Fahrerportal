# Maja-Logistik Business-Portal

Einziges Frontend des Maja-Logistik Business-Portals — enthält sowohl
**Fahrer-Interface** als auch **Admin-Bereich** in derselben React-App. Die
Oberfläche wechselt rollenbasiert: `role='fahrer'` → Fahrer-Ansicht,
`role='admin'` → Admin-Ansicht.

**Stack:** React 19 + Vite + TypeScript · Tailwind (DM Sans, Maja-Palette) ·
Supabase (Auth, PostgreSQL, Storage) · `pdf-lib`, `browser-image-compression`,
`react-signature-canvas` · Deployment Vercel.

## Umgebungsvariablen

```
VITE_SUPABASE_URL=https://peimsvatvdavfkrhlnmz.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

Lokal in `.env` (gitignored), in Vercel unter **Settings → Environment
Variables** für Production/Preview/Development.

## Supabase einrichten (SQL Editor, in dieser Reihenfolge)

1. `supabase/migrations/001_schema.sql` — Tabellen, Enums, Trigger, `is_admin()` Helper
2. `supabase/migrations/002_rls.sql` — Row Level Security Policies
3. `supabase/migrations/003_storage.sql` — Storage-Buckets + Policies
4. *(optional)* `supabase/seed/example_template.sql` — Beispiel-Template

Danach einen ersten Admin via Supabase Auth anlegen und die Rolle setzen:

```sql
update public.app_users set role = 'admin' where email = 'admin@example.com';
```

## Rollen

| Rolle    | Was die Person sieht                                                     |
|----------|--------------------------------------------------------------------------|
| `fahrer` | Zugewiesene Formulare, eigene Drafts, Protokolle ausfüllen/einreichen    |
| `admin`  | Übersicht, Fahrer, Auftraggeber, Templates, Zuweisungen, alle Eingänge   |

## Datenmodell

| Tabelle | Spalten |
|---|---|
| `app_users` | `id, email, role, vorname, nachname` |
| `auftraggeber` | `id, name, kontakt` |
| `fahrer` | `id, user_id, aktiv` |
| `formular_templates` | `id, name, auftraggeber_id, schema, pdf_template, field_mapping` |
| `formular_zuweisungen` | `id, fahrer_id, template_id` |
| `ausgefuellte_formulare` | `id, fahrer_id, template_id, daten, status, created_at` |

Fotos liegen als Storage-Objekte im Bucket `formular-fotos` unter
`<user_id>/<formular_id>/<field_id>.jpg`; der Pfad wird im `daten`-JSON des
ausgefüllten Formulars abgelegt.

## Formular-Engine

Die Engine liest `formular_templates.schema` (JSON) und rendert dynamisch
folgende Feldtypen:

| Typ | Komponente |
|---|---|
| `text`           | `<input type="text">` |
| `number`         | `<input type="number">` |
| `date`           | `<input type="date">` |
| `select`         | Dropdown aus `options[]` |
| `checkboxes`     | Mehrfachauswahl aus `options[]` |
| `textarea`       | Textarea |
| `photo`          | Foto-Upload mit Client-Kompression (max 1200 px, ~80 % JPEG) |
| `signature`      | Canvas-Signatur (`react-signature-canvas`) |
| `damage_diagram` | Klickbare Fahrzeug-Skizze, Marker in % |

### Neues Template ohne Code-Änderung hinzufügen

Einen Insert in `formular_templates` machen (siehe `supabase/seed/example_template.sql`).
Die App rendert alles automatisch anhand von `schema` und weist via
`formular_zuweisungen` den Fahrern zu.

### PDF-Ausgabe

Jedes Template kann ein `pdf_template` (Pfad im Storage-Bucket `pdf-templates`)
und ein `field_mapping` (Seite + X/Y-Koordinaten je Feld-ID) hinterlegen.
Die Datenübernahme in die PDF ist in einer späteren Phase ergänzbar
(`pdf-lib` ist bereits als Dependency eingebunden).

## Scripts

```
npm run dev         # Vite Dev-Server
npm run build       # TypeScript Build + Vite Build
npm run preview
npm run typecheck
npm run lint
```
