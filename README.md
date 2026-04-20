# Maja-Logistik Business-Portal

Einziges Frontend des Maja-Logistik Business-Portals — enthält **sowohl
Fahrer-Interface als auch Admin-Dashboard** in derselben React-App. Die
Oberfläche wechselt rollenbasiert: `role='fahrer'` → Fahrer-Ansicht,
`role='admin'` → Admin-Ansicht.

Läuft auf **React + Vite + TypeScript**, Backend: **Supabase** (Auth,
PostgreSQL, Storage). Styling via **Tailwind CSS** mit Maja-Logistik Branding.

## Tech-Stack

- React 19 + Vite + TypeScript
- Supabase JS Client (`@supabase/supabase-js`)
- Tailwind CSS — Farben: Navy `#1B3A5C`, Accent `#2C5F8A`, Hellblau `#E8F0F8`, Font: DM Sans
- `pdf-lib` für PDF-Ausgabe, `browser-image-compression` für Foto-Kompression,
  `react-signature-canvas` für Unterschriften
- Deployment: Vercel

## Umgebungsvariablen

Die App braucht zwei Env-Vars:

```
VITE_SUPABASE_URL=https://peimsvatvdavfkrhlnmz.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key aus Supabase Project Settings → API>
```

### Lokal

`.env.example` nach `.env` kopieren und befüllen. `.env` ist gitignored.

### Vercel

Im Vercel-Projekt unter **Settings → Environment Variables** beide Keys für
alle drei Environments (`Production`, `Preview`, `Development`) setzen.
Nach dem Setzen einmal redeployen.

Der Anon-Key ist ein öffentlicher Client-Key und darf im Browser liegen — die
Sicherheit steckt in den **RLS-Policies** (`supabase/migrations/20260420000002_rls_policies.sql`).

## Supabase einrichten

Die Migrations im Verzeichnis `supabase/migrations/` definieren das komplette
Datenmodell:

1. `20260420000001_init_schema.sql` — Tabellen, Enums, Trigger, `is_admin()` Helper
2. `20260420000002_rls_policies.sql` — Row Level Security Policies
3. `20260420000003_storage_buckets.sql` — Storage-Buckets + Policies

Ausführung über Supabase CLI (`supabase db push`) oder manuell im SQL-Editor in
dieser Reihenfolge.

Danach einen Admin-User über die Supabase Auth-UI anlegen und die Rolle setzen:

```sql
update public.app_users set role = 'admin' where email = 'admin@example.com';
```

## Rollen

| Rolle    | Was die Person sieht                                                     |
|----------|--------------------------------------------------------------------------|
| `fahrer` | Eigene zugewiesene Formulare, eigene Drafts, Protokolle ausfüllen        |
| `admin`  | Übersicht, Fahrer, Auftraggeber, Templates, Zuweisungen, alle Eingänge   |

Beim Login schickt der `AuthContext` einen Lookup in `app_users` und routet auf
Basis der Rolle in die passende Shell.

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

## Projektstruktur

```
src/
  auth/             AuthContext (Session, Profil, signIn/signOut/Passwort)
  components/       Brand, Spinner, AppShell (Fahrer), AdminShell (Admin)
  lib/              Supabase-Client
  pages/            LoginPage, PasswordReset/New, FahrerDashboard, OffeneFormularePage,
                    AdminDashboard
  pages/admin/      FahrerListPage, AuftraggeberListPage, TemplatesListPage,
                    ZuweisungenPage, EingaengePage
  types/            Database-Typen (Zod-los, minimal)
supabase/
  migrations/       SQL-Migrations (Schema, RLS, Storage)
  seed/             Beispiel-Templates
```

## Scripts

```
npm run dev         # Vite Dev-Server
npm run build       # TypeScript Build + Vite Build
npm run preview     # Gebauten Build servieren
npm run typecheck   # Nur TypeScript prüfen
npm run lint        # ESLint
```
