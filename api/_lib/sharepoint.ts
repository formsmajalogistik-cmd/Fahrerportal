import { getGraphClient } from './graphClient.js';
import { config } from './config.js';

/**
 * SharePoint access layer for the Fahrerportal.
 *
 * All three lists were verified via /api/debug-fields. The internal column
 * names (what Graph returns in item.fields) deviate from the SharePoint
 * display names in multiple places because columns were renamed after
 * creation. See the comments above each mapXxx() function for the exact
 * intern→display mapping.
 *
 * Lists:
 *   Fahrer          - Title, Fahrername, Benutzername0, Benutzername, Aktiv
 *   Formulare       - Title, Art, FilloutURL (Hyperlink), Aktiv
 *   Fahrerzuweisung - Title (=Benutzername), Formularname
 *
 * Joining is by Benutzername (string) and form name (string), not by IDs.
 */

// ─── Site ID caching ────────────────────────────────────────────────
let cachedSiteId: string | null = null;

async function getSiteId(): Promise<string> {
  if (cachedSiteId) return cachedSiteId;
  const client = getGraphClient();
  const path = `/sites/${config.sharepointHostname}:${config.sharepointSitePath}:`;
  const site = await client.api(path).get();
  cachedSiteId = site.id as string;
  return cachedSiteId;
}

// ─── Generic list access ────────────────────────────────────────────

export interface SPItem {
  id: number;
  fields: Record<string, unknown>;
}

async function getListItems(listName: string): Promise<SPItem[]> {
  const client = getGraphClient();
  const siteId = await getSiteId();

  const response = await client
    .api(`/sites/${siteId}/lists/${listName}/items`)
    .expand('fields')
    .top(999)
    .get();

  return (response.value || []).map((item: { id: string; fields: Record<string, unknown> }) => ({
    id: parseInt(item.id, 10),
    fields: item.fields ?? {},
  }));
}

// ─── Fahrer (Drivers) ───────────────────────────────────────────────

export interface FahrerRecord {
  id: number;
  benutzername: string;
  pin: string;
  name: string;      // Familienname (intern: Title)
  vorname: string;
  aktiv: boolean;
}

/**
 * IMPORTANT: The SharePoint internal column names in the Fahrer list do NOT
 * match the display names. Columns were renamed after creation, which is
 * irreversible at the internal-name level. Verified via /api/debug-fields:
 *
 *   internal name    display name    contains
 *   ───────────────  ──────────────  ────────────────────────────────────
 *   Title            "Titel"         Familienname
 *   Fahrername       "Vorname"       Vorname
 *   Benutzername0    "Benutzername"  Login-Username (added after rename → "0" suffix)
 *   Benutzername     "PIN"           4-stelliger PIN (originally created as
 *                                    "Benutzername", later renamed to "PIN";
 *                                    internal name stuck)
 *   Aktiv            "Aktiv"         nur aktive Fahrer dürfen sich anmelden
 *
 * If the SharePoint list is ever rebuilt, give the columns clean names from
 * the start so this mapping can be simplified.
 */
function mapFahrer(item: SPItem): FahrerRecord {
  const f = item.fields;
  return {
    id: item.id,
    name: String(f.Title || '').trim(),
    vorname: String(f.Fahrername || '').trim(),
    benutzername: String(f.Benutzername0 || '').trim(),
    pin: String(f.Benutzername || '').trim(),
    aktiv: f.Aktiv === true,
  };
}

/**
 * Find a driver by their username for login verification.
 *
 * Does an in-memory filter instead of a server-side $filter to avoid
 * SharePoint indexing requirements. Fahrer lists are expected to be small
 * (< 999 drivers) so this is fine. Inactive drivers are filtered out.
 */
export async function findFahrerByBenutzername(
  benutzername: string
): Promise<FahrerRecord | null> {
  const items = await getListItems('Fahrer');
  const target = benutzername.trim().toLowerCase();
  const found = items
    .map(mapFahrer)
    .find((f) => f.aktiv && f.benutzername.toLowerCase() === target);
  return found || null;
}

