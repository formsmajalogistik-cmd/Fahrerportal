import { getGraphClient } from './graphClient';
import { SHAREPOINT_HOSTNAME, SHAREPOINT_SITE_PATH } from '../auth/msalConfig';
import type {
  Fahrer,
  Formular,
  Fahrerzuweisung,
  OffenesFormular,
  DashboardStats,
} from '../types/sharepoint';

/** Base path for the SharePoint site via Graph API */
function getSiteBasePath(): string {
  return `/sites/${SHAREPOINT_HOSTNAME}:${SHAREPOINT_SITE_PATH}:`;
}

/** Resolve the site ID (needed for list operations) */
async function getSiteId(): Promise<string> {
  const client = getGraphClient();
  const site = await client.api(getSiteBasePath()).get();
  return site.id;
}

/** Cache site ID to avoid repeated lookups */
let cachedSiteId: string | null = null;

async function ensureSiteId(): Promise<string> {
  if (!cachedSiteId) {
    cachedSiteId = await getSiteId();
  }
  return cachedSiteId;
}

/** Get all items from a SharePoint list */
async function getListItems(listName: string): Promise<Record<string, unknown>[]> {
  const client = getGraphClient();
  const siteId = await ensureSiteId();

  const response = await client
    .api(`/sites/${siteId}/lists/${listName}/items`)
    .expand('fields')
    .top(500)
    .get();

  return (response.value || []).map((item: { id: string; fields: Record<string, unknown> }) => ({
    id: parseInt(item.id, 10),
    ...item.fields,
  }));
}

/** Create a new item in a SharePoint list */
async function createListItem(
  listName: string,
  fields: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const client = getGraphClient();
  const siteId = await ensureSiteId();

  const response = await client
    .api(`/sites/${siteId}/lists/${listName}/items`)
    .post({ fields });

  return { id: parseInt(response.id, 10), ...response.fields };
}

/** Update an existing item in a SharePoint list */
async function updateListItem(
  listName: string,
  itemId: number,
  fields: Record<string, unknown>
): Promise<void> {
  const client = getGraphClient();
  const siteId = await ensureSiteId();

  await client
    .api(`/sites/${siteId}/lists/${listName}/items/${itemId}/fields`)
    .patch(fields);
}

/** Delete an item from a SharePoint list */
async function deleteListItem(listName: string, itemId: number): Promise<void> {
  const client = getGraphClient();
  const siteId = await ensureSiteId();

  await client
    .api(`/sites/${siteId}/lists/${listName}/items/${itemId}`)
    .delete();
}

// ─── Fahrer (Drivers) ───────────────────────────────────────────────

const LIST_FAHRER = 'Fahrer';

function mapFahrer(raw: Record<string, unknown>): Fahrer {
  return {
    id: raw.id as number,
    name: (raw.Title || raw.Name || '') as string,
    vorname: (raw.Vorname || '') as string,
    email: (raw.Email || raw.E_x002d_Mail || '') as string,
    telefon: (raw.Telefon || '') as string,
    fuehrerscheinklasse: (raw.Fuehrerscheinklasse || raw.F_x00fc_hrerscheinklasse || '') as string,
    status: (raw.Status || 'Aktiv') as Fahrer['status'],
    fahrzeug: (raw.Fahrzeug || undefined) as string | undefined,
    eintrittsdatum: (raw.Eintrittsdatum || undefined) as string | undefined,
  };
}

export async function getFahrer(): Promise<Fahrer[]> {
  const items = await getListItems(LIST_FAHRER);
  return items.map(mapFahrer);
}

export async function createFahrer(fahrer: Omit<Fahrer, 'id'>): Promise<Fahrer> {
  const fields: Record<string, unknown> = {
    Title: fahrer.name,
    Vorname: fahrer.vorname,
    Email: fahrer.email,
    Telefon: fahrer.telefon,
    Fuehrerscheinklasse: fahrer.fuehrerscheinklasse,
    Status: fahrer.status,
    Fahrzeug: fahrer.fahrzeug,
    Eintrittsdatum: fahrer.eintrittsdatum,
  };
  const result = await createListItem(LIST_FAHRER, fields);
  return mapFahrer(result);
}

