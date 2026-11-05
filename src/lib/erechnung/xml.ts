// Kleiner XML-Schreiber für die E-Rechnung.
//
// Es gibt bewusst KEINE String-Verkettung von Inhalten: Elemente werden
// als Baum aufgebaut und beim Serialisieren wird jeder Text- und
// Attributwert escaped. Leere/fehlende Werte erzeugen kein Element.

export interface XmlElement {
  name: string;
  attrs?: Record<string, string>;
  kinder: XmlKnoten[];
}
export type XmlKnoten = XmlElement | { text: string };

/** Zeichen, die in XML 1.0 gar nicht vorkommen dürfen, entfernen. */
// eslint-disable-next-line no-control-regex
const VERBOTEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function escapeText(s: string): string {
  return s.replace(VERBOTEN, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeAttr(s: string): string {
  return escapeText(s)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;');
}

type Kind = XmlKnoten | null | undefined | false | ReadonlyArray<XmlKnoten | null | undefined | false>;

function istLeer(e: XmlElement): boolean {
  return e.kinder.length === 0 && !e.attrs;
}

/**
 * Element mit Kindern. Kinder, die null/undefined/false sind, und
 * Kind-Elemente ohne Inhalt fallen weg. Ein Element, das danach leer
 * ist, wird von seinem Eltern-Element ebenfalls weggelassen.
 */
export function el(name: string, ...kinder: Kind[]): XmlElement {
  const flach: XmlKnoten[] = [];
  const add = (k: XmlKnoten | null | undefined | false) => {
    if (!k) return;
    if ('text' in k) { if (k.text !== '') flach.push(k); return; }
    if (!istLeer(k)) flach.push(k);
  };
  for (const k of kinder) {
    if (Array.isArray(k)) for (const x of k) add(x);
    else add(k as XmlKnoten | null | undefined | false);
  }
  return { name, kinder: flach };
}

/** Element mit Attributen (Attribute mit leerem Wert entfallen). */
export function elA(name: string, attrs: Record<string, string | null | undefined>, ...kinder: Kind[]): XmlElement {
  const e = el(name, ...kinder);
  const a: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== '') a[k] = v;
  if (Object.keys(a).length) e.attrs = a;
  return e;
}

/** Textknoten; null/undefined/'' → nichts. */
export function txt(v: string | number | null | undefined): XmlKnoten | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : { text: s };
}

/** Kurzform: Element mit genau einem Text (entfällt, wenn Text leer). */
export function wert(name: string, v: string | number | null | undefined, attrs?: Record<string, string | null | undefined>): XmlElement | null {
  const t = txt(v);
  if (!t) return null;
  return attrs ? elA(name, attrs, t) : el(name, t);
}

export function serialisiere(wurzel: XmlElement, ns?: Record<string, string>): string {
  const teile: string[] = ['<?xml version="1.0" encoding="UTF-8"?>\n'];
  const schreibe = (e: XmlElement, tiefe: number, istWurzel: boolean) => {
    const einr = '  '.repeat(tiefe);
    const attrs = { ...(istWurzel && ns ? ns : {}), ...(e.attrs ?? {}) };
    const a = Object.entries(attrs).map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('');
    if (e.kinder.length === 0) { teile.push(`${einr}<${e.name}${a}/>\n`); return; }
    if (e.kinder.length === 1 && 'text' in e.kinder[0]) {
      teile.push(`${einr}<${e.name}${a}>${escapeText(e.kinder[0].text)}</${e.name}>\n`);
      return;
    }
    teile.push(`${einr}<${e.name}${a}>\n`);
    for (const k of e.kinder) {
      if ('text' in k) teile.push(`${einr}  ${escapeText(k.text)}\n`);
      else schreibe(k, tiefe + 1, false);
    }
    teile.push(`${einr}</${e.name}>\n`);
  };
  schreibe(wurzel, 0, true);
  return teile.join('');
}
