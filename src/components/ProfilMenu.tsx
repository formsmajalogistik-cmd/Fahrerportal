import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useFahrerContext } from '../auth/FahrerContext';
import { displayName, fahrerName, initials } from '../lib/names';

/**
 * Header-Profil-Menü: zeigt das aktive Unterkonto, enthält den Konto-
 * Wechsler und Standard-Links (Profil, Unterkonten verwalten, Abmelden).
 */
export function ProfilMenu() {
  const { profile, signOut } = useAuth();
  const { activeFahrer, availableFahrer, setActive } = useFahrerContext();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!profile) return null;
  const aktivLabel = activeFahrer
    ? fahrerName(activeFahrer, profile)
    : displayName(profile);
  const hasMultiple = availableFahrer.length > 1;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-maja-light"
        title="Profil und Einstellungen"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-maja-navy text-xs font-semibold text-white">
          {initials(profile)}
        </span>
        <span className="hidden text-right text-xs sm:block">
          <span className="block font-medium text-maja-ink">{aktivLabel}</span>
          <span className="block text-maja-muted">
            {profile.role === 'admin' ? 'Admin'
              : profile.role === 'auftraggeber' ? 'Auftraggeber'
              : 'Fahrer'}
            {activeFahrer?.ist_unterkonto ? ' · Unterkonto' : ''}
          </span>
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-64 rounded-lg border border-maja-navy/10 bg-white p-1 shadow-card"
        >
          <div className="px-3 py-2 text-xs text-maja-muted">
            Angemeldet als <span className="font-medium text-maja-ink">{displayName(profile)}</span>
          </div>

          {hasMultiple && (
            <>
              <div className="border-t border-maja-navy/10 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-maja-muted">
                Konto wechseln
              </div>
              {availableFahrer.map((f) => {
                const label = fahrerName(f, profile);
                const active = activeFahrer?.id === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => { setActive(f.id); setOpen(false); }}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition ${
                      active ? 'bg-maja-navy/5 font-semibold text-maja-navy' : 'text-maja-ink hover:bg-maja-light'
                    }`}
                  >
                    <span className="truncate">
                      {label}
                      {f.ist_unterkonto ? '' : ' (Haupt)'}
                    </span>
                    {active && <span aria-hidden="true" className="text-xs text-maja-accent">●</span>}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => { setActive(null); setOpen(false); }}
                className="block w-full rounded-md px-3 py-2 text-left text-sm text-maja-muted transition hover:bg-maja-light"
              >
                Zur Konto-Auswahl …
              </button>
              <div className="my-1 border-t border-maja-navy/10" />
            </>
          )}

          <Link
            to="/profil"
            onClick={() => setOpen(false)}
            className="block rounded-md px-3 py-2 text-sm text-maja-ink hover:bg-maja-light"
          >
            Profil
          </Link>
          {profile.role !== 'auftraggeber' && (
            <Link
              to="/meine-unterkonten"
              onClick={() => setOpen(false)}
              className="block rounded-md px-3 py-2 text-sm text-maja-ink hover:bg-maja-light"
            >
              Meine Unterkonten
            </Link>
          )}
          <button
            type="button"
            onClick={() => { setOpen(false); void signOut(); }}
            className="mt-1 block w-full rounded-md px-3 py-2 text-left text-sm text-maja-ink hover:bg-maja-light"
          >
            Abmelden
          </button>
        </div>
      )}
    </div>
  );
}
