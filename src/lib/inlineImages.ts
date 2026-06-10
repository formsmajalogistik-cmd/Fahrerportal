// Inline-Bild-Auflösung für HTML-Mail-Bodies. Strikt additiv — wird
// NUR auf den HTML-String angewendet, ändert die Attachments-Liste NICHT.
// Bei jedem Fehler (Netzwerk, fehlende Bytes, unerwartetes Format)
// wird der Original-Body zurückgegeben — die Mail-Anzeige darf nie
// kaputt gehen.

import { fetchAttachmentBase64, type MailAttachmentMeta } from './emails';

/**
 * Findet `cid:<id>`-Referenzen im `htmlBody` und ersetzt sie durch
 * `data:<mime>;base64,...`. Es werden nur Anhänge betrachtet, die
 * inline-flagged sind UND eine contentId tragen. Existiert keine
 * cid-Referenz im Body, kehrt die Funktion sofort mit dem Original
 * zurück (kein Round-Trip).
 */
export async function enrichBodyWithInlineImages(
  htmlBody: string,
  attachments: MailAttachmentMeta[] | undefined | null,
  mailbox: string,
  messageId: string,
): Promise<string> {
  try {
    if (!htmlBody || !htmlBody.includes('cid:')) return htmlBody;
    const inlineCandidates = (attachments ?? []).filter(
      (a) => a.isInline && a.contentId,
    );
    if (inlineCandidates.length === 0) return htmlBody;

    let enriched = htmlBody;
    for (const att of inlineCandidates) {
      const cidRaw = att.contentId ?? '';
      const cid = cidRaw.replace(/^<|>$/g, '');
      const referenced =
        enriched.includes(`cid:${cid}`) || enriched.includes(`cid:${cidRaw}`);
      if (!referenced) continue;

      try {
        const { contentBytes, contentType } = await fetchAttachmentBase64({
          mailbox, messageId, attachmentId: att.id,
        });
        if (!contentBytes) continue;
        const dataUrl = `data:${contentType || att.contentType || 'application/octet-stream'};base64,${contentBytes}`;
        enriched = enriched.split(`cid:${cid}`).join(dataUrl);
        enriched = enriched.split(`cid:${cidRaw}`).join(dataUrl);
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
