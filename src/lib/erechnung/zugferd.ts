// ZUGFeRD / Factur-X (Profil EN 16931): macht aus einem pdf-lib-Dokument
// ein PDF/A-3b mit eingebettetem XML (factur-x.xml).
//
// Bausteine (ISO 19005-3 + Factur-X/ZUGFeRD-Spezifikation):
//   * alle Schriften eingebettet (Liberation Sans, SIL OFL 1.1 — die
//     Aufrufer betten sie über ladeZugferdSchriften() ein)
//   * sRGB-OutputIntent mit ICC-Profil (hier nach ICC.1 selbst erzeugt)
//   * XMP-Metadaten: PDF/A-Kennung (part 3, conformance B) und das
//     Factur-X-Erweiterungsschema (DocumentType, DocumentFileName,
//     Version, ConformanceLevel)
//   * XML als zugeordnete Datei (Associated File) mit AFRelationship
//   * Dokument-ID im Trailer; Erstell-/Änderungsdatum identisch zu XMP
//
// AFRelationship = „Alternative": Laut Factur-X/ZUGFeRD-Spezifikation gilt
// für die Profile BASIC, EN 16931 und EXTENDED „Alternative" (das XML ist
// eine gleichwertige, maschinenlesbare Darstellung desselben Belegs);
// „Data" ist nur für MINIMUM und BASIC WL vorgesehen, die keine
// vollständige Rechnung enthalten. Wir erzeugen Profil EN 16931.

import {
  AFRelationship, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, decodePDFRawStream,
} from 'pdf-lib';

export const ZUGFERD_DATEINAME = 'factur-x.xml';
export const ZUGFERD_PROFIL = 'EN 16931';
export const ZUGFERD_VERSION = '1.0';
export const ZUGFERD_AF_BEZIEHUNG = AFRelationship.Alternative;

// ---------------------------------------------------------------- Schriften

export interface ZugferdSchriften { regular: Uint8Array; bold: Uint8Array }

/** Liberation Sans (Regular/Bold) aus /fonts/ laden — metrisch kompatibel zu Helvetica/Arial. */
export async function ladeZugferdSchriften(): Promise<ZugferdSchriften> {
  const hole = async (datei: string) => {
    const r = await fetch(`/fonts/${datei}`);
    if (!r.ok) throw new Error(`Schrift ${datei} konnte nicht geladen werden (${r.status}).`);
    return new Uint8Array(await r.arrayBuffer());
  };
  const [regular, bold] = await Promise.all([hole('LiberationSans-Regular.ttf'), hole('LiberationSans-Bold.ttf')]);
  return { regular, bold };
}

// ---------------------------------------------------------------- sRGB-ICC-Profil

function s15(n: number): number { return Math.round(n * 65536) | 0; }

/**
 * Kleines sRGB-Profil (ICC v2.1, Monitor, RGB→XYZ, Matrix + Kennlinie) —
 * Primärvalenzen und Weißpunkt wie „sRGB IEC61966-2.1", Kennlinie als
 * 1024-Punkte-Tabelle der sRGB-Übertragungsfunktion. Selbst erzeugt, daher
 * ohne fremde Lizenz.
 */
