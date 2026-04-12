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

/**
 * Encode a list name for use in a Graph URL segment. Some list names
 * contain spaces (e.g. "Offene Formulare"), which must be percent-encoded
 * or Graph returns a 400.
 */
function encodeList(listName: string): string {
  return encodeURIComponent(listName);
}

async function getListItems(listName: string): Promise<SPItem[]> {
  const client = getGraphClient();
  const siteId = await getSiteId();

  const response = await client
    .api(`/sites/${siteId}/lists/${encodeList(listName)}/items`)
    .expand('fields')
    .top(999)
    .get();

  return (response.value || []).map((item: { id: string; fields: Record<string, unknown> }) => ({
    id: parseInt(item.id, 10),
    fields: item.fields ?? {},
  }));
}

async function createListItem(
  listName: string,
  fields: Record<string, unknown>
): Promise<SPItem> {
  const client = getGraphClient();
  const siteId = await getSiteId();

  const response = await client
    .api(`/sites/${siteId}/lists/${encodeList(listName)}/items`)
    .post({ fields });

  return {
    id: parseInt(response.id, 10),
    fields: response.fields ?? fields,
  };
}

async function updateListItemFields(
  listName: string,
  itemId: number,
  fields: Record<string, unknown>
): Promise<void> {
  const client = getGraphClient();
  const siteId = await getSiteId();

  await client
    .api(`/sites/${siteId}/lists/${encodeList(listName)}/items/${itemId}/fields`)
    .patch(fields);
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

// ─── Offene Formulare (open/in-progress form instances) ────────────

export type OffenesFormularStatus = 'Offen' | 'Abgeschlossen' | string;

export interface OffenesFormularRecord {
  id: number;
  benutzername: string;
  formularname: string;
  fahrzeug: string;
  begonnen: string; // ISO timestamp
  status: OffenesFormularStatus;
}

/**
 * "Offene Formulare" list (name contains a space — URL-encoded by encodeList).
 *
 * Expected fields (best-guess — verify via /api/debug-fields?list=Offene%20Formulare
 * after first deploy, then adjust these mappings if SharePoint returns different
 * internal names):
 *
 *   internal name    contains
 *   ───────────────  ────────────────────────────────────────
 *   Title            Benutzername des Fahrers (default Title)
 *   FormularName     Name des zugewiesenen Formulars
 *   Fahrzeug         Fahrzeugkennzeichen / Nummer
 *   Begonnen         DateTime, wann Fahrer das Formular gestartet hat
 *   Status           Choice: Offen | Abgeschlossen
 *
 * If the SharePoint admin used different internal names (e.g. "Benutzername"
 * as a separate column instead of re-using Title), the mapping below and the
 * write-side field keys must be updated after checking debug-fields.
 */
const OFFENE_LIST = 'Offene Formulare';

function mapOffenesFormular(item: SPItem): OffenesFormularRecord {
  const f = item.fields;
  // Read defensively: accept either a dedicated Benutzername column or Title.
  const benutzername =
    String((f.Benutzername as unknown) ?? '').trim() ||
    String((f.Title as unknown) ?? '').trim();

  const formularname =
    String((f.FormularName as unknown) ?? '').trim() ||
    String((f.Formularname as unknown) ?? '').trim();

  const fahrzeug = String((f.Fahrzeug as unknown) ?? '').trim();
  const begonnen = String((f.Begonnen as unknown) ?? '').trim();
  const status = String((f.Status as unknown) ?? 'Offen').trim();

  return {
    id: item.id,
    benutzername,
    formularname,
    fahrzeug,
    begonnen,
    status,
  };
}

/**
 * List all entries for a driver in the Offene Formulare list.
 * Filters in-memory (no $filter) so we don't depend on column indexing.
 * Pass statusFilter to restrict to e.g. only 'Offen' entries.
 */
export async function getOffeneFormulareForFahrer(
  benutzername: string,
  statusFilter?: OffenesFormularStatus
): Promise<OffenesFormularRecord[]> {
  const items = await getListItems(OFFENE_LIST);
  const target = benutzername.trim().toLowerCase();

  return items
    .map(mapOffenesFormular)
    .filter((e) => e.benutzername.toLowerCase() === target)
    .filter((e) => (statusFilter ? e.status === statusFilter : true))
    .sort((a, b) => (a.begonnen < b.begonnen ? 1 : -1));
}

export interface CreateOffenesFormularInput {
  benutzername: string;
  formularname: string;
  fahrzeug: string;
}

/**
 * Create a new "Offene Formulare" entry when a driver starts filling out
 * a form. Status defaults to 'Offen' and Begonnen to the current ISO timestamp.
 *
 * We populate BOTH `Title` and `Benutzername` so that regardless of which
 * internal column holds the driver name, the data is there. SharePoint
 * silently ignores unknown field keys, so writing an extra one is safe.
 */
export async function createOffenesFormular(
  input: CreateOffenesFormularInput
): Promise<OffenesFormularRecord> {
  const now = new Date().toISOString();
  const fields: Record<string, unknown> = {
    Title: input.benutzername,
    Benutzername: input.benutzername,
    FormularName: input.formularname,
    Formularname: input.formularname,
    Fahrzeug: input.fahrzeug,
    Begonnen: now,
    Status: 'Offen',
  };

  const created = await createListItem(OFFENE_LIST, fields);
  return mapOffenesFormular(created);
}

/**
 * Update the status of an "Offene Formulare" entry. The authorized caller
 * must pass their own benutzername so we can verify ownership before
 * mutating (drivers must not be able to close each other's entries).
 */
export async function updateOffenesFormularStatus(
  itemId: number,
  benutzername: string,
  status: OffenesFormularStatus
): Promise<OffenesFormularRecord | null> {
  // Verify the entry belongs to the caller by scanning the list.
  // This avoids having to trust a separate "ownership" field.
  const items = await getListItems(OFFENE_LIST);
  const existing = items.find((i) => i.id === itemId);
  if (!existing) return null;

  const mapped = mapOffenesFormular(existing);
  if (mapped.benutzername.toLowerCase() !== benutzername.trim().toLowerCase()) {
    return null;
  }

  await updateListItemFields(OFFENE_LIST, itemId, { Status: status });
  return { ...mapped, status };
}
