import { useState } from 'react';
import { BelegeUploadTab } from './belege/BelegeUploadTab';
import { AufstellungTab } from './belege/AufstellungTab';

type Tab = 'belege' | 'aufstellung';

export function BelegePage() {
  const [tab, setTab] = useState<Tab>('belege');
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-maja-navy">Belege</h1>
        <p className="text-sm text-maja-muted">
          Beleg-PDFs aus Smartphone-Fotos zusammenstellen oder Touren-Aufstellung pro Fahrer erzeugen.
        </p>
      </div>

      <nav className="border-b border-maja-navy/10">
        <ul className="flex flex-wrap gap-1">
          {([
            { id: 'belege',      label: 'Belege' },
            { id: 'aufstellung', label: 'Aufstellung' },
          ] as Array<{ id: Tab; label: string }>).map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setTab(t.id)}
                className={`inline-block rounded-t-lg px-4 py-2 text-sm font-medium transition ${
                  tab === t.id
                    ? 'border-b-2 border-maja-navy bg-white text-maja-navy'
                    : 'text-maja-muted hover:bg-maja-light hover:text-maja-navy'
                }`}
              >
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {tab === 'belege' && <BelegeUploadTab />}
      {tab === 'aufstellung' && <AufstellungTab />}
    </div>
  );
}
