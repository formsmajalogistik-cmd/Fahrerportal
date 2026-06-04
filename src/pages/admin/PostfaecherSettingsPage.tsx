import { useEffect, useState } from 'react';
import { Spinner } from '../../components/Spinner';
import {
  loadMailboxes, saveMailbox, type MailboxConfig,
} from '../../lib/mailboxSettings';
import { listEmails } from '../../lib/emails';

/**
 * Admin-Einstellung: bis zu zwei E-Mail-Postfächer, die der
 * Posteingang-Reiter abfragen darf. Adresse + freiwilliges Label.
 * Über "Verbindung testen" wird /api/emails einmal mit page=1,
 * pageSize=1 gepingt — Erfolg / Fehler-Status erscheint inline.
 */
export function PostfaecherSettingsPage() {
  const [items, setItems] = useState<MailboxConfig[] | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<Record<string, { ok: boolean; msg: string }>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await loadMailboxes();
      if (!cancelled) setItems(list);
    })();
    return () => { cancelled = true; };
  }, []);

  function patch(key: string, p: Partial<MailboxConfig>) {
    setItems((prev) => (prev ?? []).map((m) => (m.key === key ? { ...m, ...p } : m)));
  }

  async function handleSave(cfg: MailboxConfig) {
    setSavingKey(cfg.key);
    try {
      await saveMailbox(cfg);
      setTestStatus((prev) => ({ ...prev, [cfg.key]: { ok: true, msg: 'Gespeichert.' } }));
    } catch (err) {
      setTestStatus((prev) => ({
        ...prev,
        [cfg.key]: { ok: false, msg: err instanceof Error ? err.message : 'Fehler beim Speichern' },
      }));
    } finally {
      setSavingKey(null);
    }
  }

  async function handleTest(cfg: MailboxConfig) {
    if (!cfg.address.trim()) {
      setTestStatus((prev) => ({ ...prev, [cfg.key]: { ok: false, msg: 'Adresse fehlt.' } }));
      return;
    }
    setTestStatus((prev) => ({ ...prev, [cfg.key]: { ok: true, msg: 'Teste …' } }));
    try {
      const r = await listEmails({ mailbox: cfg.address, page: 1, pageSize: 1 });
      setTestStatus((prev) => ({
        ...prev,
        [cfg.key]: {
          ok: true,
          msg: `Verbunden — ${r.totalCount ?? r.value.length} Nachrichten erreichbar.`,
        },
      }));
    } catch (err) {
      setTestStatus((prev) => ({
        ...prev,
        [cfg.key]: { ok: false, msg: err instanceof Error ? err.message : 'Verbindung fehlgeschlagen' },
      }));
    }
  }

  if (items === null) return <Spinner label="Postfächer werden geladen …" />;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-maja-navy">E-Mail-Postfächer</h2>
        <p className="text-sm text-maja-muted">
          Bis zu zwei Postfächer werden im Reiter „Posteingang" angezeigt.
          Postfach 1 ist Default. Die App nutzt den globalen Microsoft-Graph-
          Service-Account; die Adresse muss in der Azure-App-Registration
          freigeschaltet sein.
        </p>
      </div>
      <div className="space-y-4">
        {items.map((cfg, idx) => {
          const status = testStatus[cfg.key];
          return (
            <div key={cfg.key} className="card space-y-3 p-4">
              <div className="flex items-baseline justify-between">
                <h3 className="text-base font-semibold text-maja-navy">
                  Postfach {idx + 1}{idx === 0 ? ' (Default)' : ''}
                </h3>
                {status && (
                  <span className={`text-xs ${status.ok ? 'text-emerald-700' : 'text-red-700'}`}>
                    {status.msg}
                  </span>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={`addr-${cfg.key}`} className="label">E-Mail-Adresse</label>
                  <input
                    id={`addr-${cfg.key}`}
                    type="email"
                    className="input"
                    value={cfg.address}
                    onChange={(e) => patch(cfg.key, { address: e.target.value })}
                    placeholder="info@maja-logistik.de"
                  />
                </div>
                <div>
                  <label htmlFor={`label-${cfg.key}`} className="label">Anzeige-Name (optional)</label>
                  <input
                    id={`label-${cfg.key}`}
                    className="input"
                    value={cfg.label}
                    onChange={(e) => patch(cfg.key, { label: e.target.value })}
                    placeholder="Info / Protokollierung"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary text-sm"
                  onClick={() => void handleSave(cfg)}
                  disabled={savingKey === cfg.key}
                >
                  {savingKey === cfg.key ? 'Speichert …' : 'Speichern'}
                </button>
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  onClick={() => void handleTest(cfg)}
                >
                  Verbindung testen
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
