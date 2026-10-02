// Formular auf ein anderes Template übertragen — die Zuordnungslogik.
//
// Rein rechnend (keine Supabase-/DOM-Abhängigkeit), damit jede Regel
// prüfbar ist. Die Oberfläche (FormularUebertragenDialog) zeigt an, was
// hier berechnet wird; geschrieben wird über die RPC aus Migration 101.
//
// Grundsatz: Vorschläge sind nur Vorschläge. Nichts wandert, ohne dass der
// Admin die Zuordnung bestätigt — und was verloren ginge, steht vorher in
// der Zusammenfassung.

import type { FieldType, FormField, FormSchema } from '../types/db';

export type QuellTyp = FieldType | 'unbekannt';

export interface QuellZeile {
  id: string;
  label: string;
  typ: QuellTyp;
  feld: FormField | null;
  wert: unknown;
  leer: boolean;
}

/** Sicherer Treffer, unsicherer Vorschlag, aus gemerkter Zuordnung, nichts. */
export type Sicherheit = 'sicher' | 'unsicher' | 'gemerkt' | 'keiner' | 'manuell';

export interface ZuordnungEintrag { ziel: string | null; sicherheit: Sicherheit }
export type Zuordnung = Record<string, ZuordnungEintrag>;

/** Ersatzwerte für Auswahl-Werte, die es im Zielfeld nicht gibt: quellWert → zielOption ('' = weglassen). */
export type OptionsErsatz = Record<string, Record<string, string>>;

// ---------------------------------------------------------------
// Werte lesen und anzeigen
// ---------------------------------------------------------------

/** Interne Schlüssel im Formularstand, die NICHT übertragen werden. */
const NICHT_UEBERTRAGEN = (k: string) => k === '_touched' || k.startsWith('_slider_');

export function istLeer(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('storage_path' in o || 'pending_id' in o) return !o.storage_path && !o.pending_id;
    return Object.values(o).every((x) => istLeer(x));
  }
  return false;
}

function alleFelder(schema: FormSchema | null | undefined): FormField[] {
  const out: FormField[] = [];
  for (const s of schema?.sections ?? []) for (const f of s.fields ?? []) if (f?.id) out.push(f);
  return out;
}

/**
 * Eine Zeile je Feld des alten Templates (in Schema-Reihenfolge), dazu
 * Werte im Formularstand, zu denen es kein Feld mehr gibt (z.B. nach
 * einer Template-Änderung) — auch die sollen nicht still verschwinden.
 */
export function quellZeilen(schema: FormSchema | null | undefined, daten: Record<string, unknown>): QuellZeile[] {
  const felder = alleFelder(schema);
  const bekannt = new Set(felder.map((f) => f.id));
  const zeilen: QuellZeile[] = felder.map((f) => ({
    id: f.id, label: f.label || f.id, typ: f.type, feld: f, wert: daten[f.id], leer: istLeer(daten[f.id]),
  }));
  for (const [k, v] of Object.entries(daten ?? {})) {
    if (k.startsWith('_') || bekannt.has(k)) continue;
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    zeilen.push({ id: k, label: `${k} (ohne Feld im Template)`, typ: 'unbekannt', feld: null, wert: v, leer: istLeer(v) });
  }
  return zeilen;
}

