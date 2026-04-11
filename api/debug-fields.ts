import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getGraphClient } from './_lib/graphClient.js';
import { config } from './_lib/config.js';
import { handlePreflight, sendJson, sendError } from './_lib/http.js';

/**
 * GET /api/debug-fields?token=<JWT_SECRET>
 *   (alternativ: Header X-Debug-Token: <JWT_SECRET>)
 *
 * Diagnostic endpoint that reveals SharePoint internal field names for the
 * Fahrer list, plus a sample item with masked PIN. Use this when login
 * fails because Microsoft Graph returns column items keyed by INTERNAL
 * field names that may differ from the display name (e.g. a column shown
 * as "Benutzername" might internally be `Benutzername0` if it was renamed,
 * or `Title` if it replaced the default Title column).
 *
 * Gated behind a shared secret so it can't be scraped publicly.
 * Remove this file once login works reliably.
 */

interface SpListSummary {
  id?: string;
  name?: string;
  displayName?: string;
  webUrl?: string;
}

interface SpRawColumn {
  id?: string;
  name?: string;
  displayName?: string;
  description?: string;
  columnGroup?: string;
  hidden?: boolean;
  readOnly?: boolean;
  required?: boolean;
  text?: unknown;
  number?: unknown;
  boolean?: unknown;
  choice?: unknown;
  dateTime?: unknown;
  lookup?: unknown;
  personOrGroup?: unknown;
  calculated?: unknown;
}

interface SpRawItem {
  id: string;
  fields?: Record<string, unknown>;
}

function detectType(c: SpRawColumn): string {
  if (c.text) return 'text';
  if (c.number) return 'number';
  if (c.boolean) return 'boolean';
  if (c.choice) return 'choice';
  if (c.dateTime) return 'dateTime';
  if (c.lookup) return 'lookup';
  if (c.personOrGroup) return 'personOrGroup';
  if (c.calculated) return 'calculated';
  return 'other';
}

function maskSensitive(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = k.toLowerCase().includes('pin') ? '***masked***' : v;
  }
  return out;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (handlePreflight(req, res)) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    sendError(res, 405, `Method ${req.method} Not Allowed`);
    return;
  }

  // Gate behind a shared secret. Accept token via query param so it can
  // be opened directly in a browser, or via header for tooling.
  const queryToken =
    typeof req.query.token === 'string' ? req.query.token : undefined;
  const headerToken =
    typeof req.headers['x-debug-token'] === 'string'
      ? (req.headers['x-debug-token'] as string)
      : undefined;
  const debugToken = queryToken ?? headerToken;
  if (!debugToken || debugToken !== config.jwtSecret) {
    sendError(
      res,
      401,
      'Debug-Token erforderlich: ?token=<JWT_SECRET> oder Header X-Debug-Token'
    );
    return;
  }

  try {
    const client = getGraphClient();

    // Resolve site
    const sitePath = `/sites/${config.sharepointHostname}:${config.sharepointSitePath}:`;
    const site = await client.api(sitePath).get();
    const siteId = site.id as string;

    // 1. List all SharePoint lists on the site (so we can confirm the
    //    Fahrer list actually exists and uses that exact name).
    const listsResponse = await client.api(`/sites/${siteId}/lists`).get();
    const lists: SpListSummary[] = (listsResponse.value || []).map((l: SpListSummary) => ({
      id: l.id,
      name: l.name,
      displayName: l.displayName,
      webUrl: l.webUrl,
    }));

    // 2. Fetch column metadata for the Fahrer list. The "name" property
    //    here is the INTERNAL name used as the key inside item.fields.
    let fahrerColumns: Array<{
      name?: string;
      displayName?: string;
      type: string;
      hidden?: boolean;
      readOnly?: boolean;
      required?: boolean;
      columnGroup?: string;
    }> = [];
    let columnsError: string | null = null;
    try {
      const columnsResponse = await client
        .api(`/sites/${siteId}/lists/Fahrer/columns`)
        .get();
      const rawColumns: SpRawColumn[] = columnsResponse.value || [];
      fahrerColumns = rawColumns.map((c) => ({
        name: c.name,
        displayName: c.displayName,
        type: detectType(c),
        hidden: c.hidden,
        readOnly: c.readOnly,
        required: c.required,
        columnGroup: c.columnGroup,
      }));
    } catch (err) {
      columnsError = err instanceof Error ? err.message : String(err);
    }

    // 3. Fetch one sample item with all fields, so we can see the actual
    //    keys returned by Graph (these are what `item.fields.Benutzername`
    //    needs to match in mapFahrer()).
    let sample: {
      id?: string;
      fieldKeys?: string[];
      fields?: Record<string, unknown>;
    } | null = null;
    let itemsError: string | null = null;
    try {
      const itemsResponse = await client
        .api(`/sites/${siteId}/lists/Fahrer/items`)
        .expand('fields')
        .top(1)
        .get();
      const first: SpRawItem | undefined = (itemsResponse.value || [])[0];
      if (first) {
        const fields = first.fields ?? {};
        sample = {
          id: first.id,
          fieldKeys: Object.keys(fields),
          fields: maskSensitive(fields),
        };
      }
    } catch (err) {
      itemsError = err instanceof Error ? err.message : String(err);
    }

    sendJson(res, 200, {
      siteId,
      listsOnSite: lists,
      fahrer: {
        columns: fahrerColumns,
        columnsError,
        sample,
        itemsError,
      },
      hint:
        'Look at fahrer.sample.fieldKeys and fahrer.columns[].name. Whatever ' +
        "the actual internal names are, mapFahrer() in api/_lib/sharepoint.ts " +
        'must read those exact keys from item.fields.',
    });
  } catch (err) {
    console.error('debug-fields error:', err);
    sendError(
      res,
      500,
      err instanceof Error ? err.message : 'Unbekannter Fehler beim Diagnose-Abruf'
    );
  }
}
