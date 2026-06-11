// Konto-Verwaltung — Admin-only Endpunkte für das Löschen eines
// Benutzerkontos (Auth-User + fahrer-Einträge), inklusive optionaler
// Übertragung aller Referenzen an ein Ziel-Konto.
//
// Routing:
//   delete-user   POST  body: { userId, transferToFahrerId?: string | null }
//
// Sicherheitsmodell:
//   - Aufrufer muss Admin sein (Bearer-Token → getAuthedUser → role).
//   - Selbstlöschung und das Entfernen des letzten Admins werden
//     server-seitig zurückgewiesen.
//   - Der SUPABASE_SERVICE_ROLE_KEY landet ausschließlich serverseitig.

import { createClient } from '@supabase/supabase-js';
import { getAuthedUser, HttpError } from '../server-lib/auth.js';

interface Req {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
}
interface Res {
  status: (n: number) => Res;
  json: (b: unknown) => void;
}

function qString(v: string | string[] | undefined): string | null {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length > 0) return String(v[0]);
  return null;
}
function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function readBody(b: unknown): Record<string, unknown> {
  if (!b) return {};
  if (typeof b === 'string') {
    try { return JSON.parse(b); } catch { return {}; }
  }
  if (typeof b === 'object') return b as Record<string, unknown>;
  return {};
}

function authHeader(req: Req): string | null {
  const v = req.headers?.authorization ?? req.headers?.Authorization;
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return null;
}

function getServiceRoleClient() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new HttpError(500, 'Supabase-Server-Env fehlt (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY)');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export default async function handler(req: Req, res: Res) {
  try {
    const method = (req.method ?? 'GET').toUpperCase();
    const action = qString(req.query?.action) ?? '';
    if (action !== 'delete-user' || method !== 'POST') {
      res.status(404).json({ error: 'Unknown action' });
      return;
    }

    const caller = await getAuthedUser(authHeader(req));
    if (caller.role !== 'admin') {
      throw new HttpError(403, 'Nur Admins dürfen Konten löschen.');
    }

    const body = readBody(req.body);
    const userId = asString(body.userId);
    const transferToFahrerId = asString(body.transferToFahrerId);
    if (!userId) {
      throw new HttpError(400, 'userId fehlt im Body.');
    }
    if (userId === caller.id) {
      throw new HttpError(400, 'Das eigene Konto kann nicht gelöscht werden.');
    }

    const admin = getServiceRoleClient();

    // Schutz: letzter Admin darf nicht entfernt werden.
    const { data: target, error: targetErr } = await admin
      .from('app_users')
      .select('id, role, email')
      .eq('id', userId)
      .maybeSingle();
    if (targetErr) throw new HttpError(500, `Ziel-Konto-Lookup fehlgeschlagen: ${targetErr.message}`);
    if (!target) throw new HttpError(404, 'Konto nicht gefunden.');
    if (target.role === 'admin') {
      const { count, error: cErr } = await admin
        .from('app_users')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin');
      if (cErr) throw new HttpError(500, `Admin-Zählung fehlgeschlagen: ${cErr.message}`);
      if ((count ?? 0) <= 1) {
        throw new HttpError(400, 'Mindestens ein Admin muss erhalten bleiben.');
      }
    }

    // 1. Alle fahrer-Einträge dieses Users laden (Haupt + Unterkonten).
    const { data: fahrerRows, error: fErr } = await admin
      .from('fahrer')
      .select('id, ist_unterkonto, haupt_user_id')
      .eq('user_id', userId);
    if (fErr) throw new HttpError(500, `Fahrer-Lookup fehlgeschlagen: ${fErr.message}`);
    const fahrerIds = (fahrerRows ?? []).map((r) => r.id);

    // 2. Referenzen behandeln. Ziel-Fahrer-ID muss zu einem ANDEREN
    //    Konto gehören (Schutz vor Self-Reference) und ein Haupt-Eintrag
    //    sein.
    let transferTargetId: string | null = null;
    if (transferToFahrerId) {
      const { data: tgt, error: tErr } = await admin
        .from('fahrer')
        .select('id, user_id, ist_unterkonto')
        .eq('id', transferToFahrerId)
        .maybeSingle();
      if (tErr) throw new HttpError(500, `Ziel-Fahrer-Lookup: ${tErr.message}`);
      if (!tgt) throw new HttpError(400, 'Ziel-Fahrer nicht gefunden.');
      if (fahrerIds.includes(tgt.id)) {
        throw new HttpError(400, 'Ziel-Fahrer gehört zum gelöschten Konto.');
      }
      transferTargetId = tgt.id;
    }

    if (fahrerIds.length > 0) {
      // ausgefuellte_formulare.fahrer_id ist NOT NULL — wenn welche
      // existieren und kein Übertragungsziel angegeben ist, brechen wir
      // ab, statt versteckt Daten zu verlieren.
      const { count: formulareCount, error: fcErr } = await admin
        .from('ausgefuellte_formulare')
        .select('id', { count: 'exact', head: true })
        .in('fahrer_id', fahrerIds);
      if (fcErr) throw new HttpError(500, `Formular-Zählung: ${fcErr.message}`);
      if ((formulareCount ?? 0) > 0 && !transferTargetId) {
        throw new HttpError(
          400,
          `Es gibt ${formulareCount} eingereichte Formulare unter diesem Konto. `
          + 'Bitte ein Übertragungs-Konto auswählen.',
        );
      }

      if (transferTargetId) {
        const { error: tForms } = await admin
          .from('ausgefuellte_formulare')
          .update({ fahrer_id: transferTargetId })
          .in('fahrer_id', fahrerIds);
        if (tForms) throw new HttpError(500, `Formulare übertragen: ${tForms.message}`);
        const { error: tTouren } = await admin
          .from('touren')
          .update({ fahrer_id: transferTargetId })
          .in('fahrer_id', fahrerIds);
        if (tTouren) throw new HttpError(500, `Touren übertragen: ${tTouren.message}`);
      } else {
        // Nur touren — fahrer_id ist nullable.
        const { error: tTouren } = await admin
          .from('touren')
          .update({ fahrer_id: null })
          .in('fahrer_id', fahrerIds);
        if (tTouren) throw new HttpError(500, `Touren auf NULL setzen: ${tTouren.message}`);
      }

      // 3. Fahrer-Einträge löschen.
      const { error: dF } = await admin
        .from('fahrer')
        .delete()
        .in('id', fahrerIds);
      if (dF) throw new HttpError(500, `Fahrer-Einträge löschen: ${dF.message}`);
    }

    // 4. app_users-Eintrag löschen (FK auf auth.users — danach kann
    //    Auth-User entfernt werden).
    const { error: dU } = await admin.from('app_users').delete().eq('id', userId);
    if (dU) throw new HttpError(500, `app_users löschen: ${dU.message}`);

    // 5. Supabase-Auth-User löschen — verhindert, dass sich das Konto
    //    weiter einloggen kann.
    const { error: dAuth } = await admin.auth.admin.deleteUser(userId);
    if (dAuth) {
      throw new HttpError(500, `Auth-User löschen fehlgeschlagen: ${dAuth.message}`);
    }

    res.status(200).json({ ok: true, deleted: target.email });
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('[api/account]', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Interner Fehler' });
  }
}