const DE_DATUM = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(iso);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}`;
};

function adressText(v: unknown): string {
  const a = (v ?? {}) as { strasse?: string; plz?: string; stadt?: string };
  const ort = [a.plz, a.stadt].map((x) => (x ?? '').trim()).filter(Boolean).join(' ');
  return [(a.strasse ?? '').trim(), ort].filter(Boolean).join(', ');
}

/** Lesbare Kurzform eines Werts — für Vergleichsansicht, Zusammenfassung und Verlauf. */
export function wertAnzeige(typ: QuellTyp, v: unknown): string {
  if (istLeer(v)) return '';
  switch (typ) {
    case 'date': return DE_DATUM(String(v));
    case 'number': return typeof v === 'number' ? v.toLocaleString('de-DE') : String(v);
    case 'checkboxes': return Array.isArray(v) ? v.join(', ') : String(v);
    case 'checkboxes_with_text':
      return Array.isArray(v)
        ? v.map((e) => { const x = e as { option?: string; text?: string };
            return x.text ? `${x.option}: ${x.text}` : String(x.option ?? ''); }).join('; ')
        : '';
    case 'address': return adressText(v);
    case 'photo': return 'Foto';
    case 'stamp': return 'Stempel';
    case 'signature': return 'Unterschrift';
    case 'dynamic_photos': { const n = Array.isArray(v) ? v.length : 0; return n === 1 ? '1 Foto' : `${n} Fotos`; }
    case 'damage_diagram': return diagrammPunkteText(v);
    default: return String(v);
  }
}

/** Schadenpunkte als Text: „3 Punkte: K (25 %, 40 %); D (75 %, 60 %); …". */
export function diagrammPunkteText(v: unknown): string {
  const punkte = Array.isArray(v) ? v as Array<{ x?: number; y?: number; kind?: string }> : [];
  if (punkte.length === 0) return '';
  const r = (n: number | undefined) => Math.round(n ?? 0);
  const liste = punkte.map((p) => `${p.kind ?? '?'} (${r(p.x)} %, ${r(p.y)} %)`).join('; ');
  return `${punkte.length} ${punkte.length === 1 ? 'Punkt' : 'Punkte'}: ${liste}`;
}

// ---------------------------------------------------------------
// Ähnlichkeit und Vorschläge
// ---------------------------------------------------------------

/** Label vergleichbar machen: Groß/klein, Umlaute, Leer- und Satzzeichen egal. */
export function normLabel(s: string): string {
  return s.toLowerCase()
    .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function bigramme(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) { const b = s.slice(i, i + 2); m.set(b, (m.get(b) ?? 0) + 1); }
  return m;
}

/** Dice-Koeffizient über Zeichenpaare (0 … 1). */
export function aehnlichkeit(a: string, b: string): number {
  const x = normLabel(a), y = normLabel(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const bx = bigramme(x), by = bigramme(y);
  let gemeinsam = 0;
  for (const [k, n] of bx) gemeinsam += Math.min(n, by.get(k) ?? 0);
  return (2 * gemeinsam) / (x.length - 1 + y.length - 1);
}

const AEHNLICH_AB = 0.55;

/**
 * Darf ein Wert vom Typ `q` überhaupt in ein Feld vom Typ `z`? Ob er
 * im Einzelfall passt (Zahl lesbar, Option vorhanden), prüft umwandeln().
 */
export function kompatibel(q: QuellTyp, z: FieldType): boolean {
  const textartig: QuellTyp[] = ['text', 'textarea', 'unbekannt'];
  switch (z) {
    case 'text': case 'textarea':
      return [...textartig, 'number', 'date', 'select', 'checkboxes', 'checkboxes_with_text', 'address'].includes(q);
    case 'number': return [...textartig, 'number', 'select'].includes(q);
    case 'date': return [...textartig, 'date'].includes(q);
    case 'select': return [...textartig, 'select', 'checkboxes'].includes(q);
    case 'checkboxes': return ['checkboxes', 'select', 'checkboxes_with_text'].includes(q);
    case 'checkboxes_with_text': return ['checkboxes_with_text', 'checkboxes'].includes(q);
    case 'address': return q === 'address';
    // Bilder nur auf die gleiche Bildart — Mehrfach-Fotos nur auf Mehrfach-Fotos.
    case 'photo': return q === 'photo';
    case 'signature': return q === 'signature';
    case 'stamp': return q === 'stamp';
    case 'dynamic_photos': return q === 'dynamic_photos';
    case 'damage_diagram': return q === 'damage_diagram';
    default: return false;
  }
}

/** Zielfelder, die für diese Quellzeile im Dropdown angeboten werden. */
export function passendeZiele(q: QuellZeile, zielSchema: FormSchema): FormField[] {
  return alleFelder(zielSchema).filter((z) => kompatibel(q.typ, z.type));
}

/**
 * Automatische Vorschläge, in dieser Reihenfolge:
 *   0. gemerkte Zuordnung für dieses Template-Paar
 *   1. gleicher Feld-Key            → sicher
 *   2. gleiches Label (normalisiert) → sicher
 *   3. ähnliches Label + gleicher Typ → unsicher (gelb)
 *   4. sonst                          → verwerfen
 * Jedes Zielfeld wird höchstens einmal vorgeschlagen; sichere Treffer
 * haben Vorrang vor unsicheren.
 */
export function vorschlagen(
  quellen: QuellZeile[],
  zielSchema: FormSchema,
  gemerkt?: Record<string, string | null> | null,
): Zuordnung {
  const ziele = alleFelder(zielSchema);
  const zielById = new Map(ziele.map((z) => [z.id, z]));
  const vergeben = new Set<string>();
  const out: Zuordnung = {};
  const setze = (q: QuellZeile, ziel: string | null, sicherheit: Sicherheit) => {
    out[q.id] = { ziel, sicherheit };
    if (ziel) vergeben.add(ziel);
  };

  // 0) gemerkt
  if (gemerkt) {
    for (const q of quellen) {
      if (!(q.id in gemerkt)) continue;
      const zid = gemerkt[q.id];
      if (zid === null) { setze(q, null, 'gemerkt'); continue; }
      const z = zielById.get(zid);
      if (z && kompatibel(q.typ, z.type) && !vergeben.has(z.id)) setze(q, z.id, 'gemerkt');
    }
  }
  // 1) gleicher Key, 2) gleiches Label
  for (const q of quellen) {
    if (out[q.id]) continue;
    const z = zielById.get(q.id);
    if (z && kompatibel(q.typ, z.type) && !vergeben.has(z.id)) setze(q, z.id, 'sicher');
  }
  for (const q of quellen) {
    if (out[q.id]) continue;
    const n = normLabel(q.label);
    const z = ziele.find((x) => !vergeben.has(x.id) && normLabel(x.label) === n && kompatibel(q.typ, x.type));
    if (z) setze(q, z.id, 'sicher');
  }
  // 3) ähnlich + gleicher Typ — bestes Paar zuerst
  const kandidaten: Array<{ q: QuellZeile; z: FormField; s: number }> = [];
  for (const q of quellen) {
    if (out[q.id]) continue;
    for (const z of ziele) {
      if (z.type !== q.typ) continue;
      const s = Math.max(aehnlichkeit(q.label, z.label), aehnlichkeit(q.id, z.id));
      if (s >= AEHNLICH_AB) kandidaten.push({ q, z, s });
    }
  }
  kandidaten.sort((a, b) => b.s - a.s);
  for (const k of kandidaten) {
    if (out[k.q.id] || vergeben.has(k.z.id)) continue;
    setze(k.q, k.z.id, 'unsicher');
  }
  for (const q of quellen) if (!out[q.id]) setze(q, null, 'keiner');
  return out;
}

// ---------------------------------------------------------------
// Typprüfung und Umwandlung
// ---------------------------------------------------------------

export interface Umwandlung {
  ok: boolean;
  wert?: unknown;
  warnung?: string;
  /** Auswahlwerte, die es im Zielfeld nicht gibt (für die Ersatz-Auswahl). */
  fehlendeOptionen?: string[];
  /** Werte, die bei der Umwandlung wegfallen (für „verworfen"). */
  verloren?: string;
}

export function zahlLesen(s: string): number | null {
  const t = s.trim().replace(/\s/g, '');
  if (!t) return null;
  let norm: string;
  if (t.includes(',')) norm = t.replace(/\./g, '').replace(',', '.');          // 1.234,5
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) norm = t.replace(/\./g, '');       // 45.210 = 45210
  else norm = t;
  if (!/^-?\d+(\.\d+)?$/.test(norm)) return null;
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

/** Datum lesen: ISO (mit/ohne Zeit) oder deutsch TT.MM.JJJJ (mit/ohne Zeit). */
export function datumLesen(s: string): { datum: string; zeit: string | null } | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(t);
  if (m) return { datum: `${m[1]}-${m[2]}-${m[3]}`, zeit: m[4] ? `${m[4]}:${m[5]}` : null };
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:,?\s+(\d{1,2}):(\d{2}))?$/.exec(t);
  if (m) {
    const d = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (Number.isNaN(Date.parse(d))) return null;
    return { datum: d, zeit: m[4] ? `${m[4].padStart(2, '0')}:${m[5]}` : null };
  }
  return null;
}

function optionTreffer(wert: string, optionen: string[]): string | null {
  if (optionen.includes(wert)) return wert;
  const n = normLabel(wert);
  return optionen.find((o) => normLabel(o) === n) ?? null;
}

/** Werte gegen die Optionen des Zielfelds prüfen; Ersatz wird angewandt. */
function optionenPruefen(
  werte: string[], ziel: FormField, ersatz: Record<string, string> | undefined,
): { treffer: string[]; fehlend: string[]; verloren: string[] } {
  const optionen = ziel.options ?? [];
  const treffer: string[] = [], fehlend: string[] = [], verloren: string[] = [];
  for (const w of werte) {
    const t = optionTreffer(w, optionen);
    if (t) { if (!treffer.includes(t)) treffer.push(t); continue; }
    fehlend.push(w);
    const e = ersatz?.[w];
    if (e && optionen.includes(e)) { if (!treffer.includes(e)) treffer.push(e); }
    else verloren.push(w);
  }
  return { treffer, fehlend, verloren };
}

/**
 * Wandelt den Wert einer Quellzeile für ein Zielfeld um. `ok: false` heißt:
 * der Wert kann nicht übernommen werden (er zählt dann als verworfen).
 */
export function umwandeln(q: QuellZeile, ziel: FormField, ersatz?: Record<string, string>): Umwandlung {
  const v = q.wert;
  if (istLeer(v)) return { ok: true, wert: undefined };
  if (!kompatibel(q.typ, ziel.type)) return { ok: false, warnung: 'Feldtypen passen nicht zusammen' };
  const alsText = () => wertAnzeige(q.typ, v);

  switch (ziel.type) {
    case 'text': case 'textarea':
      return { ok: true, wert: q.typ === 'text' || q.typ === 'textarea' ? String(v) : alsText() };

    case 'number': {
      if (typeof v === 'number') return { ok: true, wert: v };
      const n = zahlLesen(String(v));
      return n == null
        ? { ok: false, warnung: `„${String(v)}" ist keine gültige Zahl — wird nicht übernommen` }
        : { ok: true, wert: n };
    }

    case 'date': {
      const d = datumLesen(String(v));
      if (!d) return { ok: false, warnung: `„${String(v)}" ist kein gültiges Datum — wird nicht übernommen` };
      const mitZeit = ziel.includeTime !== false;
      if (d.zeit && mitZeit) return { ok: true, wert: `${d.datum}T${d.zeit}` };
      return d.zeit && !mitZeit
        ? { ok: true, wert: d.datum, warnung: `Uhrzeit ${d.zeit} entfällt (Zielfeld nur Datum)`, verloren: `Uhrzeit ${d.zeit}` }
        : { ok: true, wert: d.datum };
    }

    case 'select': {
      const werte = Array.isArray(v) ? v.map(String) : [String(v)];
      if (werte.length > 1) {
        const e = ersatz?.['__einer__'];
        if (e && (ziel.options ?? []).includes(e)) {
          return { ok: true, wert: e, verloren: werte.filter((w) => w !== e).join(', ') || undefined };
        }
        return { ok: false, warnung: `Mehrere Werte (${werte.join(', ')}) — das Zielfeld erlaubt nur einen`, fehlendeOptionen: ['__einer__'] };
      }
      const r = optionenPruefen(werte, ziel, ersatz);
      if (r.treffer.length === 1) {
        return r.fehlend.length
          ? { ok: true, wert: r.treffer[0], fehlendeOptionen: r.fehlend }
          : { ok: true, wert: r.treffer[0] };
      }
      return { ok: false, warnung: `Wert „${werte[0]}" nicht in den Optionen des Zielfelds`, fehlendeOptionen: r.fehlend };
    }

    case 'checkboxes': {
      const werte = q.typ === 'checkboxes_with_text' && Array.isArray(v)
        ? v.map((e) => String((e as { option?: string }).option ?? ''))
        : Array.isArray(v) ? v.map(String) : [String(v)];
      const r = optionenPruefen(werte, ziel, ersatz);
      const textWeg = q.typ === 'checkboxes_with_text'
        ? (v as Array<{ text?: string }>).map((e) => e.text).filter(Boolean).join('; ') : '';
      const verloren = [...r.verloren, ...(textWeg ? [`Freitext: ${textWeg}`] : [])].join(', ');
      if (r.treffer.length === 0) {
        return { ok: false, warnung: `Werte ${r.fehlend.map((w) => `„${w}"`).join(', ')} nicht in den Optionen des Zielfelds`, fehlendeOptionen: r.fehlend };
      }
      return {
        ok: true, wert: r.treffer,
        fehlendeOptionen: r.fehlend.length ? r.fehlend : undefined,
        warnung: r.verloren.length ? `${r.verloren.map((w) => `„${w}"`).join(', ')} nicht in den Optionen — entfällt` : undefined,
        verloren: verloren || undefined,
      };
    }

    case 'checkboxes_with_text': {
      const eintraege = q.typ === 'checkboxes' && Array.isArray(v)
        ? v.map((o) => ({ option: String(o), text: '' }))
        : (v as Array<{ option: string; text: string }>);
      const r = optionenPruefen(eintraege.map((e) => e.option), ziel, ersatz);
      const neu: Array<{ option: string; text: string }> = [];
      for (const e of eintraege) {
        const t = optionTreffer(e.option, ziel.options ?? []) ?? (ersatz?.[e.option] || null);
        if (t && (ziel.options ?? []).includes(t) && !neu.some((x) => x.option === t)) neu.push({ option: t, text: e.text ?? '' });
      }
      if (neu.length === 0) {
        return { ok: false, warnung: 'Keiner der Werte existiert in den Optionen des Zielfelds', fehlendeOptionen: r.fehlend };
      }
      return { ok: true, wert: neu, fehlendeOptionen: r.fehlend.length ? r.fehlend : undefined,
        verloren: r.verloren.length ? r.verloren.join(', ') : undefined };
    }

    case 'damage_diagram': {
      if (q.feld?.vehicleImage && q.feld.vehicleImage === ziel.vehicleImage) return { ok: true, wert: v };
      return {
        ok: false,
        warnung: 'Andere Fahrzeugskizze — Punkte lassen sich nicht umrechnen und werden verworfen. Zugehörige Fotos bleiben über die Zusatzbilder erhalten.',
      };
    }

    // Fotos, Unterschrift, Stempel, Adresse, Mehrfach-Fotos: unverändert —
    // die Dateien bleiben am bisherigen Ort, es wird nur referenziert.
    default:
      return { ok: true, wert: v };
  }
}