export function srgbIccProfil(): Uint8Array {
  const text = (s: string) => new TextEncoder().encode(s);
  const desc = 'sRGB IEC61966-2.1 (kompatibel)';
  const cprt = 'Gemeinfrei (CC0) - keine Rechte vorbehalten';

  const tagDesc = new Uint8Array(90 + desc.length + 1);
  tagDesc.set(text('desc'), 0);
  new DataView(tagDesc.buffer).setUint32(8, desc.length + 1);
  tagDesc.set(text(desc), 12);

  const tagCprt = new Uint8Array(8 + cprt.length + 1);
  tagCprt.set(text('text'), 0);
  tagCprt.set(text(cprt), 8);

  const xyz = (x: number, y: number, z: number) => {
    const b = new Uint8Array(20); b.set(text('XYZ '), 0);
    const v = new DataView(b.buffer); v.setInt32(8, x); v.setInt32(12, y); v.setInt32(16, z);
    return b;
  };
  // Werte des Referenzprofils (s15Fixed16), D50-adaptiert; Weißpunkt D65.
  const wtpt = xyz(0xF351, 0x10000, 0x116CC);
  const rXYZ = xyz(0x6FA2, 0x38F5, 0x0390);
  const gXYZ = xyz(0x6299, 0xB785, 0x18DA);
  const bXYZ = xyz(0x24A0, 0x0F84, 0xB6CF);

  const N = 1024;
  const trc = new Uint8Array(12 + N * 2);
  trc.set(text('curv'), 0);
  const tv = new DataView(trc.buffer);
  tv.setUint32(8, N);
  for (let i = 0; i < N; i += 1) {
    const c = i / (N - 1);
    const lin = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    tv.setUint16(12 + i * 2, Math.round(lin * 65535));
  }

  const tags: Array<[string, Uint8Array]> = [
    ['desc', tagDesc], ['cprt', tagCprt], ['wtpt', wtpt],
    ['rXYZ', rXYZ], ['gXYZ', gXYZ], ['bXYZ', bXYZ],
    ['rTRC', trc], ['gTRC', trc], ['bTRC', trc],
  ];
  const pad = (n: number) => (n + 3) & ~3;
  let offset = 128 + 4 + tags.length * 12;
  const lage = new Map<Uint8Array, number>();
  for (const [, daten] of tags) {
    if (lage.has(daten)) continue; // gleiche Kennlinie für R, G, B nur einmal
    lage.set(daten, offset);
    offset = pad(offset + daten.length);
  }
  const out = new Uint8Array(offset);
  const v = new DataView(out.buffer);
  v.setUint32(0, offset);
  v.setUint32(8, 0x02100000);            // Version 2.1
  out.set(text('mntr'), 12); out.set(text('RGB '), 16); out.set(text('XYZ '), 20);
  v.setUint16(24, 2026); v.setUint16(26, 1); v.setUint16(28, 1); // festes Datum → reproduzierbar
  out.set(text('acsp'), 36);
  v.setInt32(68, s15(0.9642)); v.setInt32(72, s15(1)); v.setInt32(76, s15(0.8249)); // PCS-Lichtart D50
  v.setUint32(128, tags.length);
  tags.forEach(([sig, daten], i) => {
    const p = 132 + i * 12;
    out.set(text(sig), p); v.setUint32(p + 4, lage.get(daten)!); v.setUint32(p + 8, daten.length);
  });
  for (const [daten, pos] of lage) out.set(daten, pos);
  return out;
}

// ---------------------------------------------------------------- XMP

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** XMP-Zeit in UTC, passend zum Info-Eintrag (D:YYYYMMDDHHmmSSZ). */
export function xmpZeit(d: Date): string { return `${d.toISOString().slice(0, 19)}Z`; }

export interface ZugferdMeta {
  titel: string;
  autor: string;
  /** Erstell- und Änderungszeitpunkt (ein Wert für Info und XMP). */
  erstellt: Date;
  werkzeug?: string;
  produzent?: string;
}

export function xmpPaket(m: ZugferdMeta): string {
  const zeit = xmpZeit(m.erstellt);
  const werkzeug = m.werkzeug ?? 'Maja-Logistik Fahrerportal';
  const produzent = m.produzent ?? 'pdf-lib';
  const eigenschaft = (name: string, beschreibung: string) => `
              <rdf:li rdf:parseType="Resource">
                <pdfaProperty:name>${name}</pdfaProperty:name>
                <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                <pdfaProperty:category>external</pdfaProperty:category>
                <pdfaProperty:description>${beschreibung}</pdfaProperty:description>
              </rdf:li>`;
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:format>application/pdf</dc:format>
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(m.titel)}</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq><rdf:li>${xmlEsc(m.autor)}</rdf:li></rdf:Seq></dc:creator>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
      <pdf:Producer>${xmlEsc(produzent)}</pdf:Producer>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <xmp:CreatorTool>${xmlEsc(werkzeug)}</xmp:CreatorTool>
      <xmp:CreateDate>${zeit}</xmp:CreateDate>
      <xmp:ModifyDate>${zeit}</xmp:ModifyDate>
      <xmp:MetadataDate>${zeit}</xmp:MetadataDate>
    </rdf:Description>
    <rdf:Description rdf:about=""
        xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
        xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"
        xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
      <pdfaExtension:schemas>
        <rdf:Bag>
          <rdf:li rdf:parseType="Resource">
            <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
            <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
            <pdfaSchema:prefix>fx</pdfaSchema:prefix>
            <pdfaSchema:property>
              <rdf:Seq>${eigenschaft('DocumentFileName', 'Name der eingebetteten XML-Rechnungsdatei')}${eigenschaft('DocumentType', 'INVOICE')}${eigenschaft('Version', 'Version des Factur-X-XML-Schemas')}${eigenschaft('ConformanceLevel', 'Profil (Konformitätsstufe) der Factur-X-Daten')}
              </rdf:Seq>
            </pdfaSchema:property>
          </rdf:li>
        </rdf:Bag>
      </pdfaExtension:schemas>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>${ZUGFERD_DATEINAME}</fx:DocumentFileName>
      <fx:Version>${ZUGFERD_VERSION}</fx:Version>
      <fx:ConformanceLevel>${ZUGFERD_PROFIL}</fx:ConformanceLevel>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

