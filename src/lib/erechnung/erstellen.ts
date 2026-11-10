// E-Rechnung erzeugen — Ablauf im Browser (Phase 1b).
//
// Rechnung (Entwurf → erstellt), nur bei Empfängern mit E-Rechnungs-Format:
//   1. Vorprüfung (Pflichtfelder je Format) — Fehler blockieren, die
//      Rechnung bleibt Entwurf.
//   2. Status → offen. Die Datenbank hält dabei fest: Firmendaten-Snapshot,
//      Format/Referenz/Adresse, Fälligkeit, Leistungsdatum je Position.
//   3. XML + PDF-Lesekopie aus GENAU diesem Stand (frisch geladen) erzeugen,
//      erneut prüfen und auf dem Server archivieren (OneDrive ohne
//      Überschreiben, Supabase-Bucket, SHA-256, erechnung_dokumente).
//   4. Scheitert 3: Rechnung zurück auf Entwurf (Snapshot/Fälligkeit
//      geleert) — es entsteht nie eine „erstellte" E-Rechnungs-Rechnung
//      ohne archivierte E-Rechnung.
// Empfänger mit „PDF (wie bisher)": nur Schritt 2, genau wie bisher.

import { supabase } from '../supabase';
import { ladeAbsenderBilder } from '../absenderSignatur';
import { firmendatenFuerBeleg } from '../firmendaten';
import { archiviereERechnungApi, type ERechnungDokument } from '../onedrive';
import { loadGutschriftSettings } from '../gutschriftSettings';
import { generateRechnungPdf } from '../../pages/admin/rechnungen/rechnungPdf';
import {
  bildeERechnung, bildeERechnungGutschrift, ladeERechnungQuelle, ladeGutschriftQuelle, type Abbildung,
} from './ausRechnung';
import { erzeugeCii, pruefeUnterstuetzt } from './cii';
import { hatFehler, pruefeERechnung, type Mangel } from './pruefung';
import { profilFuerFormat } from './stammdaten';
import { gutschriftPdfInputAus, rechnungPdfInputAus } from './belegPdf';
import { ERechnungAbbruch, type ERechnungProfil } from './typen';

export interface Vorpruefung {
  format: string;
  profil: ERechnungProfil;
  maengel: Mangel[];
  /** Grund, warum (noch) keine E-Rechnung möglich ist (z.B. 0 %). */
  abbruch: string | null;
}

export type ErstellErgebnis =
  | { art: 'pdf' }
  | { art: 'blockiert'; vorpruefung: Vorpruefung }
  | { art: 'erechnung'; dokument: ERechnungDokument; maengel: Mangel[] }
  | { art: 'fehler'; meldung: string };

function pruefen(a: Abbildung, profil: ERechnungProfil): { maengel: Mangel[]; abbruch: string | null } {
  const maengel = [...a.hinweise, ...pruefeERechnung(a.daten, profil)];
  let abbruch = a.abbruch;
  if (!abbruch) {
    try { pruefeUnterstuetzt(a.daten); } catch (e) { abbruch = e instanceof ERechnungAbbruch ? e.message : String(e); }
  }
  return { maengel, abbruch };
}

/** Prüft eine Rechnung (Entwurf) vor dem Erstellen. null = PDF-Empfänger. */
export async function erechnungVorpruefung(rechnungId: string): Promise<Vorpruefung | null> {
  const q = await ladeERechnungQuelle(rechnungId);
  const r = q.rechnung;
  const format = (r.empfaenger_typ === 'manuell' ? r.erechnung_format : q.auftraggeber?.erechnung_format) ?? 'pdf';
  const profil = profilFuerFormat(format);
  if (!profil) return null;
  const { firma } = await firmendatenFuerBeleg(r.absender_snapshot);
  const a = bildeERechnung(q, { firma });
  return { format, profil, ...pruefen(a, profil) };
}

/**
 * XML + PDF aus dem gespeicherten Stand einer ERSTELLTEN Rechnung erzeugen
 * und archivieren. Auch als Nachholen nutzbar, falls eine Rechnung „offen"
 * ist, aber (noch) keine archivierte E-Rechnung hat. Wiederholbar: der
 * Server übernimmt identische Dateien und überschreibt nie.
 */