export async function updateFahrer(id: number, fahrer: Partial<Fahrer>): Promise<void> {
  const fields: Record<string, unknown> = {};
  if (fahrer.name !== undefined) fields.Title = fahrer.name;
  if (fahrer.vorname !== undefined) fields.Vorname = fahrer.vorname;
  if (fahrer.email !== undefined) fields.Email = fahrer.email;
  if (fahrer.telefon !== undefined) fields.Telefon = fahrer.telefon;
  if (fahrer.fuehrerscheinklasse !== undefined) fields.Fuehrerscheinklasse = fahrer.fuehrerscheinklasse;
  if (fahrer.status !== undefined) fields.Status = fahrer.status;
  if (fahrer.fahrzeug !== undefined) fields.Fahrzeug = fahrer.fahrzeug;
  await updateListItem(LIST_FAHRER, id, fields);
}

export async function deleteFahrer(id: number): Promise<void> {
  await deleteListItem(LIST_FAHRER, id);
}

// ─── Formulare (Form templates) ─────────────────────────────────────

const LIST_FORMULARE = 'Formulare';

function mapFormular(raw: Record<string, unknown>): Formular {
  return {
    id: raw.id as number,
    titel: (raw.Title || raw.Titel || '') as string,
    beschreibung: (raw.Beschreibung || '') as string,
    kategorie: (raw.Kategorie || '') as string,
    version: (raw.Version || '1.0') as string,
    gueltigAb: (raw.GueltigAb || raw.G_x00fc_ltigAb || undefined) as string | undefined,
    gueltigBis: (raw.GueltigBis || raw.G_x00fc_ltigBis || undefined) as string | undefined,
    pflicht: Boolean(raw.Pflicht),
    status: (raw.Status || 'Aktiv') as Formular['status'],
  };
}

export async function getFormulare(): Promise<Formular[]> {
  const items = await getListItems(LIST_FORMULARE);
  return items.map(mapFormular);
}

export async function createFormular(formular: Omit<Formular, 'id'>): Promise<Formular> {
  const fields: Record<string, unknown> = {
    Title: formular.titel,
    Beschreibung: formular.beschreibung,
    Kategorie: formular.kategorie,
    Version: formular.version,
    GueltigAb: formular.gueltigAb,
    GueltigBis: formular.gueltigBis,
    Pflicht: formular.pflicht,
    Status: formular.status,
  };
  const result = await createListItem(LIST_FORMULARE, fields);
  return mapFormular(result);
}

export async function updateFormular(id: number, formular: Partial<Formular>): Promise<void> {
  const fields: Record<string, unknown> = {};
  if (formular.titel !== undefined) fields.Title = formular.titel;
  if (formular.beschreibung !== undefined) fields.Beschreibung = formular.beschreibung;
  if (formular.kategorie !== undefined) fields.Kategorie = formular.kategorie;
  if (formular.version !== undefined) fields.Version = formular.version;
  if (formular.status !== undefined) fields.Status = formular.status;
  await updateListItem(LIST_FORMULARE, id, fields);
}

// ─── Fahrerzuweisung (Driver assignments) ────────────────────────────

const LIST_ZUWEISUNG = 'Fahrerzuweisung';

function mapZuweisung(raw: Record<string, unknown>): Fahrerzuweisung {
  return {
    id: raw.id as number,
    fahrerId: (raw.FahrerId || 0) as number,
    fahrerName: (raw.FahrerName || raw.Title || '') as string,
    formularId: (raw.FormularId || 0) as number,
    formularTitel: (raw.FormularTitel || '') as string,
    zuweisungsDatum: (raw.ZuweisungsDatum || '') as string,
    faelligkeitsDatum: (raw.FaelligkeitsDatum || raw.F_x00e4_lligkeitsDatum || '') as string,
    status: (raw.Status || 'Zugewiesen') as Fahrerzuweisung['status'],
    prioritaet: (raw.Prioritaet || raw.Priorit_x00e4_t || 'Mittel') as Fahrerzuweisung['prioritaet'],
  };
}

export async function getZuweisungen(): Promise<Fahrerzuweisung[]> {
  const items = await getListItems(LIST_ZUWEISUNG);
  return items.map(mapZuweisung);
}

