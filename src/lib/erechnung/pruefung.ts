// Pflichtfeld-Prüfung für die E-Rechnung.
//
// Liefert eine Liste fehlender/ungültiger Angaben, bevor eine Datei
// erzeugt wird. Bezieht sich auf EN 16931 und — beim Profil
// 'xrechnung' — zusätzlich auf die XRechnung-Regeln (BR-DE-*). Die
// verbindliche Prüfung bleibt der KoSIT-Validator; diese Liste soll die
// häufigsten Lücken vorher verständlich benennen.

import type { ERechnungDaten, ERechnungProfil } from './typen';

export interface Mangel {
  /** Bezug in der Norm (BT-/BG-Nummer bzw. Regel). */
  bt: string;
  text: string;
  /** fehler = blockiert die Erzeugung (Phase 1b), warnung = prüfen, hinweis = Info. */
  schwere: 'fehler' | 'warnung' | 'hinweis';
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const leer = (v: string | null | undefined) => !v || !v.trim();

/** Ganzzahlige Cent-Rechnung — dient nur der KONTROLLE der übergebenen Summen. */
function cent(n: number): number { return Math.round(n * 100); }
function ustCent(nettoCent: number, satz: number): number {
  const bp = Math.round(satz * 100); // Basispunkte (19 % → 1900)
  const roh = Math.abs(nettoCent) * bp;
  const q = Math.floor((roh + 5000) / 10000); // kaufmännisch runden
  return nettoCent < 0 ? -q : q;
}

export function pruefeERechnung(d: ERechnungDaten, profil: ERechnungProfil = 'xrechnung'): Mangel[] {
  const m: Mangel[] = [];
  const xr = profil === 'xrechnung';
  const add = (bt: string, text: string, schwere: Mangel['schwere'] = 'fehler') => m.push({ bt, text, schwere });

  // ---- Rechnung ----
  if (leer(d.nummer)) add('BT-1', 'Rechnungsnummer fehlt');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.datum ?? '')) add('BT-2', 'Rechnungsdatum fehlt oder ist ungültig');
  if (d.faelligAm == null && d.zahlungszielTage == null && d.summen.brutto > 0) {
    add('BT-9/BT-20', 'Fälligkeitsdatum bzw. Zahlungsziel fehlt');
  }
  if (!d.leistungVon && !d.leistungBis) add('BG-14', 'Leistungszeitraum fehlt', 'warnung');
  if (leer(d.kaeuferReferenz)) {
    add('BT-10', xr ? 'Käuferreferenz fehlt (Pflicht bei XRechnung)' : 'Käuferreferenz fehlt', xr ? 'fehler' : 'hinweis');
  }

  // ---- Verkäufer (eigene Firmendaten) ----
  const v = d.verkaeufer;
  if (leer(v.name)) add('BT-27', 'Name des Absenders fehlt');
  if (leer(v.strasse)) add('BT-35', 'Straße des Absenders fehlt', 'warnung');
  if (leer(v.plz)) add('BT-38', 'PLZ des Absenders fehlt');
  if (leer(v.ort)) add('BT-37', 'Ort des Absenders fehlt');
  if (!/^[A-Z]{2}$/.test(v.landCode ?? '')) add('BT-40', 'Ländercode des Absenders fehlt');
  if (leer(v.ustId) && leer(v.steuernummer)) add('BT-31/BT-32', 'USt-IdNr. bzw. Steuernummer des Absenders fehlt');
  if (leer(v.iban)) add('BT-84', 'IBAN des Absenders fehlt');
  if (leer(v.kontaktName)) add('BT-41', xr ? 'Kontaktname des Absenders fehlt (Pflicht bei XRechnung)' : 'Kontaktname des Absenders fehlt', xr ? 'fehler' : 'hinweis');
  if (leer(v.telefon)) add('BT-42', 'Telefon des Absenders fehlt', xr ? 'fehler' : 'hinweis');
  if (leer(v.email)) add('BT-43', 'E-Mail des Absenders fehlt', xr ? 'fehler' : 'hinweis');
  if (leer(v.elektronischeAdresse)) add('BT-34', 'Elektronische Adresse des Absenders fehlt', xr ? 'fehler' : 'hinweis');

  // ---- Käufer ----
  const k = d.kaeufer;
  if (leer(k.name)) add('BT-44', 'Name des Empfängers fehlt');
  if (leer(k.strasse)) add('BT-50', 'Straße des Empfängers fehlt', 'warnung');
  if (leer(k.plz)) add('BT-53', 'PLZ des Empfängers fehlt', xr ? 'fehler' : 'warnung');
  else if (k.landCode === 'DE' && !/^\d{5}$/.test(k.plz!.trim())) add('BT-53', `PLZ des Empfängers „${k.plz}" ist keine 5-stellige deutsche PLZ`, 'warnung');
  if (leer(k.ort)) add('BT-52', 'Ort des Empfängers fehlt', xr ? 'fehler' : 'warnung');
  if (leer(k.landCode)) add('BT-55', 'Ländercode des Empfängers fehlt');
  else if (!/^[A-Z]{2}$/.test(k.landCode!)) add('BT-55', `Ländercode des Empfängers „${k.landCode}" ist kein ISO-Code`);
  if (leer(k.elektronischeAdresse)) {
    add('BT-49', xr ? 'E-Rechnungs-Adresse fehlt (Pflicht bei XRechnung)' : 'E-Rechnungs-Adresse fehlt', xr ? 'fehler' : 'hinweis');
  } else if (!EMAIL.test(k.elektronischeAdresse!.trim())) {
    add('BT-49', `E-Rechnungs-Adresse „${k.elektronischeAdresse}" ist keine gültige E-Mail-Adresse`);
  }

  // ---- Positionen ----
  if (d.positionen.length === 0) add('BG-25', 'Die Rechnung hat keine Positionen');
  for (const p of d.positionen) {
    const pos = `Position ${p.nr}`;
    if (leer(p.bezeichnung)) add('BT-153', `${pos}: Bezeichnung fehlt`);
    if (p.einzelpreis < 0) add('BT-146', `${pos}: negativer Einzelpreis ist nicht zulässig (BR-27)`);
    if (!/^[A-Z0-9]{1,3}$/.test(p.einheitCode)) add('BT-130', `${pos}: Einheit „${p.einheitCode}" ist kein UN/ECE-Code`);
    if (p.kategorie !== 'S' || !(p.ustSatz > 0)) add('BT-151', `${pos}: Steuerkategorie/Satz (${p.ustSatz} %) noch nicht freigegeben (Fragen S3/S4)`);
    if (cent(p.menge * p.einzelpreis) !== cent(p.netto)) {
      add('BT-131', `${pos}: Menge × Einzelpreis (${(p.menge * p.einzelpreis).toFixed(2)}) ≠ Gesamtpreis (${p.netto.toFixed(2)})`, 'warnung');
    }
  }

  // ---- Summen: Kontrolle der übergebenen Werte in ganzen Cent ----
  const jeSatz = new Map<number, number>();
  for (const p of d.positionen) jeSatz.set(p.ustSatz, (jeSatz.get(p.ustSatz) ?? 0) + cent(p.netto));
  let nettoC = 0; let ustC = 0;
  for (const g of d.summen.gruppen) {
    const n = jeSatz.get(g.satz) ?? 0;
    const u = ustCent(n, g.satz);
    nettoC += n; ustC += u;
    if (cent(g.netto) !== n || cent(g.ust) !== u) {
      add('BR-CO-17', `Rundungsabweichung bei ${g.satz} %: berechnet ${(n / 100).toFixed(2)} / ${(u / 100).toFixed(2)}, übergeben ${g.netto.toFixed(2)} / ${g.ust.toFixed(2)}`);
    }
  }
  if (cent(d.summen.netto) !== nettoC || cent(d.summen.ust) !== ustC || cent(d.summen.brutto) !== nettoC + ustC) {
    add('BR-CO-15', 'Summen der Rechnung passen nicht zu den Positionen');
  }

  // ---- Hinweis Kleinbetrag ----
  if (d.summen.brutto > 0 && d.summen.brutto <= 250) {
    add('§33 UStDV', 'Kleinbetragsrechnung (≤ 250 € brutto) — ob E-Rechnung oder PDF: Frage S6', 'hinweis');
  }
  return m;
}

export function hatFehler(m: Mangel[]): boolean {
  return m.some((x) => x.schwere === 'fehler');
}