export async function rechnungERechnungErzeugen(rechnungId: string): Promise<{ dokument: ERechnungDokument; maengel: Mangel[] }> {
  const q = await ladeERechnungQuelle(rechnungId);
  const r = q.rechnung;
  const profil = profilFuerFormat(r.erechnung_format);
  if (!profil) throw new Error('Die Rechnung hat kein E-Rechnungs-Format.');
  const { firma, ausSnapshot } = await firmendatenFuerBeleg(r.absender_snapshot);
  if (!ausSnapshot) throw new Error('Firmendaten-Snapshot fehlt (Migration 116?).');
  const a = bildeERechnung(q, { firma });
  const { maengel, abbruch } = pruefen(a, profil);
  if (abbruch) throw new Error(abbruch);
  if (hatFehler(maengel)) throw new Error(maengel.filter((m) => m.schwere === 'fehler').map((m) => m.text).join('; '));
  const xml = erzeugeCii(a.daten, profil);
  const bilder = await ladeAbsenderBilder({ mitUnterschrift: r.mit_unterschrift ?? true, mitStempel: r.mit_stempel ?? true });
  const pdf = await generateRechnungPdf(rechnungPdfInputAus({
    rechnung: r, positionen: q.positionen, auftraggeber: q.auftraggeber,
    firma, ausSnapshot, erechnung: a.daten, bilder,
  }));
  const dokument = await archiviereERechnungApi('rechnung', rechnungId, xml, pdf);
  return { dokument, maengel };
}

/**
 * Rechnung erstellen (Entwurf → offen) — für alle Empfänger. PDF-
 * Empfänger: nur der Statuswechsel wie bisher. E-Rechnungs-Empfänger:
 * Vorprüfung, Statuswechsel, Erzeugung + Archiv; bei Fehlern zurück
 * auf Entwurf.
 */
export async function rechnungErstellen(rechnungId: string): Promise<ErstellErgebnis> {
  const vp = await erechnungVorpruefung(rechnungId);
  if (vp && (vp.abbruch || hatFehler(vp.maengel))) return { art: 'blockiert', vorpruefung: vp };

  const { error } = await supabase.from('rechnungen').update({ status: 'offen' }).eq('id', rechnungId);
  if (error) return { art: 'fehler', meldung: error.message };
  if (!vp) return { art: 'pdf' };

  try {
    const { dokument, maengel } = await rechnungERechnungErzeugen(rechnungId);
    return { art: 'erechnung', dokument, maengel };
  } catch (e) {
    const grund = (e instanceof Error ? e.message : String(e)).replace(/^ERECHNUNG_BEREITS_ARCHIVIERT:\s*/, '');
    // Antwort verloren, aber doch archiviert? Dann gilt sie als erzeugt.
    const schon = await ladeERechnungDokumente('rechnung', rechnungId);
    if (schon.length) return { art: 'erechnung', dokument: schon[0], maengel: [] };
    // Zurück auf Entwurf — die Rechnungsnummer bleibt an der Rechnung
    // (keine Lücke, keine Doppelvergabe).
    const { error: rErr } = await supabase.from('rechnungen')
      .update({ status: 'entwurf', faellig_am: null, absender_snapshot: null }).eq('id', rechnungId);
    if (rErr) {
      if (/ERECHNUNG_GESPERRT/.test(rErr.message)) {
        const dok = await ladeERechnungDokumente('rechnung', rechnungId);
        if (dok.length) return { art: 'erechnung', dokument: dok[0], maengel: [] };
      }
      return { art: 'fehler', meldung:
        `Was ist passiert: Die E-Rechnung konnte nicht abgelegt werden (${grund}). Die Rechnung ließ sich auch nicht auf „Entwurf" zurücksetzen (${rErr.message}) — `
        + 'sie ist jetzt „offen", aber ohne archivierte E-Rechnung. Was tun: im Abschnitt „E-Rechnung" auf „E-Rechnung erzeugen" klicken (erneut versuchen). Es wird nichts überschrieben oder doppelt abgelegt.' };
    }
    return { art: 'fehler', meldung:
      `Was ist passiert: Die E-Rechnung konnte nicht abgelegt werden (${grund}). Die Rechnung ist wieder ein Entwurf und behält ihre Nummer. `
      + 'Was tun: „Rechnung erstellen" erneut versuchen. Bereits abgelegte Dateien werden übernommen; nichts wird überschrieben oder doppelt abgelegt.' };
  }
}

