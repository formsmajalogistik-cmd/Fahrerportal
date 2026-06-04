import { useState } from 'react';
import { EmailMessageHeader, EmailMessageView } from './EmailMessageView';
import type { MailDetail } from '../../lib/emails';
import { TourDetailDialog } from '../touren/TourDetailDialog';

interface Props {
  mail: MailDetail;
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
export function TourEditFromEmailPanel({ mail, mailbox, tourId, onClose, onSaved }: Props) {
  const [tab, setTab] = useState<'mail' | 'form'>('mail');
  // Wenn die Tour gelöscht wird, schließen wir das Panel — das ist
  // dieselbe Semantik wie im normalen TourDetailDialog.
  return (
    <div className="space-y-3">
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
      <div className="grid gap-4 md:grid-cols-2 md:h-[calc(100vh-12rem)] md:overflow-hidden">
        <div
          className={`${tab === 'mail' ? '' : 'hidden'} md:block md:h-full md:overflow-y-auto md:overscroll-contain`}
        >
          <div className="card flex flex-col p-5">
            <EmailMessageHeader mail={mail} />
            <EmailMessageView mail={mail} mailbox={mailbox} />
          </div>
        </div>
        <div
          className={`${tab === 'form' ? '' : 'hidden'} md:block md:h-full md:overflow-y-auto md:overscroll-contain`}
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
