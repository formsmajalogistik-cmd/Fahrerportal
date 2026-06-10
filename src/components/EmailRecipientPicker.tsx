// Geteilter Empfänger-Picker für E-Mail-Dialoge: Chip-Eingabe mit
// Dropdown aus Favoriten (mit Stern-Toggle) + Auftraggeber-Adressen.
// Extrahiert aus EingangSendEmailDialog, damit auch der Posteingang-
// Composer (Weiterleiten/Neue Mail) dieselbe Auswahl bekommt.

import {
  useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent,
} from 'react';
import { supabase } from '../lib/supabase';
import { XIcon } from './icons';
import type { EmailFavorit } from '../types/db';

export interface EmailOption {
  email: string;
  name: string | null;
  source: 'favorit' | 'auftraggeber';
  favoritId?: string;
  ist_favorit: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const norm = (s: string) => s.trim().toLowerCase();
const splitList = (s: string) => s.split(/[,;]+/).map((x) => x.trim()).filter(Boolean);

/**
 * Lädt Favoriten + alle Auftraggeber-Adressen (email1/email2 +
 * Kontakte) und liefert sie als deduplizierte Options-Liste samt
 * Favorit-Toggle.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useEmailOptions(): {
  options: EmailOption[];
  loading: boolean;
  toggleFavorit: (opt: EmailOption) => Promise<void>;
} {
  const [options, setOptions] = useState<EmailOption[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const favRes = await supabase
      .from('email_favoriten')
      .select('id, email, name, ist_favorit')
      .order('ist_favorit', { ascending: false })
      .order('email', { ascending: true });
    const favs: EmailFavorit[] = (favRes.data as EmailFavorit[]) ?? [];

    const agRes = await supabase
      .from('auftraggeber')
      .select('name, email1, email2')
      .order('name', { ascending: true });
    type AgRow = { name: string; email1: string | null; email2: string | null };
    const ag: AgRow[] = (agRes.data as AgRow[]) ?? [];

    const kRes = await supabase
      .from('auftraggeber_kontakte')
      .select('name, email, auftraggeber:auftraggeber_id (name)')
      .not('email', 'is', null);
    type KRow = { name: string | null; email: string | null; auftraggeber: { name: string } | null };
    const kontakte: KRow[] = (kRes.data as unknown as KRow[]) ?? [];

    const byEmail = new Map<string, EmailOption>();
    for (const f of favs) {
      if (!f.email || !EMAIL_RE.test(f.email)) continue;
      byEmail.set(norm(f.email), {
        email: f.email,
        name: f.name ?? null,
        source: 'favorit',
        favoritId: f.id,
        ist_favorit: !!f.ist_favorit,
      });
    }
    const addAg = (email: string | null, name: string | null) => {
      if (!email) return;
      const trimmed = email.trim();
      if (!EMAIL_RE.test(trimmed)) return;
      const key = norm(trimmed);
      if (byEmail.has(key)) return;
      byEmail.set(key, {
        email: trimmed,
        name: name?.trim() || null,
        source: 'auftraggeber',
        ist_favorit: false,
      });
    };
    for (const a of ag) {
      addAg(a.email1, a.name);
      addAg(a.email2, a.name);
    }
    for (const k of kontakte) {
      addAg(k.email, k.name?.trim() || k.auftraggeber?.name || null);
    }
    setOptions([...byEmail.values()]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => { void reload(); });
  }, [reload]);

  const toggleFavorit = useCallback(async (opt: EmailOption) => {
    if (opt.favoritId) {
      await supabase
        .from('email_favoriten')
        .update({ ist_favorit: !opt.ist_favorit })
        .eq('id', opt.favoritId);
    } else {
      await supabase
        .from('email_favoriten')
        .insert({ email: opt.email, name: opt.name, ist_favorit: true });
    }
    await reload();
  }, [reload]);

  return { options, loading, toggleFavorit };
}

interface PickerProps {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  options: EmailOption[];
  optionsLoading: boolean;
  onToggleFavorit: (opt: EmailOption) => void;
}

export function EmailRecipientPicker({
  label, value, onChange, options, optionsLoading, onToggleFavorit,
}: PickerProps) {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputId = useId();

  useEffect(() => {
    function onDocClick(ev: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(ev.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function addTag(raw: string) {
    const candidates = splitList(raw);
    if (candidates.length === 0) return;
    const present = new Set(value.map(norm));
    const additions: string[] = [];
    for (const c of candidates) {
      if (!EMAIL_RE.test(c)) continue;
      const k = norm(c);
      if (present.has(k)) continue;
      present.add(k);
      additions.push(c);
    }
    if (additions.length > 0) onChange([...value, ...additions]);
    setInput('');
  }

  function onKeyDown(ev: KeyboardEvent<HTMLInputElement>) {
    if (ev.key === 'Enter' || ev.key === ',' || ev.key === ';') {
      ev.preventDefault();
      if (input.trim()) addTag(input);
    } else if (ev.key === 'Backspace' && input === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    } else if (ev.key === 'Escape') {
      setOpen(false);
    }
  }

  const filtered = useMemo(() => {
    const q = norm(input);
    const taken = new Set(value.map(norm));
    const visible = options
      .filter((o) => !taken.has(norm(o.email)))
      .filter((o) => !q || norm(o.email).includes(q) || (o.name && norm(o.name).includes(q)));
    return {
      fav: visible.filter((o) => o.ist_favorit),
      rest: visible.filter((o) => !o.ist_favorit),
    };
  }, [options, input, value]);

  return (
    <div ref={wrapperRef} className="relative">
      <label htmlFor={inputId} className="label">{label}</label>
      <div
        className="input flex flex-wrap items-center gap-1 px-2 py-1"
        onClick={() => document.getElementById(inputId)?.focus()}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-maja-navy/10 px-2 py-0.5 text-xs text-maja-navy"
          >
            {tag}
            <button
              type="button"
              onClick={() => onChange(value.filter((v) => v !== tag))}
              className="rounded-full p-0.5 text-maja-navy/70 hover:bg-maja-navy/15"
              aria-label={`${tag} entfernen`}
            >
              <XIcon className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          id={inputId}
          type="email"
          className="min-w-[8rem] flex-1 border-0 bg-transparent px-1 py-1 text-sm outline-none focus:ring-0"
          value={input}
          onChange={(e) => { setInput(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onBlur={() => { if (input.trim() && EMAIL_RE.test(input.trim())) addTag(input); }}
          placeholder={value.length === 0 ? 'E-Mail-Adresse eingeben oder auswählen …' : ''}
        />
      </div>
      {open && (optionsLoading || filtered.fav.length > 0 || filtered.rest.length > 0) && (
        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-maja-navy/15 bg-white shadow-lg">
          {optionsLoading && (
            <p className="px-3 py-2 text-xs text-maja-muted">Lade Adressen …</p>
          )}
          {filtered.fav.length > 0 && (
            <div>
              <div className="border-b border-maja-navy/10 bg-maja-light/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-maja-navy">
                Favoriten
              </div>
              {filtered.fav.map((o) => (
                <OptionRow key={`fav-${norm(o.email)}`} opt={o}
                           onSelect={() => { addTag(o.email); setOpen(false); }}
                           onToggle={() => onToggleFavorit(o)} />
              ))}
            </div>
          )}
          {filtered.rest.length > 0 && (
            <div>
              {filtered.fav.length > 0 && (
                <div className="border-b border-maja-navy/10 bg-maja-light/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-maja-navy">
                  Auftraggeber
                </div>
              )}
              {filtered.rest.map((o) => (
                <OptionRow key={`ag-${norm(o.email)}`} opt={o}
                           onSelect={() => { addTag(o.email); setOpen(false); }}
                           onToggle={() => onToggleFavorit(o)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OptionRow({
  opt, onSelect, onToggle,
}: { opt: EmailOption; onSelect: () => void; onToggle: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-maja-navy/5 px-3 py-1.5 text-sm last:border-b-0 hover:bg-maja-light/40">
      <button
        type="button"
        onClick={onToggle}
        className={'p-0.5 ' + (opt.ist_favorit ? 'text-amber-500' : 'text-maja-muted hover:text-amber-500')}
        aria-label={opt.ist_favorit ? 'Favorit entfernen' : 'Als Favorit markieren'}
        title={opt.ist_favorit ? 'Favorit entfernen' : 'Als Favorit markieren'}
      >
        <StarIcon className="h-4 w-4" filled={opt.ist_favorit} />
      </button>
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-maja-ink">
          {opt.name ? <span className="font-medium">{opt.name} — </span> : null}
          {opt.email}
        </span>
      </button>
    </div>
  );
}

function StarIcon({ className, filled }: { className?: string; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9 12 2" />
    </svg>
  );
}