// ─── Formulare + Fahrerzuweisung (join by username and form name) ──

export interface FormularRecord {
  id: number;
  formularname: string;
  art: 'Wiederkehrend' | 'Einmalig' | string;
  filloutUrl: string;
  aktiv: boolean;
}

/**
 * Extract the URL string from a SharePoint Hyperlink/URL column.
 * These columns come back from Graph as an object `{ Url, Description }`
 * (not as a plain string), so calling String() directly would produce
 * "[object Object]".
 */
function extractUrl(raw: unknown): string {
  if (!raw) return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'object') {
    const obj = raw as { Url?: unknown; Description?: unknown };
    if (typeof obj.Url === 'string' && obj.Url) return obj.Url.trim();
    if (typeof obj.Description === 'string' && obj.Description) {
      return obj.Description.trim();
    }
  }
  return '';
}

/**
 * Formulare list (verified via /api/debug-fields):
 *
 *   internal name  display name    contains
 *   ─────────────  ──────────────  ──────────────────────────────────
 *   Title          "Titel"         Formularname (!), KEIN separates Feld
 *   Art            "Art"           Choice: Wiederkehrend|Einmalig
 *   FilloutURL     "Fillout URL"   Hyperlink-Objekt { Url, Description }
 *   Aktiv          "Aktiv"         Boolean
 *
 * Es gibt keine separate Formularname-Spalte - SharePoint-Admin hat den
 * Namen direkt in die Title-Spalte geschrieben.
 */
function mapFormular(item: SPItem): FormularRecord {
  const f = item.fields;
  // Defensive Aktiv detection - booleans can come back as bool/number/string
  const aktivRaw = f.Aktiv;
  const aktiv =
    aktivRaw === true ||
    aktivRaw === 1 ||
    String(aktivRaw).toLowerCase() === 'true' ||
    String(aktivRaw).toLowerCase() === 'ja' ||
    String(aktivRaw).toLowerCase() === 'yes';

  return {
    id: item.id,
    formularname: String(f.Title || '').trim(),
    art: String(f.Art || '').trim(),
    filloutUrl: extractUrl(f.FilloutURL),
    aktiv,
  };
}

/**
 * Fetch all active forms assigned to a specific driver.
 *
 * Fahrerzuweisung list (verified via /api/debug-fields):
 *
 *   internal name  display name    contains
 *   ─────────────  ──────────────  ──────────────────────────────
 *   Title          "Titel"         Benutzername des Fahrers
 *                                  (LinkTitle zeigt "Benutzername"
 *                                  als Display, ist aber readonly-Spiegel)
 *   Formularname   "Formularname"  Name des zugewiesenen Formulars
 *
 * 1. Load Fahrerzuweisung, filter by Title (=Benutzername) → set of Formularname strings
 * 2. Load Formulare, filter by (Aktiv == true) AND (Title in set)
 * 3. Return the matched active forms
 */
export async function getFormulareForFahrer(
  benutzername: string
): Promise<FormularRecord[]> {
  const [zuweisungen, formulare] = await Promise.all([
    getListItems('Fahrerzuweisung'),
    getListItems('Formulare'),
  ]);

  const benutzernameLower = benutzername.trim().toLowerCase();

  // Collect form names assigned to this driver (case-insensitive match on user).
  // The "Benutzername" column of the Fahrerzuweisung list is internally named
  // Title, and the form name is in `Formularname` (lowercase n).
  const assignedFormNames = new Set<string>();
  for (const item of zuweisungen) {
    const zuBenutzername = String(item.fields.Title || '').trim().toLowerCase();
    if (zuBenutzername === benutzernameLower) {
      const formName = String(item.fields.Formularname || '').trim();
      if (formName) assignedFormNames.add(formName.toLowerCase());
    }
  }

  if (assignedFormNames.size === 0) return [];

  // Filter active forms that match the assigned names
  return formulare
    .map(mapFormular)
    .filter((f) => f.aktiv && assignedFormNames.has(f.formularname.toLowerCase()));
}