// ---------------------------------------------------------------- PDF/A-3 + Einbettung

/** 16 Byte Dokument-ID (hex) aus Inhalt + Zeit — stabil je Erzeugung. */
async function dokumentId(xml: string, m: ZugferdMeta): Promise<string> {
  const daten = new TextEncoder().encode(`${m.titel}|${xmpZeit(m.erstellt)}|${xml}`);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', daten as BufferSource));
  return [...h.subarray(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * Ergänzt das Dokument um alles, was PDF/A-3b und Factur-X verlangen, und
 * bettet das XML ein. Voraussetzung: ALLE Schriften des Dokuments sind
 * eingebettet (keine Standard-14-Schriften). Danach mit
 * doc.save({ useObjectStreams: false }) speichern.
 */
export async function macheZugferd(doc: PDFDocument, xml: string, m: ZugferdMeta): Promise<void> {
  const ctx = doc.context;
  // Sekunden-genau, damit Info und XMP exakt denselben Wert tragen.
  const zeit = new Date(Math.floor(m.erstellt.getTime() / 1000) * 1000);
  const meta: ZugferdMeta = { ...m, erstellt: zeit };

  doc.setTitle(meta.titel);
  doc.setAuthor(meta.autor);
  doc.setCreator(meta.werkzeug ?? 'Maja-Logistik Fahrerportal');
  doc.setProducer(meta.produzent ?? 'pdf-lib');
  doc.setCreationDate(zeit);
  doc.setModificationDate(zeit);

  // XML als zugeordnete Datei (schreibt Names/EmbeddedFiles und /AF im Katalog).
  await doc.attach(new TextEncoder().encode(xml), ZUGFERD_DATEINAME, {
    mimeType: 'text/xml',
    description: 'Factur-X/ZUGFeRD-Rechnungsdaten (EN 16931)',
    creationDate: zeit,
    modificationDate: zeit,
    afRelationship: ZUGFERD_AF_BEZIEHUNG,
  });

  // sRGB-OutputIntent
  const icc = ctx.register(ctx.flateStream(srgbIccProfil(), { N: 3 }));
  const intent = ctx.register(ctx.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
    Info: PDFString.of('sRGB IEC61966-2.1'),
    DestOutputProfile: icc,
  }));
  doc.catalog.set(PDFName.of('OutputIntents'), ctx.obj([intent]));

  // XMP-Metadaten (unkomprimiert — PDF/A verbietet einen Filter am Metadaten-Strom).
  const xmp = ctx.register(ctx.stream(new TextEncoder().encode(xmpPaket(meta)), { Type: 'Metadata', Subtype: 'XML' }));
  doc.catalog.set(PDFName.of('Metadata'), xmp);

  // Dokument-ID im Trailer
  const id = PDFHexString.of(await dokumentId(xml, meta));
  ctx.trailerInfo.ID = ctx.obj([id, id]);
}

/** Liest die eingebettete factur-x.xml wieder aus (für Tests und den Test-Export). */
export async function leseZugferdXml(pdf: Uint8Array): Promise<string | null> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const liste = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)
    ?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict)
    ?.lookupMaybe(PDFName.of('Names'), PDFArray);
  if (!liste) return null;
  for (let i = 0; i + 1 < liste.size(); i += 2) {
    const n = liste.lookup(i);
    const name = n instanceof PDFString || n instanceof PDFHexString ? n.decodeText() : '';
    if (name !== ZUGFERD_DATEINAME) continue;
    const strom = liste.lookup(i + 1, PDFDict).lookup(PDFName.of('EF'), PDFDict).lookup(PDFName.of('F'));
    if (strom instanceof PDFRawStream) return new TextDecoder().decode(decodePDFRawStream(strom).decode());
  }
  return null;
}
