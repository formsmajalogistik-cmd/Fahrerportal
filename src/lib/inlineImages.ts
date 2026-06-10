// Inline-Bild-Auflösung für HTML-Mail-Bodies. Strikt additiv — wird
// NUR auf den HTML-String angewendet, ändert die Attachments-Liste NICHT.
// Bei jedem Fehler (Netzwerk, fehlende Bytes, unerwartetes Format)
// wird der Original-Body zurückgegeben — die Mail-Anzeige darf nie
// kaputt gehen.
//
// WICHTIG: `contentId` ist auf der polymorphen Graph-Attachment-
// Collection NICHT selektierbar (nur auf dem Subtyp fileAttachment).
// Die Listen-Metadaten haben daher KEINE contentId. Wir holen sie pro
// Bild-Anhang über den inline-bytes-Endpoint mit, der das volle
// fileAttachment-JSON sieht. Gematcht wird tolerant: mit/ohne spitze
// Klammern und mit/ohne @namespace-Suffix.

import { fetchAttachmentBase64, type MailAttachmentMeta } from './emails';

/** Maximal so viele Bild-Anhänge pro Mail nachladen — Schutz gegen
 *  Mails mit absurd vielen Bildern. */
const MAX_INLINE_FETCHES = 12;

function normalizeCid(raw: string): string {
  return raw.replace(/[<>]/g, '').trim();
}

/**
 * Findet `cid:<id>`-Referenzen im `htmlBody` und ersetzt sie durch
 * `data:<mime>;base64,...`. Kandidaten sind ALLE Bild-Anhänge —
 * unabhängig vom isInline-Flag, weil manche Clients es nicht setzen.
 * Die Zuordnung läuft über die contentId aus dem Einzel-Attachment-
 * Fetch. Existiert keine cid-Referenz im Body, kehrt die Funktion
 * sofort mit dem Original zurück (kein Round-Trip).
 */
export async function enrichBodyWithInlineImages(
  htmlBody: string,
  attachments: MailAttachmentMeta[] | undefined | null,
  mailbox: string,
  messageId: string,
): Promise<string> {
  try {
    if (!htmlBody || !htmlBody.includes('cid:')) return htmlBody;

    const cidsInBody = (htmlBody.match(/cid:[^"'\s>)]+/g) ?? [])
      .map((c) => normalizeCid(c.slice(4)));
    if (cidsInBody.length === 0) return htmlBody;

    const imageAtts = (attachments ?? [])
      .filter((a) => a.contentType.startsWith('image/'))
      .slice(0, MAX_INLINE_FETCHES);

    console.info('[inlineImages] Diagnose:', {
      cidsImBody: cidsInBody,
      bildAnhaenge: imageAtts.map((a) => ({
        name: a.name, isInline: a.isInline ?? null, size: a.size,
      })),
    });
    if (imageAtts.length === 0) return htmlBody;

    // Pro Bild-Anhang: Bytes + contentId holen, dann gegen die
    // Body-Referenzen matchen.
    let enriched = htmlBody;
    for (const att of imageAtts) {
      try {
        const full = await fetchAttachmentBase64({
          mailbox, messageId, attachmentId: att.id,
        });
        if (!full.contentBytes) continue;
        const cleanId = normalizeCid(full.contentId ?? '');
        if (!cleanId) continue;
        const idNoNamespace = cleanId.split('@')[0];

        // Tolerantes Matching: exakter Treffer ODER Prefix-Beziehung in
        // beide Richtungen (Outlook hängt teils @namespace-Suffixe an).
        const matched = cidsInBody.some((bodyCid) =>
          bodyCid === cleanId
          || bodyCid === idNoNamespace
          || bodyCid.split('@')[0] === idNoNamespace,
        );
        if (!matched) continue;

        const dataUrl = `data:${full.contentType || att.contentType};base64,${full.contentBytes}`;
        // Regex-Replace über alle src="cid:..."-Varianten, deren Wert zu
        // dieser contentId passt — deckt volle ID, gestrippte ID und
        // @suffix-Varianten ab.
        enriched = enriched.replace(
          /(['"])cid:([^'"]+)\1/g,
          (matchStr, quote: string, cidValue: string) => {
            const v = normalizeCid(cidValue);
            const hit = v === cleanId
              || v === idNoNamespace
              || v.split('@')[0] === idNoNamespace;
            return hit ? `${quote}${dataUrl}${quote}` : matchStr;
          },
        );
      } catch (err) {
        console.warn('[inlineImages] Bytes laden fehlgeschlagen:', att.name, err);
      }
    }
    return enriched;
  } catch (err) {
    // Hard fallback — Body NIE verlieren.
    console.warn('[inlineImages] enrichBodyWithInlineImages fehlgeschlagen', err);
    return htmlBody;
  }
}