// ---------------------------------------------------------------
// Ergebnis bauen
// ---------------------------------------------------------------

export interface VerworfenerWert { feld: string; label: string; wert: string; grund?: string }

export interface Ergebnis {
  daten: Record<string, unknown>;
  anzahlUebernommen: number;
  verworfen: VerworfenerWert[];
  /** Zielfeld → mehrere Quellen, ohne „zusammenführen" → muss gelöst werden. */
  konflikte: Array<{ ziel: FormField; quellen: QuellZeile[]; zusammenfuehrbar: boolean }>;
  /**
   * Alle Zielfelder mit mehreren Quellen — auch die schon
   * zusammengeführten. Die Oberfläche zeigt sie dauerhaft, damit sich
   * „zusammenführen" wieder abwählen lässt.
   */
  mehrfach: Array<{ ziel: FormField; quellen: QuellZeile[]; zusammenfuehrbar: boolean; zusammengefuehrt: boolean }>;
  leereZiele: FormField[];
  leerePflicht: FormField[];
  unterschriften: string[];
  /** Pro Quellzeile: Ergebnis der Umwandlung (für die Zeilen-Warnung). */
  proZeile: Record<string, Umwandlung>;
  blockiert: boolean;
}

const ZUSAMMENFUEHRBAR: FieldType[] = ['text', 'textarea', 'dynamic_photos'];

