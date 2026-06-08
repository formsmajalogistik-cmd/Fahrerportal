import { useMemo, useState } from 'react';
import { EmailMessageHeader, EmailMessageView } from './EmailMessageView';
import type { MailDetail } from '../../lib/emails';
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
 */
export function TourFromEmailPanel({ mail, mailbox, onClose, onCreated }: Props) {
  const [tab, setTab] = useState<'mail' | 'form'>('mail');
  const initial = useMemo(() => ({
    kundenname: mail.from.name ?? '',
    info: `Aus E-Mail: ${mail.subject}`,
  }), [mail]);
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
      {/*
        Side-by-Side mit unabhängigem Scrollverhalten. Das Grid bekommt
        `flex-1 min-h-0`, damit es den verbleibenden Raum des Eltern-
        Containers ausfüllt — KEINE eigene viewport-Höhenrechnung. So
        wird der Speichern-Button am Ende des Formulars rechts nicht
        mehr abgeschnitten.
      */}
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
            onCreated={() => {
              const label = `${initial.kundenname || 'Tour'} — ${mail.subject || 'aus E-Mail'}`;
              onCreated(label);
            }}
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