export async function createZuweisung(
  zuweisung: Omit<Fahrerzuweisung, 'id'>
): Promise<Fahrerzuweisung> {
  const fields: Record<string, unknown> = {
    Title: zuweisung.fahrerName,
    FahrerId: zuweisung.fahrerId,
    FahrerName: zuweisung.fahrerName,
    FormularId: zuweisung.formularId,
    FormularTitel: zuweisung.formularTitel,
    ZuweisungsDatum: zuweisung.zuweisungsDatum,
    FaelligkeitsDatum: zuweisung.faelligkeitsDatum,
    Status: zuweisung.status,
    Prioritaet: zuweisung.prioritaet,
  };
  const result = await createListItem(LIST_ZUWEISUNG, fields);
  return mapZuweisung(result);
}

export async function updateZuweisung(
  id: number,
  zuweisung: Partial<Fahrerzuweisung>
): Promise<void> {
  const fields: Record<string, unknown> = {};
  if (zuweisung.status !== undefined) fields.Status = zuweisung.status;
  if (zuweisung.prioritaet !== undefined) fields.Prioritaet = zuweisung.prioritaet;
  if (zuweisung.faelligkeitsDatum !== undefined) fields.FaelligkeitsDatum = zuweisung.faelligkeitsDatum;
  await updateListItem(LIST_ZUWEISUNG, id, fields);
}

// ─── Offene Formulare (Open/pending forms) ───────────────────────────

const LIST_OFFEN = 'Offene Formulare';

function mapOffenesFormular(raw: Record<string, unknown>): OffenesFormular {
  return {
    id: raw.id as number,
    formularId: (raw.FormularId || 0) as number,
    formularTitel: (raw.FormularTitel || raw.Title || '') as string,
    fahrerId: (raw.FahrerId || 0) as number,
    fahrerName: (raw.FahrerName || '') as string,
    eingereichtAm: (raw.EingereichtAm || undefined) as string | undefined,
    status: (raw.Status || 'Offen') as OffenesFormular['status'],
    kommentar: (raw.Kommentar || undefined) as string | undefined,
    antworten: raw.Antworten ? JSON.parse(raw.Antworten as string) : undefined,
  };
}

export async function getOffeneFormulare(): Promise<OffenesFormular[]> {
  const items = await getListItems(LIST_OFFEN);
  return items.map(mapOffenesFormular);
}

export async function createOffenesFormular(
  formular: Omit<OffenesFormular, 'id'>
): Promise<OffenesFormular> {
  const fields: Record<string, unknown> = {
    Title: formular.formularTitel,
    FormularId: formular.formularId,
    FormularTitel: formular.formularTitel,
    FahrerId: formular.fahrerId,
    FahrerName: formular.fahrerName,
    EingereichtAm: formular.eingereichtAm,
    Status: formular.status,
    Kommentar: formular.kommentar,
    Antworten: formular.antworten ? JSON.stringify(formular.antworten) : undefined,
  };
  const result = await createListItem(LIST_OFFEN, fields);
  return mapOffenesFormular(result);
}

export async function updateOffenesFormular(
  id: number,
  formular: Partial<OffenesFormular>
): Promise<void> {
  const fields: Record<string, unknown> = {};
  if (formular.status !== undefined) fields.Status = formular.status;
  if (formular.kommentar !== undefined) fields.Kommentar = formular.kommentar;
  if (formular.antworten !== undefined) fields.Antworten = JSON.stringify(formular.antworten);
  await updateListItem(LIST_OFFEN, id, fields);
}

// ─── Dashboard ──────────────────────────────────────────────────────

export async function getDashboardStats(): Promise<DashboardStats> {
  const [fahrer, formulare, offene, zuweisungen] = await Promise.all([
    getFahrer(),
    getFormulare(),
    getOffeneFormulare(),
    getZuweisungen(),
  ]);

  return {
    totalFahrer: fahrer.length,
    aktiveFahrer: fahrer.filter((f) => f.status === 'Aktiv').length,
    totalFormulare: formulare.length,
    offeneFormulare: offene.filter((o) => o.status === 'Offen').length,
    ueberfaellig: zuweisungen.filter((z) => z.status === 'Überfällig').length,
    abgeschlossen: zuweisungen.filter((z) => z.status === 'Abgeschlossen').length,
  };
}

/** Clear cached site ID (useful after config changes) */
export function clearSiteCache(): void {
  cachedSiteId = null;
}
