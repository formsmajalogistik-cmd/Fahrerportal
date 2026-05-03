import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from '../components/Spinner';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { GreimelZugangEditDialog } from './greimel/GreimelZugangEditDialog';
import { displayName } from '../lib/names';
import type { AppUser, Fahrer, GreimelZugang } from '../types/db';

type FahrerWithUser = Fahrer & { user: Pick<AppUser, 'email' | 'vorname' | 'nachname'> | null };

export function GreimelZugaengePage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [zugaenge, setZugaenge] = useState<GreimelZugang[]>([]);
  const [fahrer, setFahrer] = useState<FahrerWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [editing, setEditing] = useState<GreimelZugang | 'new' | null>(null);
  const [deleting, setDeleting] = useState<GreimelZugang | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [zRes, fRes] = await Promise.all([
      supabase.from('greimel_zugaenge').select('*').order('titel'),
      isAdmin
        ? supabase
            .from('fahrer')
            .select('*, user:user_id (email, vorname, nachname)')
            .eq('aktiv', true)
        : Promise.resolve({ data: [] as unknown[], error: null }),
    ]);
    if (zRes.error) { setError(zRes.error.message); setLoading(false); return; }
    setZugaenge(Array.isArray(zRes.data) ? (zRes.data as GreimelZugang[]) : []);
    setFahrer(Array.isArray(fRes.data) ? (fRes.data as unknown as FahrerWithUser[]) : []);
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => { void load(); }, [load]);

  const fahrerById = useMemo(() => {
    const m = new Map<string, FahrerWithUser>();
    for (const f of fahrer) m.set(f.id, f);
    return m;
  }, [fahrer]);

  async function handleDelete(z: GreimelZugang) {
    const { error: err } = await supabase.from('greimel_zugaenge').delete().eq('id', z.id);
    if (err) throw err;
    setDeleting(null);
    void load();
  }

  if (loading) return <Spinner label="Greimel Zugänge werden geladen …" />;
  if (error)   return <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-maja-navy">Greimel Zugänge</h1>
          <p className="text-sm text-maja-muted">
            {isAdmin
              ? 'Logins für externe Greimel-Portale verwalten und Fahrern zuweisen.'
              : 'Deine zugewiesenen Greimel-Logins.'}
          </p>
        </div>
        {isAdmin && (
          <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
            + Neuen Zugang anlegen
          </button>
        )}
      </div>

      {zugaenge.length === 0 ? (
        <div className="card p-6 text-sm text-maja-muted">
          {isAdmin
            ? 'Noch keine Zugänge angelegt.'
            : 'Dir sind aktuell keine Greimel-Zugänge zugewiesen.'}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {zugaenge.map((z) => (
            <ZugangCard
              key={z.id}
              zugang={z}
              isAdmin={isAdmin}
              fahrerById={fahrerById}
              onEdit={() => setEditing(z)}
              onDelete={() => setDeleting(z)}
            />
          ))}
        </ul>
      )}

      {editing && isAdmin && (
        <GreimelZugangEditDialog
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}

      {deleting && isAdmin && (
        <ConfirmDialog
          title="Zugang löschen?"
          message={
            <>Soll der Zugang „<strong>{deleting.titel}</strong>" wirklich gelöscht werden?</>
          }
          confirmLabel="Löschen"
          destructive
          onConfirm={() => handleDelete(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

interface CardProps {
  zugang: GreimelZugang;
  isAdmin: boolean;
  fahrerById: Map<string, FahrerWithUser>;
  onEdit: () => void;
  onDelete: () => void;
}

function ZugangCard({ zugang, isAdmin, fahrerById, onEdit, onDelete }: CardProps) {
  const [showPw, setShowPw] = useState(false);
  const [copied, setCopied] = useState<'user' | 'pw' | null>(null);

  async function copy(text: string, kind: 'user' | 'pw') {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1500);
    } catch (err) {
      console.warn('Clipboard-Copy fehlgeschlagen', err);
    }
  }

  const fahrerNamen = (zugang.fahrer_ids ?? [])
    .map((id) => {
      const f = fahrerById.get(id);
      return f ? displayName(f.user ?? null) : null;
    })
    .filter(Boolean) as string[];

  return (
    <li className="card p-5 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold text-maja-navy">{zugang.titel}</h3>
        {isAdmin && (
          <div className="flex shrink-0 gap-1">
            <button type="button" onClick={onEdit}
                    className="text-xs font-medium text-maja-accent hover:underline">
              Bearbeiten
            </button>
            <button type="button" onClick={onDelete}
                    className="text-xs font-medium text-red-600 hover:underline">
              Löschen
            </button>
          </div>
        )}
      </div>

      {/* Benutzername */}
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-maja-muted">Benutzername</div>
        <div className="mt-0.5 flex items-center gap-2 text-sm">
          <span className="font-mono text-maja-ink break-all">{zugang.benutzername}</span>
          <button
            type="button"
            onClick={() => void copy(zugang.benutzername, 'user')}
            className="rounded-md p-1 text-maja-muted hover:bg-maja-light"
            aria-label="Benutzername kopieren"
            title="Kopieren"
          >
            {copied === 'user' ? <span className="text-xs text-emerald-700">Kopiert!</span> : <IconCopy />}
          </button>
        </div>
      </div>

      {/* Passwort */}
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-maja-muted">Passwort</div>
        <div className="mt-0.5 flex items-center gap-2 text-sm">
          <span className="font-mono text-maja-ink break-all">
            {showPw ? zugang.passwort : '••••••••'}
          </span>
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            className="rounded-md p-1 text-maja-muted hover:bg-maja-light"
            aria-label={showPw ? 'Passwort verbergen' : 'Passwort anzeigen'}
            title={showPw ? 'Verbergen' : 'Anzeigen'}
          >
            {showPw ? <IconEyeOff /> : <IconEye />}
          </button>
          <button
            type="button"
            onClick={() => void copy(zugang.passwort, 'pw')}
            className="rounded-md p-1 text-maja-muted hover:bg-maja-light"
            aria-label="Passwort kopieren"
            title="Kopieren"
          >
            {copied === 'pw' ? <span className="text-xs text-emerald-700">Kopiert!</span> : <IconCopy />}
          </button>
        </div>
      </div>

      {/* Link */}
      {zugang.link && (
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-maja-muted">Link</div>
          <a
            href={zugang.link}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 block text-sm font-medium text-maja-accent break-all hover:underline"
          >
            {zugang.link}
          </a>
        </div>
      )}

      {/* Fahrer-Zuweisung — nur Admin */}
      {isAdmin && (
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-maja-muted">
            Zugewiesen an
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {zugang.sichtbar_fuer_alle ? (
              <span className="inline-block rounded-full bg-maja-navy px-2 py-0.5 text-xs font-medium text-white">
                Alle Fahrer
              </span>
            ) : fahrerNamen.length === 0 ? (
              <span className="text-xs text-maja-muted">Nicht zugewiesen</span>
            ) : (
              fahrerNamen.map((n) => (
                <span key={n} className="inline-block rounded-full bg-maja-light px-2 py-0.5 text-xs font-medium text-maja-navy">
                  {n}
                </span>
              ))
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function IconCopy() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M7 3a2 2 0 00-2 2v8a2 2 0 002 2h6a2 2 0 002-2V7.5L11.5 3H7zm4 0v4h4l-4-4z" opacity="0.4" />
      <path d="M5 5a2 2 0 012-2h4l4 4v6a2 2 0 01-2 2H7a2 2 0 01-2-2V5zm-2 4a2 2 0 00-2 2v6a2 2 0 002 2h6a2 2 0 002-2v-1H5a2 2 0 01-2-2V9z" />
    </svg>
  );
}
function IconEye() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M10 4C5.5 4 2 8 2 10c0 2 3.5 6 8 6s8-4 8-6c0-2-3.5-6-8-6zm0 9.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7zm0-2a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
    </svg>
  );
}
function IconEyeOff() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M3.28 2.22a.75.75 0 00-1.06 1.06l1.6 1.6C2.5 6.05 1.5 7.4 1.5 8.5c0 1.8 3.4 5.5 8.5 5.5 1.36 0 2.6-.27 3.7-.7l2.02 2.02a.75.75 0 101.06-1.06L3.28 2.22zM10 12.5c-1.93 0-3.5-1.57-3.5-3.5 0-.55.13-1.07.36-1.53l1.16 1.16a2 2 0 002.85 2.85l1.16 1.16c-.46.23-.98.36-1.53.36zM10 5.5c1.93 0 3.5 1.57 3.5 3.5 0 .49-.1.95-.28 1.37l1.62 1.62c1.4-1.18 2.16-2.49 2.16-3 0-1.8-3.4-5.5-8.5-5.5-.6 0-1.18.06-1.74.16l1.61 1.61c.21-.06.43-.07.63-.07z" />
    </svg>
  );
}
