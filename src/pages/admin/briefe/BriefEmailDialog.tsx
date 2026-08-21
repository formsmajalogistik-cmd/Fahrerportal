// Brief per E-Mail versenden (Migration 091).
//
// Gleicher Ablauf wie beim Rechnungsversand: Empfänger frei eingebbar,
// "Von:"-Postfach mit info@ als Default, Betreff und Text vorbelegt und
// editierbar, Signatur automatisch, die Brief-PDF als Anhang, eigene
// Dateien zusätzlich anhängbar.

import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../../lib/supabase';
import { sendEmail, uploadToOneDrive } from '../../../lib/onedrive';
import { useAuth } from '../../../auth/AuthContext';
import { useTestGuard } from '../../../auth/TestModeContext';
import { useScrollLock } from '../../../lib/useScrollLock';
import { bodyWithSignatureHtml, signatureFromProfile } from '../../../lib/emailSignature';
import { XIcon } from '../../../components/icons';
import { loadMailboxes, type MailboxConfig } from '../../../lib/mailboxSettings';
import { briefPdfFilename } from './briefPdf';
import { empfaengerAnzeige, parseBriefAdresse, type Brief } from '../../../lib/briefe';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  brief: Brief;
  onClose: () => void;
  onSent: () => void;
}

export function BriefEmailDialog({ brief, onClose, onSent }: Props) {
  useScrollLock();
  const { profile } = useAuth();
  const guard = useTestGuard();
  const adresse = parseBriefAdresse(brief.adress_snapshot);

  const [to, setTo] = useState('');
  const [from, setFrom] = useState('');
  const [mailboxes, setMailboxes] = useState<MailboxConfig[]>([]);
  const [subject, setSubject] = useState(
    `${brief.betreff?.trim() || 'Schreiben'} — Maja-Logistik`,
  );
  const [body, setBody] = useState(
    `Guten Tag,\n\nanbei erhalten Sie unser Schreiben ${brief.brief_nr}.\n\n`
    + 'Mit freundlichen Grüßen',
  );
  const [extraDateien, setExtraDateien] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    void loadMailboxes().then((mbs) => {
      const nutzbar = mbs.filter((m) => m.address.trim() !== '');
      setMailboxes(nutzbar);
      const def = nutzbar.find((m) => m.key === 'mail_inbox_1') ?? nutzbar[0];
      if (def) setFrom(def.address);
    });
  }, []);

  async function absenden(e: FormEvent) {
    e.preventDefault();
    setFehler(null);
    const empfaenger = to.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    if (empfaenger.length === 0 || empfaenger.some((x) => !EMAIL_RE.test(x))) {
      setFehler('Bitte mindestens eine gültige E-Mail-Adresse angeben.');
      return;
    }
    if (!brief.pdf_url) {
      setFehler('Es gibt noch keine PDF. Bitte zuerst „PDF erzeugen".');
      return;
    }
    if (guard()) return;
    setBusy(true);
    try {
      const anhaenge: Array<{ name: string; contentType: string; onedrive_path: string }> = [{
        name: briefPdfFilename(brief.brief_nr),
        contentType: 'application/pdf',
        // Unterschriebene Fassung bevorzugen, wenn vorhanden.
        onedrive_path: brief.pdf_signiert_url ?? brief.pdf_url,
      }];
      // Eigene Dateien zuerst nach OneDrive, dann als Anhang referenzieren.
      for (const datei of extraDateien) {
        const pfad = `Maja-Logistik/Briefe/Anhaenge/${Date.now()}-${datei.name}`;
        await uploadToOneDrive(pfad, datei);
        anhaenge.push({
          name: datei.name,
          contentType: datei.type || 'application/octet-stream',
          onedrive_path: pfad,
        });
      }
      const sig = signatureFromProfile(profile ?? null);
      const bodyHtml = bodyWithSignatureHtml({ body, sig });
      const res = await sendEmail({
        to: empfaenger, subject, body, bodyHtml,
        from: from || undefined,
        attachments: anhaenge,
      });
      if (res.missing.length > 0) {
        setFehler(`Versendet, aber ${res.missing.length} Anhang/Anhänge fehlten.`);
      }
      await supabase.from('briefe')
        .update({ email_versendet_am: new Date().toISOString() })
        .eq('id', brief.id);
      onSent();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Versand fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-maja-ink/40 px-4 py-8">
      <form onSubmit={absenden} className="card w-full max-w-2xl space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-maja-navy">Brief per E-Mail versenden</h2>
            <p className="text-xs text-maja-muted">
              {brief.brief_nr} an {empfaengerAnzeige(adresse)}
            </p>
          </div>
          <button type="button" onClick={onClose}
                  className="rounded-md p-1 text-maja-muted hover:bg-maja-light"
                  aria-label="Schließen">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {fehler && (
          <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="bm-von" className="label">Von</label>
            <select id="bm-von" className="input" value={from}
                    onChange={(e) => setFrom(e.target.value)}>
              {mailboxes.map((m) => (
                <option key={m.key} value={m.address}>{m.address}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="bm-an" className="label">An</label>
            <input id="bm-an" className="input" value={to}
                   onChange={(e) => setTo(e.target.value)}
                   placeholder="empfaenger@beispiel.de" />
          </div>
        </div>

        <div>
          <label htmlFor="bm-betreff" className="label">Betreff</label>
          <input id="bm-betreff" className="input" value={subject}
                 onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div>
          <label htmlFor="bm-text" className="label">Text</label>
          <textarea id="bm-text" className="input min-h-[9rem]" value={body}
                    onChange={(e) => setBody(e.target.value)} />
          <p className="mt-1 text-xs text-maja-muted">
            Die Signatur wird automatisch angehängt.
          </p>
        </div>

        <div>
          <label htmlFor="bm-dateien" className="label">Weitere Anhänge</label>
          <input id="bm-dateien" type="file" multiple className="input"
                 onChange={(e) => setExtraDateien(Array.from(e.target.files ?? []))} />
          <p className="mt-1 text-xs text-maja-muted">
            Die Brief-PDF hängt bereits an
            {brief.pdf_signiert_url ? ' (unterschriebene Fassung).' : '.'}
          </p>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Wird versendet …' : 'Versenden'}
          </button>
        </div>
      </form>
    </div>
  );
}
