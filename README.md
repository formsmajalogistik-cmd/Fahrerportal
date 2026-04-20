# Maja-Logistik Fahrerportal

Fahrer-PWA des Maja-Logistik Business-Portals. Läuft auf **React + Vite** mit
**Supabase** als Backend (Auth, PostgreSQL, Storage) und **Tailwind CSS** für das
Maja-Logistik Branding.

Dieses Repo ist das **Fahrer-Frontend**. Das Admin-Dashboard liegt im separaten
Repo `maja-logistik-dashboard` und verwendet dieselbe Supabase-Instanz.

## Tech-Stack

- React 19 + Vite + TypeScript
- Supabase JS Client (`@supabase/supabase-js`)
- Tailwind CSS — Farben: Navy `#1B3A5C`, Accent `#2C5F8A`, Hellblau `#E8F0F8`, Font: DM Sans
- `pdf-lib` für PDF-Ausgabe, `browser-image-compression` für Foto-Kompression,
  `react-signature-canvas` für Unterschriften
- Deployment: Vercel

## Umgebungsvariablen

Kopiere `.env.example` nach `.env` und befülle:

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

In Vercel als *Project Environment Variables* hinterlegen — nicht committen.

## Supabase einrichten

Die Migrations im Verzeichnis `supabase/migrations/` definieren das komplette
Datenmodell. Ausführung in Supabase-Projekt:

```
supabase db push            # oder manuell im SQL-Editor der Reihe nach einspielen
```

Migrations-Reihenfolge:

1. `20260420000001_init_schema.sql` — Tabellen, Enums, Trigger, `is_admin()` Helper
2. `20260420000002_rls_policies.sql` — Row Level Security Policies
3. `20260420000003_storage_buckets.sql` — Storage-Buckets + Policies

Danach manuell einen Admin-User anlegen (via Supabase Auth UI) und die
`app_users.role` dieses Users per SQL auf `admin` setzen.

## Datenmodell (Übersicht)

| Tabelle | Zweck |
|---|---|
| `app_users` | 1:1 zu `auth.users`, enthält Rolle (`admin`/`fahrer`) und Profil |
| `auftraggeber` | Kunden, denen Formular-Templates zugeordnet sind |
| `fahrer` | Fahrer-Stammdaten, verknüpft mit `app_users` |
| `formular_templates` | JSON-Templates inkl. `schema_json` und `field_mapping` für die PDF |
| `formular_zuweisungen` | Welches Template ist welchem Fahrer zugeordnet |
| `ausgefuellte_formulare` | Erfasste Protokoll-Daten (draft / submitted) |
| `fotos` | Foto-Uploads, referenziert Formular und Feld-ID |

RLS-Kernregel: Fahrer sehen nur eigene Daten; Admins sehen alles (via
`public.is_admin()`).

## Form-Engine (geplant, Phase 2)

Unterstützte Feldtypen im `schema_json`:
`text`, `number`, `date`, `select`, `checkboxes`, `textarea`, `photo`,
`signature`, `damage_diagram`.

Ein Beispiel-Template liegt unter `supabase/seed/example_template.json`.

## Scripts

```
npm run dev         # Vite Dev-Server
npm run build       # TypeScript Build + Vite Build
npm run preview     # Gebauten Build servieren
npm run typecheck   # Nur TypeScript prüfen
npm run lint        # ESLint
```