export function ergebnisBauen(args: {
  quellDaten: Record<string, unknown>;
  quellen: QuellZeile[];
  zielSchema: FormSchema;
  zuordnung: Zuordnung;
  ersatz?: OptionsErsatz;
  zusammenfuehren?: Record<string, boolean>;
}): Ergebnis {
  const { quellDaten, quellen, zielSchema, zuordnung, ersatz = {}, zusammenfuehren = {} } = args;
  const ziele = alleFelder(zielSchema);
  const zielById = new Map(ziele.map((z) => [z.id, z]));

  const daten: Record<string, unknown> = {};
  // Interne Schlüssel (Tour-Bezug u.ä.) mitnehmen — außer „berührt"-
  // Markierungen (werden unten umgerechnet) und E-Mail-Schieberegler (das
  // neue Template hat seine eigene E-Mail-Konfiguration).
  for (const [k, v] of Object.entries(quellDaten ?? {})) {
    if (k.startsWith('_') && !NICHT_UEBERTRAGEN(k)) daten[k] = v;
  }

  const proZeile: Record<string, Umwandlung> = {};
  const verworfen: VerworfenerWert[] = [];
  const unterschriften: string[] = [];
  const nachZiel = new Map<string, Array<{ q: QuellZeile; u: Umwandlung }>>();
  let anzahlUebernommen = 0;

  for (const q of quellen) {
    if (q.leer) continue;
    const zid = zuordnung[q.id]?.ziel ?? null;
    const ziel = zid ? zielById.get(zid) : undefined;
    if (!ziel) {
      verworfen.push({ feld: q.id, label: q.label, wert: wertAnzeige(q.typ, q.wert), grund: 'verworfen' });
      continue;
    }
    const u = umwandeln(q, ziel, ersatz[q.id]);
    proZeile[q.id] = u;
    if (!u.ok) {
      verworfen.push({ feld: q.id, label: q.label, wert: wertAnzeige(q.typ, q.wert), grund: u.warnung });
      continue;
    }
    if (u.verloren) verworfen.push({ feld: q.id, label: q.label, wert: u.verloren, grund: 'teilweise nicht übertragbar' });
    const liste = nachZiel.get(ziel.id) ?? [];
    liste.push({ q, u });
    nachZiel.set(ziel.id, liste);
  }

  const konflikte: Ergebnis['konflikte'] = [];
  const mehrfach: Ergebnis['mehrfach'] = [];
  for (const [zid, liste] of nachZiel) {
    const ziel = zielById.get(zid)!;
    if (liste.length > 1) {
      const zusammenfuehrbar = ZUSAMMENFUEHRBAR.includes(ziel.type);
      const zusammengefuehrt = zusammenfuehrbar && !!zusammenfuehren[zid];
      mehrfach.push({ ziel, quellen: liste.map((x) => x.q), zusammenfuehrbar, zusammengefuehrt });
      if (!zusammengefuehrt) {
        konflikte.push({ ziel, quellen: liste.map((x) => x.q), zusammenfuehrbar });
        continue;
      }
      daten[zid] = ziel.type === 'dynamic_photos'
        ? liste.flatMap((x) => (Array.isArray(x.u.wert) ? x.u.wert : []))
        : liste.map((x) => String(x.u.wert ?? '')).filter(Boolean).join('\n');
    } else {
      daten[zid] = liste[0].u.wert;
    }
    for (const x of liste) {
      anzahlUebernommen += 1;
      if (x.q.typ === 'signature') unterschriften.push(zid);
    }
  }

  // „Vom Fahrer berührt" auf die Zielfelder umrechnen — sonst überschriebe
  // eine Admin-Vorgabe beim nächsten Öffnen die Eingabe des Fahrers.
  const touched = (quellDaten?._touched && typeof quellDaten._touched === 'object')
    ? quellDaten._touched as Record<string, unknown> : {};
  const neuTouched: Record<string, true> = {};
  for (const [qid, ja] of Object.entries(touched)) {
    const zid = zuordnung[qid]?.ziel;
    if (ja && zid && daten[zid] !== undefined) neuTouched[zid] = true;
  }
  if (Object.keys(neuTouched).length) daten._touched = neuTouched;

  const leereZiele = ziele.filter((z) => istLeer(daten[z.id]));
  return {
    daten, anzahlUebernommen, verworfen, konflikte, mehrfach,
    leereZiele, leerePflicht: leereZiele.filter((z) => z.required),
    unterschriften, proZeile,
    blockiert: konflikte.length > 0,
  };
}

