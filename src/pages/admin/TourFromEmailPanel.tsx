import { useMemo, useState } from 'react';
import { EmailMessageHeader, EmailMessageView } from './EmailMessageView';
import { supabase } from '../../lib/supabase';
import { replyToEmail, type MailDetail } from '../../lib/emails';
import { bodyWithSignatureHtml, signatureFromProfile } from '../../lib/emailSignature';
import { useAuth } from '../../auth/AuthContext';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TourCreateDialog } from '../touren/TourCreateDialog';

interface Props {
  mail: MailDetail;
  mailbox: string;
  onClose: () => void;
  onCreated: (label: string) => void;
}

/**
 * Side-by-Side für "Tour aus E-Mail erstellen". Links komplette Mail
 * (Header + Body + Inline-Anhänge), rechts das eingebettete
 * TourCreateDialog mit allen Feldern (Aufgabe 1). Auf schmalen
 * Bildschirmen Tab-Toggle.
 *
 * Zusatz-Workflow: Wenn der Admin in der Tour einen Greimel-Zugang
 * auswählt, wird nach dem Tour-Save eine Auto-Antwort „Bitte Zugang
 * <Nummer>" auf die Ursprungs-E-Mail angeboten. Nutzer entscheidet
 * pro Tour, ob die Antwort rausgeht.
 */
export function TourFromEmailPanel({ mail, mailbox, onClose, onCreated }: Props) {
  const [tab, setTab] = useState<'mail' | 'form'>('mail');
  const { profile } = useAuth();
  const sig = useMemo(() => signatureFromProfile(profile), [profile]);
  const initial = useMemo(() => ({
    kundenname: mail.from.name ?? '',
    info: `Aus E-Mail: ${mail.subject}`,
  }), [mail]);

  /** Nach dem Save offene Auto-Antwort: enthält den Anzeigetext für den
   *  Bestätigungs-Dialog plus die zu sendende Antwort. null = kein
   *  Pending. */
  const [pendingReply, setPendingReply] = useState<null | {
    zugangNumber: string;
    label: string;
  }>(null);
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  /**
   * Erfolgreicher Tour-Save: wenn ein Greimel-Zugang ausgewählt war,
   * holen wir dessen Titel und merken die offene Auto-Antwort.
   * Die Tour-Erstellung selbst läuft IMMER durch — die Antwort ist
   * optional und blockt den Workflow nicht.
   */
  async function handleCreated(info?: { greimelZugangId: string | null }) {
    const tourLabel = `${initial.kundenname || 'Tour'} — ${mail.subject || 'aus E-Mail'}`;
    if (!info?.greimelZugangId) {
      onCreated(tourLabel);
      return;
    }
    try {
      const { data: zug } = await supabase
        .from('greimel_zugaenge')
        .select('titel, benutzername')
        .eq('id', info.greimelZugangId)
        .maybeSingle();
      const number = extractZugangNumber(zug?.titel ?? zug?.benutzername ?? '');
      if (!number) {
        // Kein Nummerteil erkennbar → ohne Auto-Antwort durchstellen.
        onCreated(tourLabel);
        return;
      }
      setPendingReply({ zugangNumber: number, label: tourLabel });
    } catch (err) {
      console.warn('[TourFromEmailPanel] Zugang-Lookup fehlgeschlagen', err);
      onCreated(tourLabel);
    }
  }

  async function confirmReply() {
    if (!pendingReply) return;
    setReplyBusy(true);
    setReplyError(null);
    try {
      const text = `Bitte Zugang ${pendingReply.zugangNumber}`;
      const html = bodyWithSignatureHtml({ body: text, sig });
      await replyToEmail({
        mailbox,
        messageId: mail.id,
        bodyHtml: html,
      });
      const label = pendingReply.label;
      setPendingReply(null);
      onCreated(`${label} — Antwort gesendet: Bitte Zugang ${pendingReply.zugangNumber}`);
    } catch (err) {
      setReplyError(err instanceof Error
        ? `Antwort konnte nicht gesendet werden — bitte manuell antworten. (${err.message})`
        : 'Antwort konnte nicht gesendet werden — bitte manuell antworten.');
    } finally {
      setReplyBusy(false);
    }
  }

  function declineReply() {
    if (!pendingReply) return;
    const label = pendingReply.label;
    setPendingReply(null);
    onCreated(label);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-maja-navy">
          Tour aus E-Mail erstellen
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-maja-navy/15 bg-white p-0.5 md:hidden">
            <TabButton active={tab === 'mail'} onClick={() => setTab('mail')}>E-Mail</TabButton>
            <TabButton active={tab === 'form'} onClick={() => setTab('form')}>Tour</TabButton>
          </div>
          <button type="button" className="btn-secondary text-sm" onClick={onClose}>
            Zurück zum Posteingang
          </button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden md:grid-cols-2">
        <div
          className={`${tab === 'mail' ? '' : 'hidden'} min-h-0 md:block md:overflow-y-auto md:overscroll-contain`}
        >
          <div className="card flex flex-col p-5">
            <EmailMessageHeader mail={mail} />
            <EmailMessageView mail={mail} mailbox={mailbox} />
          </div>
        </div>
        <div
          className={`${tab === 'form' ? '' : 'hidden'} min-h-0 pb-12 md:block md:overflow-y-auto md:overscroll-contain`}
        >
          <TourCreateDialog
            variant="embedded"
            initial={initial}
            onClose={onClose}
            onCreated={(info) => void handleCreated(info)}
          />
        </div>
      </div>

      {pendingReply && (
        <ConfirmDialog
          title="Zugang anfordern?"
          message={
            <>
              Soll eine Antwort auf die E-Mail gesendet werden mit:
              {' '}<strong>„Bitte Zugang {pendingReply.zugangNumber}"</strong>?
              {replyError && (
                <div role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                  {replyError}
                </div>
              )}
            </>
          }
          confirmLabel={replyBusy ? 'Sendet …' : 'Ja, senden'}
          cancelLabel="Nein"
          onConfirm={confirmReply}
          onClose={declineReply}
        />
      )}
    </div>
  );
}

/**
 * Aus einem Zugangs-Titel wie „Zugang 2", „Greimel Zugang Nr. 3"
 * oder „GRE-04" die erste Ziffernfolge ziehen — sie landet als
 * Nummer in der Antwort.
 */
function extractZugangNumber(titel: string): string | null {
  const m = titel.match(/\d+/);
  return m ? m[0] : null;
}

function TabButton({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1 text-xs font-medium ${
        active ? 'bg-maja-navy text-white' : 'text-maja-navy hover:bg-maja-light'
      }`}
    >
      {children}
    </button>
  );
}