/** Storno/Teilgutschrift (final) als E-Rechnung (381) erzeugen und archivieren. */
export async function gutschriftERechnungErzeugen(gutschriftId: string): Promise<{ dokument: ERechnungDokument; maengel: Mangel[] }> {
  const q = await ladeGutschriftQuelle(gutschriftId);
  const g = q.gutschrift;
  const profil = profilFuerFormat(g.erechnung_format);
  if (!profil) throw new Error('Der Empfänger hat kein E-Rechnungs-Format.');
  const { firma, ausSnapshot } = await firmendatenFuerBeleg(g.absender_snapshot);
  if (!ausSnapshot) throw new Error('Firmendaten-Snapshot fehlt — Beleg zuerst finalisieren.');
  const a = bildeERechnungGutschrift(q, { firma });
  const { maengel, abbruch } = pruefen(a, profil);
  if (abbruch) throw new Error(abbruch);
  if (hatFehler(maengel)) throw new Error(maengel.filter((m) => m.schwere === 'fehler').map((m) => m.text).join('; '));
  const xml = erzeugeCii(a.daten, profil);
  const cfg = await loadGutschriftSettings();
  const bilder = await ladeAbsenderBilder({ mitUnterschrift: g.mit_unterschrift ?? true, mitStempel: g.mit_stempel ?? true });
  const pdf = await generateRechnungPdf(gutschriftPdfInputAus({
    gutschrift: g, positionen: q.positionen, auftraggeber: q.auftraggeber,
    firma, ausSnapshot, erechnung: a.daten, bilder,
    dokumentbezeichnung: cfg.dokumentbezeichnung, summenLabel: cfg.summen_label,
  }));
  const dokument = await archiviereERechnungApi('gutschrift', gutschriftId, xml, pdf);
  return { dokument, maengel };
}

/** Vorprüfung einer Storno/Teilgutschrift (Entwurf oder final). null = PDF-Empfänger. */
export async function gutschriftVorpruefung(gutschriftId: string): Promise<Vorpruefung | null> {
  const q = await ladeGutschriftQuelle(gutschriftId);
  const g = q.gutschrift;
  if (g.art !== 'storno' && g.art !== 'teilgutschrift') return null;
  const profil = profilFuerFormat(g.erechnung_format);
  if (!profil) return null;
  const { firma } = await firmendatenFuerBeleg(g.absender_snapshot);
  const a = bildeERechnungGutschrift(q, { firma });
  return { format: g.erechnung_format ?? 'pdf', profil, ...pruefen(a, profil) };
}

export async function ladeERechnungDokumente(beleg: 'rechnung' | 'gutschrift', id: string): Promise<ERechnungDokument[]> {
  const { data, error } = await supabase.from('erechnung_dokumente')
    .select('*').eq(beleg === 'rechnung' ? 'rechnung_id' : 'gutschrift_id', id)
    .order('version', { ascending: false });
  if (error) { console.warn('[erechnung_dokumente]', error.message); return []; }
  return (data ?? []) as unknown as ERechnungDokument[];
}

/** Text für Sperr-Hinweise in der Oberfläche. */
export const SPERR_HINWEIS = 'E-Rechnung erstellt — Änderung nur über Storno/Teilgutschrift';

/** Fehlermeldungen der Sperr-Trigger verständlich machen. */
export function sperrMeldung(msg: string): string {
  if (/ERECHNUNG_GESPERRT/.test(msg)) return `${SPERR_HINWEIS}.`;
  if (/STORNIERT:/.test(msg)) return 'Die Rechnung ist storniert und kann nicht mehr geändert werden.';
  if (/STORNO_BEZUG/.test(msg)) return 'Zu dieser Rechnung gibt es eine Stornorechnung/Teilgutschrift — sie kann nicht gelöscht werden.';
  return msg;
}
