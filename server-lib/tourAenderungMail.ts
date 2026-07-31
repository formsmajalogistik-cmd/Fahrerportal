// Info-Mail an den Admin, wenn ein Auftraggeber eine BEREITS BESTÄTIGTE
// Tour geändert hat (Migration 079).
//
// Sicherheitsprinzip: Der Client schickt NUR die Tour-ID. Empfänger,
// Betreff und Inhalt entstehen hier aus der Datenbank — und erst,
// nachdem geprüft wurde, dass die Tour dem aufrufenden Auftraggeber
// gehört. Damit ist der Endpoint weder als Versand-Relais noch zur
// Informationsbeschaffung über fremde Touren nutzbar.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from './auth.js';

function serviceClient(): SupabaseClient {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new HttpError(500, 'Supabase-Server-Env fehlt (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY)');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Spaltenname → Anzeigename; Spiegel von src/lib/tourAenderungen.ts. */
const FELD_LABEL: Record<string, string> = {
  start_stadt: 'Start-Stadt',
  ziel_stadt: 'Ziel-Stadt',
  rueckfuehrung_stadt: 'Rückführung-Stadt',
  adresse_start: 'Adresse Start',
  adresse_ziel: 'Adresse Ziel',
  adresse_rueckfuehrung: 'Adresse Rückführung',
  kontakt_start: 'Kontakt Start',
  kontakt_ziel: 'Kontakt Ziel',
  kontakt_rueckfuehrung: 'Kontakt Rückführung',
  kennzeichen: 'Kennzeichen',
  fin: 'FIN',
  fin_rueck: 'FIN Rückführung',
  kundenname: 'Kundenname',
  startdatum: 'Startdatum',
  enddatum: 'Enddatum',
  tourenart: 'Tourenart',
  ist_e_fahrzeug: 'E-Fahrzeug',
  info: 'Hinweise',
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface TourAenderungMail {
  /** Empfänger + Absender (beide aus app_settings). */
  to: string[];
  from: string | undefined;
  subject: string;
  bodyHtml: string;
}

/**
 * Baut die Meldung. Gibt `null` zurück, wenn nichts zu melden ist
 * (Tour nicht bestätigt, keine offenen Änderungen) — der Aufrufer
 * antwortet dann einfach mit "nichts gesendet".
 *
 * Wirft 403, wenn die Tour nicht zum Auftraggeber des Aufrufers gehört.
 */
export async function buildTourAenderungMail(args: {
  userId: string;
  role: string | null;
  tourId: string;
}): Promise<TourAenderungMail | null> {
  const supa = serviceClient();

  // 1. Auftraggeber des Aufrufers bestimmen. Admins dürfen ebenfalls
  //    auslösen (z.B. beim Nachtesten), aber ohne AG-Bindung.
  let agId: string | null = null;
  if (args.role === 'auftraggeber') {
    const { data: profil } = await supa
      .from('app_users').select('auftraggeber_id').eq('id', args.userId).maybeSingle();
    agId = (profil?.auftraggeber_id as string | null) ?? null;
    if (!agId) throw new HttpError(403, 'Kein Auftraggeber zugeordnet');
  } else if (args.role !== 'admin') {
    throw new HttpError(403, 'Keine Berechtigung');
  }

  // 2. Tour laden und Eigentum prüfen.
  const { data: tour } = await supa
    .from('touren')
    .select('id, tour_id, start_stadt, ziel_stadt, rueckfuehrung_stadt, startdatum, enddatum, bestaetigt, auftraggeber_id')
    .eq('id', args.tourId)
    .maybeSingle();
  if (!tour) throw new HttpError(404, 'Tour nicht gefunden');
  if (agId && tour.auftraggeber_id !== agId) {
    throw new HttpError(403, 'Tour gehört nicht zu Ihrem Konto');
  }
  // Gemeldet wird nur bei bestätigten Touren — bei unbestätigten reicht
  // der Bereich "Änderungen durch Auftraggeber" in der Tourenliste.
  if (!tour.bestaetigt) return null;

  // 3. Offene Änderungen der letzten Minuten — das ist der Vorgang, der
  //    gerade gespeichert wurde.
  const { data: aenderungen } = await supa
    .from('tour_aenderungen')
    .select('feld, wert_alt, wert_neu, geaendert_am')
    .eq('tour_id', args.tourId)
    .is('gesehen_am', null)
    .order('geaendert_am', { ascending: false })
    .limit(50);
  const liste = (aenderungen ?? []) as Array<{
    feld: string; wert_alt: string | null; wert_neu: string | null;
  }>;
  if (liste.length === 0) return null;

  // 4. Name des Auftraggebers für den Betreff.
  let agName = '';
  if (tour.auftraggeber_id) {
    const { data: ag } = await supa
      .from('auftraggeber').select('name').eq('id', tour.auftraggeber_id).maybeSingle();
    agName = (ag?.name as string | null) ?? '';
  }

  // 5. Absender/Empfänger aus app_settings (mail_inbox_1 = info@).
  const { data: setting } = await supa
    .from('app_settings').select('value').eq('key', 'mail_inbox_1').maybeSingle();
  const infoAdresse = ((setting?.value as { address?: string } | null)?.address ?? '').trim();
  if (!infoAdresse) return null;

  const nr = tour.tour_id ? `Tour ${tour.tour_id}` : 'Tour';
  const route = [tour.start_stadt, tour.ziel_stadt, tour.rueckfuehrung_stadt]
    .filter(Boolean).join(' → ');

  const zeilen = liste.map((a) => (
    `<li style="margin-bottom:4px">`
    + `<strong>${escapeHtml(FELD_LABEL[a.feld] ?? a.feld)}:</strong> `
    + `${escapeHtml(a.wert_alt ?? '—')} &rarr; ${escapeHtml(a.wert_neu ?? '—')}`
    + `</li>`
  )).join('');

  const bodyHtml =
    `<p>Ein Auftraggeber hat eine <strong>bereits bestätigte</strong> Tour geändert.</p>`
    + `<p><strong>${escapeHtml(nr)}</strong> — ${escapeHtml(route)}<br>`
    + `Zeitraum: ${escapeHtml(String(tour.startdatum ?? ''))} bis ${escapeHtml(String(tour.enddatum ?? ''))}<br>`
    + (agName ? `Auftraggeber: ${escapeHtml(agName)}` : '')
    + `</p>`
    + `<p>Geänderte Felder:</p><ul>${zeilen}</ul>`
    + '<p>Die Tour bleibt bestätigt. Bitte prüfen, ob km oder Preis angepasst '
    + 'werden müssen — quittieren lässt sich die Meldung in der Tourenliste.</p>';

  return {
    to: [infoAdresse],
    from: infoAdresse,
    subject: `Tour geändert: ${nr}${agName ? ` (${agName})` : ''}`,
    bodyHtml,
  };
}
