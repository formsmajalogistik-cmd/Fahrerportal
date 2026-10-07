// Konto-Verwaltung — Admin-only Endpunkte für das Löschen eines
// Benutzerkontos (Auth-User + fahrer-Einträge), inklusive optionaler
// Übertragung aller Referenzen an ein Ziel-Konto, und für das Ändern der
// E-Mail-Adresse (= Login + Zustelladresse) eines Kontos.
//
// Routing:
//   delete-user   POST  body: { userId, transferToFahrerId?: string | null }
//   change-email  POST  body: { userId, neueEmail, neueEmailWiederholung }
//
// Sicherheitsmodell:
//   - Aufrufer muss Admin sein (Bearer-Token → getAuthedUser → role).
//   - Selbstlöschung und das Entfernen des letzten Admins werden
//     server-seitig zurückgewiesen.
//   - Der SUPABASE_SERVICE_ROLE_KEY landet ausschließlich serverseitig.

import { createClient } from '@supabase/supabase-js';
import { getAuthedUser, HttpError } from '../server-lib/auth.js';
import { normalisiereEmail, pruefeNeueEmail } from '../server-lib/emailAendern.js';
import { sendMail } from '../server-lib/graph.js';

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
    if (action === 'change-email' && method === 'POST') {
      await emailAendern(req, res);
      return;
    }
    if (action !== 'delete-user' || method !== 'POST') {
      res.status(404).json({ error: 'Unknown action' });
      return;
    }

    const caller = await getAuthedUser(authHeader(req));
    if (caller.role === 'test') {
      throw new HttpError(403, 'Testmodus — Konten werden nicht gelöscht.');
    }
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

// ---------------------------------------------------------------
// change-email
// ---------------------------------------------------------------
//
// Die Adresse steckt an genau zwei gepflegten Stellen:
//   * auth.users.email     — der Login (Supabase Auth)
//   * public.app_users.email — der Spiegel, aus dem die App ALLE
//     Zustelladressen liest (Bestätigungsmail, Auftrags-E-Mail, Briefe,
//     Führerscheinabfrage, Anzeigen). Keine Kopien in fahrer o.ä.
// Zusätzlich wird ein Eintrag im Empfänger-Adressbuch (email_favoriten)
// mitgezogen, falls der Fahrer dort mit der alten Adresse steht.
// Historische Protokolle (versendete Mails, alte Rechnungsempfänger)
// bleiben bewusst, wie sie waren.

