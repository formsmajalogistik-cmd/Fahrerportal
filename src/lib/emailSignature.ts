// Baut die Maja-Logistik-E-Mail-Signatur für ausgehende Mails. Die
// Signatur wird an alle Posteingang-/Eingangs-/Rechnungs-Mails
// automatisch angehängt — siehe Aufgabe 1.
//
// Wichtig: E-Mail-Clients laden externe Bilder restriktiv. Wir nutzen
// das Maja-Logo unter der aktuellen Origin (z.B. https://app.maja-
// logistik.de/Firmenlogo.png) — das funktioniert, sobald der User
// das Bild in seinem Mail-Client einmal als "vertrauenswürdig" frei-
// gibt. Für Telefon/Mail-Icons setzen wir simple Text-Prefixes
// ("Tel:" / "Mail:" / "Web:" / "Adr:"), die in jedem Mail-Client
// gleich angezeigt werden — Emoji-Glyphen würden je nach Client
// kaputt aussehen.

import type { AppUser } from '../types/db';

export interface SignatureInput {
  vollname: string;
  position: string;
  telefon: string | null;
  email: string;
  logoUrl: string;
}

function logoFromOrigin(): string {
  if (typeof window === 'undefined') {
    return 'https://app.maja-logistik.de/Firmenlogo.png';
  }
  return `${window.location.origin}/Firmenlogo.png`;
}

export function signatureFromProfile(p: AppUser | null): SignatureInput {
  const vorname = (p?.vorname ?? '').trim();
  const nachname = (p?.nachname ?? '').trim();
  const vollname = [vorname, nachname].filter(Boolean).join(' ') || (p?.email ?? '');
  return {
    vollname,
    position: (p?.position ?? '').trim() || 'Maja-Logistik',
    telefon: p?.telefon ?? null,
    email: p?.email ?? '',
    logoUrl: logoFromOrigin(),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] ?? c));
}

/**
 * HTML-Signatur. Bewusst inline-styled, weil Mail-Clients <style>-
 * Tags strippen oder rewriten. Tabellen-Layout statt Flex/Grid, weil
 * Outlook (Word-Renderer) Flex nicht unterstützt.
 */
export function buildSignatureHtml(s: SignatureInput): string {
  const tel = s.telefon?.trim() || '';
  const telHtml = tel
    ? `<p style="margin: 2px 0;">
         <strong>Tel:</strong>
         <a href="tel:${encodeURIComponent(tel)}" style="color: #1B3A5C; text-decoration: none;">${escapeHtml(tel)}</a>
       </p>`
    : '';
  return `
<br/><br/>
<div style="font-family: Arial, sans-serif; color: #333;">
  <p style="margin: 0; font-style: italic; font-size: 14px;">Mit besten Grüßen</p>
  <table cellpadding="0" cellspacing="0" style="margin-top: 10px; border-collapse: collapse;">
    <tr>
      <td style="padding-right: 15px; border-right: 2px solid #5BB5D5; vertical-align: top;">
        <img src="${escapeHtml(s.logoUrl)}" alt="Maja Logistik" width="120" style="display: block; border: 0;" />
      </td>
      <td style="padding-left: 15px; padding-right: 30px; vertical-align: top;">
        <p style="margin: 0; font-size: 16px; font-weight: bold; color: #1B3A5C;">${escapeHtml(s.vollname)}</p>
        <p style="margin: 2px 0 0; font-size: 13px; color: #666;">${escapeHtml(s.position)}</p>
      </td>
      <td style="padding-left: 15px; vertical-align: top; font-size: 13px; color: #333;">
        ${telHtml}
        <p style="margin: 2px 0;">
          <strong>Mail:</strong>
          <a href="mailto:${encodeURIComponent(s.email)}" style="color: #1B3A5C; text-decoration: none;">${escapeHtml(s.email)}</a>
        </p>
        <p style="margin: 2px 0;">
          <strong>Web:</strong>
          <a href="https://www.maja-logistik.de" style="color: #1B3A5C; text-decoration: none;">www.maja-logistik.de</a>
        </p>
        <p style="margin: 2px 0;">
          <strong>Adr:</strong> Heiligenroder Strasse 38e, 28816 Stuhr
        </p>
      </td>
    </tr>
  </table>
</div>`.trim();
}

/**
 * Wandelt einen Plain-Text-Body in HTML um (Escape + <br/>) und hängt
 * die Signatur an. Für reine HTML-Bodies (selten — Antworten bei
 * Posteingang) wandeln wir nicht doppelt.
 */
export function bodyWithSignatureHtml(args: {
  body: string;
  bodyIsHtml?: boolean;
  sig: SignatureInput;
}): string {
  const sigHtml = buildSignatureHtml(args.sig);
  const body = args.body ?? '';
  if (args.bodyIsHtml) {
    return `${body}${sigHtml}`;
  }
  const escaped = escapeHtml(body).replace(/\n/g, '<br/>');
  return `<div style="font-family: Arial, sans-serif; font-size: 14px; color: #1f2937; white-space: normal;">${escaped}</div>${sigHtml}`;
}
