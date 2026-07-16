// GET /api/cron-release-greimel
// Vercel-Cron-Endpoint: ruft die SECURITY-DEFINER-RPC
// release_completed_greimel_zugaenge() in Supabase auf, die alle
// abgeschlossenen Touren von ihrem Greimel-Zugang entkoppelt.
//
// Aufruf:
//   Vercel-Cron (siehe vercel.json) sendet den Request einmal pro Nacht
//   und schickt automatisch den Header Authorization: Bearer <CRON_SECRET>,
//   sofern die Env-Variable CRON_SECRET gesetzt ist. CRON_SECRET ist
//   PFLICHT (Sicherheits-Audit M-3) — ohne gesetztes Secret antwortet der
//   Endpoint mit 500, statt offen aufrufbar zu sein.

import { createClient } from '@supabase/supabase-js';

interface Req {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
}
interface Res {
  status: (n: number) => Res;
  json: (b: unknown) => void;
}

function asString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return null;
}

export default async function handler(req: Req, res: Res) {
  if (req.method && req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' }); return;
  }

  // Pflicht-Schutz (Sicherheits-Audit M-3): Der Endpoint löst eine
  // SECURITY-DEFINER-RPC aus und darf NICHT unauthentifiziert aufrufbar
  // sein. CRON_SECRET MUSS gesetzt sein; fehlt es, brechen wir mit 500
  // ab statt offen durchzulassen. Der Aufruf muss das Secret per
  // Authorization: Bearer <CRON_SECRET> (Vercel-Crons setzen diesen
  // Header automatisch, wenn konfiguriert) ODER ?secret=<CRON_SECRET>
  // mitschicken.
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error('[cron-release-greimel] CRON_SECRET ist nicht konfiguriert');
    res.status(500).json({ error: 'CRON_SECRET nicht konfiguriert' });
    return;
  }
  const auth = asString(req.headers?.authorization);
  const querySecret = asString(req.query?.secret);
  if (auth !== `Bearer ${expected}` && querySecret !== expected) {
    res.status(401).json({ error: 'Unauthorized' }); return;
  }

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
           ?? process.env.SUPABASE_ANON_KEY
           ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    res.status(500).json({ error: 'Supabase-Server-Env fehlt' });
    return;
  }

  const supa = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supa.rpc('release_completed_greimel_zugaenge');
  if (error) {
    console.error('[cron-release-greimel]', error);
    res.status(500).json({ error: error.message }); return;
  }
  // Selbstheilung: zusätzlich verwaiste Zuweisungen freigeben (Fahrer im
  // fahrer_ids-Array ohne irgendeine nicht-abgeschlossene Tour mit diesem
  // Zugang — z.B. nach Tour-Löschung). Läuft BEWUSST nur hier im Cron,
  // nicht im Frontend-RPC (siehe Migration 069).
  const { data: orphaned, error: orphanErr } = await supa.rpc('release_orphaned_greimel_zugaenge');
  if (orphanErr) {
    // Nicht fatal — der Haupt-Release lief durch. Loggen + weitergeben.
    console.error('[cron-release-greimel] Waisen-Freigabe fehlgeschlagen', orphanErr);
  }
  res.status(200).json({
    ok: true,
    released: data ?? 0,
    orphaned_released: orphaned ?? 0,
    orphan_error: orphanErr?.message ?? null,
  });
}