function likeExakt(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

async function emailAendern(req: Req, res: Res): Promise<void> {
  const caller = await getAuthedUser(authHeader(req));
  if (caller.role === 'test') throw new HttpError(403, 'Testmodus — E-Mail-Adressen werden nicht geändert.');
  if (caller.role !== 'admin') throw new HttpError(403, 'Nur Admins dürfen E-Mail-Adressen ändern.');

  const body = readBody(req.body);
  const userId = asString(body.userId);
  if (!userId) throw new HttpError(400, 'userId fehlt im Body.');

  const admin = getServiceRoleClient();
  const { data: ziel, error: zielErr } = await admin
    .from('app_users').select('id, email, vorname, nachname').eq('id', userId).maybeSingle();
  if (zielErr) throw new HttpError(500, `Konto-Lookup fehlgeschlagen: ${zielErr.message}`);
  if (!ziel) throw new HttpError(404, 'Konto nicht gefunden.');
  const alt = String(ziel.email ?? '');

  const pruefung = pruefeNeueEmail(body.neueEmail, body.neueEmailWiederholung, alt);
  if (!pruefung.ok) throw new HttpError(pruefung.status, pruefung.fehler);
  const neu = pruefung.email;

  // Schon vergeben? (Groß-/Kleinschreibung egal.) Erst prüfen, dann ändern.
  const { data: belegt, error: belegtErr } = await admin
    .from('app_users').select('id').ilike('email', likeExakt(neu)).neq('id', userId).limit(1);
  if (belegtErr) throw new HttpError(500, `Prüfung fehlgeschlagen: ${belegtErr.message}`);
  if ((belegt ?? []).length > 0) {
    throw new HttpError(409, `Die Adresse ${neu} wird bereits von einem anderen Konto verwendet. Es wurde nichts geändert.`);
  }

  // 1) Login. email_confirm: der Admin bestätigt die Adresse — sonst
  //    verschickte Supabase eine Bestätigungsmail und der Login stünde
  //    bis zum Klick still.
  const { error: authErr } = await admin.auth.admin.updateUserById(userId, { email: neu, email_confirm: true });
  if (authErr) {
    const m = authErr.message ?? '';
    if (/already|exists|registered/i.test(m)) {
      throw new HttpError(409, `Die Adresse ${neu} ist bereits für ein anderes Login registriert. Es wurde nichts geändert.`);
    }
    throw new HttpError(500, `Login-Adresse konnte nicht geändert werden: ${m}`);
  }

  // 2) Spiegel. Scheitert das, den Login zurückdrehen — sonst liefen
  //    Login und Zustelladresse auseinander.
  const { error: appErr } = await admin.from('app_users').update({ email: neu }).eq('id', userId);
  if (appErr) {
    await admin.auth.admin.updateUserById(userId, { email: alt, email_confirm: true });
    throw new HttpError(500, `Profil-Adresse konnte nicht gespeichert werden (Login zurückgesetzt): ${appErr.message}`);
  }

  // 3) Empfänger-Adressbuch: alter Eintrag → neue Adresse (Duplikat vermeiden).
  let adressbuch = 0;
  try {
    const { data: favAlt } = await admin.from('email_favoriten').select('id').ilike('email', likeExakt(normalisiereEmail(alt)));
    if ((favAlt ?? []).length > 0) {
      const { data: favNeu } = await admin.from('email_favoriten').select('id').ilike('email', likeExakt(neu)).limit(1);
      if ((favNeu ?? []).length > 0) {
        await admin.from('email_favoriten').delete().in('id', (favAlt ?? []).map((f) => f.id));
      } else {
        await admin.from('email_favoriten').update({ email: neu }).in('id', (favAlt ?? []).map((f) => f.id));
      }
      adressbuch = (favAlt ?? []).length;
    }
  } catch (e) {
    console.warn('[api/account change-email] Adressbuch nicht aktualisiert', e);
  }

  // 4) Info-Mail an die NEUE Adresse — so fällt ein Tippfehler sofort auf.
  //    Scheitert sie, bleibt die Änderung trotzdem gültig.
  let infoMail = 'gesendet';
  try {
    const name = [ziel.vorname, ziel.nachname].filter(Boolean).join(' ').trim();
    await sendMail({
      to: [neu],
      subject: 'Ihre Anmeldeadresse für das Maja-Logistik Fahrerportal wurde geändert',
      bodyText:
        `${name ? `Hallo ${name},` : 'Hallo,'}\n\n`
        + 'Ihre Anmeldeadresse für das Maja-Logistik Fahrerportal wurde geändert.\n\n'
        + `Neue Adresse: ${neu}\n`
        + 'Ihr Passwort bleibt unverändert. Bitte melden Sie sich ab sofort mit der neuen Adresse an.\n\n'
        + 'Falls Sie diese Änderung nicht erwartet haben, wenden Sie sich bitte an Maja-Logistik.\n',
    });
  } catch (e) {
    infoMail = `fehler: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300);
    console.warn('[api/account change-email] Info-Mail fehlgeschlagen', e);
  }

  // 5) Protokoll.
  const { data: ich } = await admin.from('app_users').select('email, vorname, nachname').eq('id', caller.id).maybeSingle();
  const ichName = ich ? ([ich.vorname, ich.nachname].filter(Boolean).join(' ').trim() || ich.email) : null;
  const { error: logErr } = await admin.from('konto_email_aenderungen').insert({
    user_id: userId, alte_email: alt, neue_email: neu,
    geaendert_von: caller.id, geaendert_von_name: ichName,
    info_mail: infoMail, adressbuch_eintraege: adressbuch,
  });
  if (logErr) console.warn('[api/account change-email] Protokoll nicht geschrieben', logErr.message);

  res.status(200).json({ ok: true, alteEmail: alt, neueEmail: neu, infoMail, protokolliert: !logErr });
}
