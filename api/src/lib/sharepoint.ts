import { getGraphClient } from './graphClient.js';
import { config } from './config.js';

/**
 * Thin wrapper around Microsoft Graph to query the Fahrerportal SharePoint site.
 *
 * Lists:
 *   - Fahrer            (drivers, incl. login credentials)
 *   - Formulare         (form templates)
 *   - FahrerFormulare   (driver ↔ form assignments)
 *   - OffeneFormulare   (pending/open form submissions)
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

/** Fetch all items from a list, optionally filtered via OData $filter */
export async function getListItems(
  listName: string,
  filter?: string
): Promise<SPItem[]> {
  const client = getGraphClient();
  const siteId = await getSiteId();

  let req = client
    .api(`/sites/${siteId}/lists/${listName}/items`)
    .expand('fields')
    .top(500);

  if (filter) {
    req = req.filter(filter).header('Prefer', 'HonorNonIndexedQueriesWarningMayFailRandomly');
  }

  const response = await req.get();
  return (response.value || []).map((item: { id: string; fields: Record<string, unknown> }) => ({
    id: parseInt(item.id, 10),
    fields: item.fields,
  }));
}

// ─── Fahrer (Drivers) ───────────────────────────────────────────────

export interface FahrerRecord {
  id: number;
  benutzername: string;
  pin: string;
  name: string;
  vorname: string;
}

function mapFahrer(item: SPItem): FahrerRecord {
  const f = item.fields;
  return {
    id: item.id,
    benutzername: String(f.Benutzername || ''),
    pin: String(f.PIN || ''),
    name: String(f.Title || f.Name || ''),
    vorname: String(f.Vorname || ''),
  };
}

/** Find a driver by username (for login verification) */
export async function findFahrerByBenutzername(
  benutzername: string
): Promise<FahrerRecord | null> {
  // Note: SharePoint OData filters on custom fields require the field to be indexed.
  // If filter fails, fall back to in-memory search.
  try {
    const items = await getListItems(
      'Fahrer',
      `fields/Benutzername eq '${benutzername.replace(/'/g, "''")}'`
    );
    if (items.length > 0) return mapFahrer(items[0]);
  } catch {
    // Fall through to unfiltered search
  }

  const all = await getListItems('Fahrer');
  const found = all.find((item) => String(item.fields.Benutzername || '') === benutzername);
  return found ? mapFahrer(found) : null;
}

// ─── Formulare (assigned to a driver) ───────────────────────────────

export interface FormularRecord {
  id: number;
  titel: string;
  beschreibung: string;
  kategorie: string;
  version: string;
  faelligkeitsDatum?: string;
  status: string;
  prioritaet: string;
  pflicht: boolean;
}

function mapFormular(
  template: SPItem,
  assignment?: SPItem
): FormularRecord {
  const t = template.fields;
  const a = assignment?.fields ?? {};
  return {
    id: template.id,
    titel: String(t.Title || t.Titel || ''),
    beschreibung: String(t.Beschreibung || ''),
    kategorie: String(t.Kategorie || ''),
    version: String(t.Version || '1.0'),
    faelligkeitsDatum: a.FaelligkeitsDatum ? String(a.FaelligkeitsDatum) : undefined,
    status: String(a.Status || 'Zugewiesen'),
    prioritaet: String(a.Prioritaet || 'Mittel'),
    pflicht: Boolean(t.Pflicht),
  };
}

/**
 * Fetch all forms assigned to a specific driver.
 *
 * 1. Read FahrerFormulare filtered by driver ID to get the assignments
 * 2. Read the referenced Formulare templates
 * 3. Merge both for the final response
 */
export async function getFormulareForFahrer(
  fahrerId: number
): Promise<FormularRecord[]> {
  const assignments = await getListItems(
    'FahrerFormulare',
    `fields/FahrerId eq ${fahrerId}`
  );

  if (assignments.length === 0) return [];

  const formularIds = new Set(
    assignments
      .map((a) => Number(a.fields.FormularId))
      .filter((id) => !Number.isNaN(id) && id > 0)
  );

  const allFormulare = await getListItems('Formulare');
  const formulareById = new Map<number, SPItem>();
  for (const f of allFormulare) {
    if (formularIds.has(f.id)) formulareById.set(f.id, f);
  }

  return assignments
    .map((assignment) => {
      const formularId = Number(assignment.fields.FormularId);
      const template = formulareById.get(formularId);
      if (!template) return null;
      return mapFormular(template, assignment);
    })
    .filter((x): x is FormularRecord => x !== null);
}

// ─── OffeneFormulare (pending submissions) ──────────────────────────

export interface OffenesFormularRecord {
  id: number;
  formularId: number;
  formularTitel: string;
  eingereichtAm?: string;
  status: string;
  kommentar?: string;
}

function mapOffenesFormular(item: SPItem): OffenesFormularRecord {
  const f = item.fields;
  return {
    id: item.id,
    formularId: Number(f.FormularId || 0),
    formularTitel: String(f.FormularTitel || f.Title || ''),
    eingereichtAm: f.EingereichtAm ? String(f.EingereichtAm) : undefined,
    status: String(f.Status || 'Offen'),
    kommentar: f.Kommentar ? String(f.Kommentar) : undefined,
  };
}

/** Fetch open/pending forms for a specific driver */
export async function getOffeneFormulareForFahrer(
  fahrerId: number
): Promise<OffenesFormularRecord[]> {
  const items = await getListItems(
    'OffeneFormulare',
    `fields/FahrerId eq ${fahrerId}`
  );
  return items.map(mapOffenesFormular);
}
