// CII-Generator (UN/CEFACT Cross Industry Invoice D16B) für die
// Profile EN 16931 und XRechnung 3.0.
//
// Prototyp (Phase 1a): nur Rechnungen (Typ 380) mit Steuerkategorie S.
// Gutschriften, Korrekturen, Storno, Auslagenrechnungen und andere
// Steuerkategorien brechen mit ERechnungAbbruch ab, bis die offenen
// Fragen (S1–S4) beantwortet sind.
//
// Der Generator rechnet keine Beträge — er schreibt die übergebenen
// (aus berechneSummenProUst stammenden) Werte nur formatiert hinaus.

import {
  ERechnungAbbruch, PROFIL_KENNUNG, PROZESS_KENNUNG, TYP_CODE_KORREKTUR, TYP_CODE_RECHNUNG,
  type ERechnungDaten, type ERechnungPartei, type ERechnungProfil,
} from './typen';
import { el, elA, serialisiere, txt, wert, type XmlElement } from './xml';

const NS = {
  'xmlns:rsm': 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
  'xmlns:ram': 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
  'xmlns:qdt': 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
  'xmlns:udt': 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
};

/** Betrag mit genau 2 Nachkommastellen (Punkt). */
export function betrag(n: number): string {
  const c = Math.round(n * 100);
  const v = (c === 0 ? 0 : c) / 100; // -0 vermeiden
  return v.toFixed(2);
}

/** Menge: bis zu 4 Nachkommastellen, ohne überflüssige Nullen. */
export function menge(n: number): string {
  const s = (Math.round(n * 10000) / 10000).toFixed(4);
  return s.replace(/\.?0+$/, '');
}

/** Prozentsatz ohne überflüssige Nullen („19", „7", „16.5"). */
export function prozent(n: number): string {
  return menge(n);
}

/** YYYY-MM-DD → CII-Datum (Format 102 = YYYYMMDD). */
function datum(name: string, iso: string | null | undefined): XmlElement | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return el(name, elA('udt:DateTimeString', { format: '102' }, txt(`${m[1]}${m[2]}${m[3]}`)));
}

function partei(name: string, p: ERechnungPartei, rolle: 'verkaeufer' | 'kaeufer'): XmlElement {
  const kontakt = el('ram:DefinedTradeContact',
    wert('ram:PersonName', p.kontaktName),
    p.telefon ? el('ram:TelephoneUniversalCommunication', wert('ram:CompleteNumber', p.telefon)) : null,
    p.email ? el('ram:EmailURIUniversalCommunication', wert('ram:URIID', p.email)) : null,
  );
  return el(name,
    rolle === 'kaeufer' ? wert('ram:ID', p.kennung) : null,
    wert('ram:Name', p.name),
    kontakt,
    el('ram:PostalTradeAddress',
      wert('ram:PostcodeCode', p.plz),
      wert('ram:LineOne', p.strasse),
      wert('ram:CityName', p.ort),
      wert('ram:CountryID', p.landCode),
    ),
    p.elektronischeAdresse
      ? el('ram:URIUniversalCommunication', wert('ram:URIID', p.elektronischeAdresse, { schemeID: 'EM' }))
      : null,
    p.ustId ? el('ram:SpecifiedTaxRegistration', wert('ram:ID', p.ustId, { schemeID: 'VA' })) : null,
    p.steuernummer ? el('ram:SpecifiedTaxRegistration', wert('ram:ID', p.steuernummer, { schemeID: 'FC' })) : null,
  );
}

/** Wirft ERechnungAbbruch, wenn die Rechnung (noch) nicht unterstützt ist. */
export function pruefeUnterstuetzt(d: ERechnungDaten): void {
  if (d.typ !== TYP_CODE_RECHNUNG && d.typ !== TYP_CODE_KORREKTUR) {
    throw new ERechnungAbbruch(`Dokumentart ${String(d.typ)} wird nicht unterstützt — nur Rechnung (${TYP_CODE_RECHNUNG}) und Storno/Teilgutschrift (${TYP_CODE_KORREKTUR}).`);
  }
  if (d.typ === TYP_CODE_KORREKTUR && !d.bezug?.nummer) {
    throw new ERechnungAbbruch('Storno/Teilgutschrift ohne Bezug auf die Originalrechnung (BT-25).');
  }
  if (d.positionen.length === 0) {
    throw new ERechnungAbbruch('Die Rechnung hat keine Positionen.');
  }
  for (const p of d.positionen) {
    if (p.kategorie !== 'S' || !(p.ustSatz > 0)) {
      throw new ERechnungAbbruch(
        `Position ${p.nr}: Steuersatz ${prozent(p.ustSatz)} % / Kategorie ${p.kategorie} — `
        + 'andere Kategorien als S (Normalsatz) sind erst nach Klärung der Fragen S3/S4 freigegeben.',
      );
    }
  }
}

