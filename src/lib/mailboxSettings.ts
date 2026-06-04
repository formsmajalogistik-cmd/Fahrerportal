// Mailbox-Konfiguration aus app_settings (Posteingang-Postfächer).
// Keys: mail_inbox_1, mail_inbox_2.
//
// Statt eigener Tabelle bzw. fester Liste landen die zwei Postfächer
// als JSON in app_settings — der Server-Guard /api/mailboxAuth liest
// dieselben Keys, damit nur freigeschaltete Adressen über den
// globalen Graph-Token angesprochen werden.

import { supabase } from './supabase';

export interface MailboxConfig {
  key: 'mail_inbox_1' | 'mail_inbox_2';
  address: string;
  label: string;
}

const KEYS: Array<MailboxConfig['key']> = ['mail_inbox_1', 'mail_inbox_2'];

export async function loadMailboxes(): Promise<MailboxConfig[]> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', KEYS);
  if (error) {
    console.warn('[mailboxSettings.load]', error.message);
    return [];
  }
  type Row = { key: string; value: { address?: string; label?: string } | null };
  const map = new Map<string, MailboxConfig>();
  for (const r of (data ?? []) as Row[]) {
    if (!KEYS.includes(r.key as MailboxConfig['key'])) continue;
    const address = r.value?.address ?? '';
    const label = r.value?.label ?? '';
    map.set(r.key, { key: r.key as MailboxConfig['key'], address, label });
  }
  return KEYS.map((k) => map.get(k) ?? { key: k, address: '', label: '' });
}

export async function saveMailbox(cfg: MailboxConfig): Promise<void> {
  const { error } = await supabase
    .from('app_settings')
    .upsert(
      { key: cfg.key, value: { address: cfg.address.trim(), label: cfg.label.trim() } },
      { onConflict: 'key' },
    );
  if (error) throw new Error(error.message);
}