/**
 * Admin-Vorgaben der Tour-Zuweisung auf die Felder des neuen Templates
 * umrechnen (gleiche Regeln wie für die Werte). Ohne das stünden die
 * Vorgaben weiter unter den alten Feld-Keys und kämen nie an.
 */
export function vorgabenUmrechnen(
  vorgaben: Record<string, unknown> | null | undefined,
  quellSchema: FormSchema,
  zielSchema: FormSchema,
  zuordnung: Zuordnung,
  ersatz: OptionsErsatz = {},
): Record<string, unknown> | null {
  if (!vorgaben || typeof vorgaben !== 'object') return null;
  const zeilen = quellZeilen(quellSchema, vorgaben).filter((z) => z.id in vorgaben);
  const zielById = new Map(alleFelder(zielSchema).map((z) => [z.id, z]));
  const out: Record<string, unknown> = {};
  for (const q of zeilen) {
    const zid = zuordnung[q.id]?.ziel;
    const ziel = zid ? zielById.get(zid) : undefined;
    if (!ziel || q.leer) continue;
    const u = umwandeln(q, ziel, ersatz[q.id]);
    if (u.ok && u.wert !== undefined) out[ziel.id] = u.wert;
  }
  return Object.keys(out).length ? out : null;
}

/** Zuordnung in die Form zum Merken/Protokollieren: {quellFeld: zielFeld | null}. */
export function zuordnungKompakt(z: Zuordnung): Record<string, string | null> {
  return Object.fromEntries(Object.entries(z).map(([k, v]) => [k, v.ziel]));
}
