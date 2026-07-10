import { useState } from 'react';
import { EmailThreadView } from './EmailMessageView';
import type { MailDetail } from '../../lib/emails';
import { TourDetailDialog } from '../touren/TourDetailDialog';

interface Props {
  mail: MailDetail;
  /** Ganze Konversation (chronologisch, inkl. eigener Antworten). */
  thread?: MailDetail[] | null;
  ownAddresses?: string[];
  mailbox: string;
  tourId: string;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Side-by-Side: links die E-Mail (mit Inline-Anhängen), rechts die
 * gewählte bestehende Tour im Bearbeiten-Modus (Aufgabe 4 "Tour
 * öffnen"). TourDetailDialog läuft im neuen variant="embedded" und
 * öffnet sich beim Mount direkt in den Edit-Modus.
 */
export function TourEditFromEmailPanel({ mail, thread, ownAddresses, mailbox, tourId, onClose, onSaved }: Props) {
  const [tab, setTab] = useState<'mail' | 'form'>('mail');
  // Wenn die Tour gelöscht wird, schließen wir das Panel — das ist
  // dieselbe Semantik wie im normalen TourDetailDialog.
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-maja-navy">
          Tour bearbeiten — aus E-Mail
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
          <EmailThreadView
            thread={thread && thread.length > 0 ? thread : [mail]}
            mailbox={mailbox}
            ownAddresses={ownAddresses}
          />
        </div>
        <div
          className={`${tab === 'form' ? '' : 'hidden'} min-h-0 pb-12 md:block md:overflow-y-auto md:overscroll-contain`}
        >
          <TourDetailDialog
            tourId={tourId}
            variant="embedded"
            startInEditMode
            onClose={onClose}
            onChanged={() => { onSaved(); }}
            onDeleted={() => { onClose(); }}
          />
        </div>
      </div>
    </div>
  );
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