export function erzeugeCii(d: ERechnungDaten, profil: ERechnungProfil = 'xrechnung'): string {
  pruefeUnterstuetzt(d);
  const W = d.waehrung;

  const kontext = el('rsm:ExchangedDocumentContext',
    profil === 'xrechnung'
      ? el('ram:BusinessProcessSpecifiedDocumentContextParameter', wert('ram:ID', PROZESS_KENNUNG))
      : null,
    el('ram:GuidelineSpecifiedDocumentContextParameter', wert('ram:ID', PROFIL_KENNUNG[profil])),
  );

  const dokument = el('rsm:ExchangedDocument',
    wert('ram:ID', d.nummer),
    wert('ram:TypeCode', d.typ),
    datum('ram:IssueDateTime', d.datum),
    d.notizen.map((n) => el('ram:IncludedNote', wert('ram:Content', n))),
  );

  const positionen = d.positionen.map((p) => el('ram:IncludedSupplyChainTradeLineItem',
    el('ram:AssociatedDocumentLineDocument', wert('ram:LineID', p.nr)),
    el('ram:SpecifiedTradeProduct',
      wert('ram:Name', p.bezeichnung),
      wert('ram:Description', p.beschreibung),
    ),
    el('ram:SpecifiedLineTradeAgreement',
      el('ram:NetPriceProductTradePrice', wert('ram:ChargeAmount', betrag(p.einzelpreis))),
    ),
    el('ram:SpecifiedLineTradeDelivery',
      wert('ram:BilledQuantity', menge(p.menge), { unitCode: p.einheitCode }),
    ),
    el('ram:SpecifiedLineTradeSettlement',
      el('ram:ApplicableTradeTax',
        wert('ram:TypeCode', 'VAT'),
        wert('ram:CategoryCode', p.kategorie),
        wert('ram:RateApplicablePercent', prozent(p.ustSatz)),
      ),
      p.leistungsdatum
        ? el('ram:BillingSpecifiedPeriod',
            datum('ram:StartDateTime', p.leistungsdatum),
            datum('ram:EndDateTime', p.leistungsdatum))
        : null,
      el('ram:SpecifiedTradeSettlementLineMonetarySummation',
        wert('ram:LineTotalAmount', betrag(p.netto)),
      ),
    ),
  ));

  const vereinbarung = el('ram:ApplicableHeaderTradeAgreement',
    wert('ram:BuyerReference', d.kaeuferReferenz),
    partei('ram:SellerTradeParty', d.verkaeufer, 'verkaeufer'),
    partei('ram:BuyerTradeParty', d.kaeufer, 'kaeufer'),
  );

  // Pflicht-Element, auch wenn leer — el() würde es weglassen, daher direkt.
  const lieferung: XmlElement = { name: 'ram:ApplicableHeaderTradeDelivery', kinder: [] };

  const zahlungsText = d.zahlungsText
    ?? (d.zahlungszielTage != null ? `Zahlungsziel: ${d.zahlungszielTage} Tage` : null);

  const abrechnung = el('ram:ApplicableHeaderTradeSettlement',
    wert('ram:InvoiceCurrencyCode', W),
    el('ram:SpecifiedTradeSettlementPaymentMeans',
      wert('ram:TypeCode', '58'),
      el('ram:PayeePartyCreditorFinancialAccount', wert('ram:IBANID', d.verkaeufer.iban)),
      d.verkaeufer.bic
        ? el('ram:PayeeSpecifiedCreditorFinancialInstitution', wert('ram:BICID', d.verkaeufer.bic))
        : null,
    ),
    d.summen.gruppen.map((g) => el('ram:ApplicableTradeTax',
      wert('ram:CalculatedAmount', betrag(g.ust)),
      wert('ram:TypeCode', 'VAT'),
      wert('ram:BasisAmount', betrag(g.netto)),
      wert('ram:CategoryCode', g.kategorie),
      wert('ram:RateApplicablePercent', prozent(g.satz)),
    )),
    (d.leistungVon || d.leistungBis)
      ? el('ram:BillingSpecifiedPeriod',
          datum('ram:StartDateTime', d.leistungVon),
          datum('ram:EndDateTime', d.leistungBis))
      : null,
    (zahlungsText || d.faelligAm)
      ? el('ram:SpecifiedTradePaymentTerms',
          wert('ram:Description', zahlungsText),
          datum('ram:DueDateDateTime', d.faelligAm))
      : null,
    el('ram:SpecifiedTradeSettlementHeaderMonetarySummation',
      wert('ram:LineTotalAmount', betrag(d.summen.netto)),
      wert('ram:TaxBasisTotalAmount', betrag(d.summen.netto)),
      wert('ram:TaxTotalAmount', betrag(d.summen.ust), { currencyID: W }),
      wert('ram:GrandTotalAmount', betrag(d.summen.brutto)),
      wert('ram:DuePayableAmount', betrag(d.summen.brutto)),
    ),
    d.bezug?.nummer
      ? el('ram:InvoiceReferencedDocument',
          wert('ram:IssuerAssignedID', d.bezug.nummer),
          d.bezug.datum
            ? el('ram:FormattedIssueDateTime', elA('qdt:DateTimeString', { format: '102' }, txt(d.bezug.datum.replace(/-/g, '').slice(0, 8))))
            : null)
      : null,
  );

  const transaktion = el('rsm:SupplyChainTradeTransaction',
    positionen, vereinbarung, lieferung, abrechnung,
  );
  // Leeres Liefer-Element nachträglich an seine Stelle setzen (el() lässt Leeres weg).
  transaktion.kinder.splice(transaktion.kinder.indexOf(vereinbarung) + 1, 0, lieferung);

  return serialisiere(el('rsm:CrossIndustryInvoice', kontext, dokument, transaktion), NS);
}
