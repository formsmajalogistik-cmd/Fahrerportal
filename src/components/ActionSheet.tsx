import { useEffect, type ReactNode } from 'react';

interface ActionSheetAction {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  icon?: ReactNode;
}

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  actions: ActionSheetAction[];
}

/**
 * Bottom-Sheet auf Mobile, zentrales kleines Modal auf Desktop —
 * für kurze Action-Auswahlen (Foto aufnehmen / Galerie / Löschen).
 */
export function ActionSheet({ open, onClose, title, actions }: Props) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-t-2xl bg-white p-2 shadow-card sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wide text-maja-muted">
            {title}
          </div>
        )}
        <ul className="space-y-1">
          {actions.map((a, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => { a.onClick(); onClose(); }}
                className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-base font-medium transition ${
                  a.destructive
                    ? 'text-red-600 hover:bg-red-50'
                    : 'text-maja-ink hover:bg-maja-light'
                }`}
              >
                {a.icon && <span className="flex h-5 w-5 items-center justify-center">{a.icon}</span>}
                <span>{a.label}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="my-1 border-t border-maja-navy/10" />
        <button
          type="button"
          onClick={onClose}
          className="block w-full rounded-lg px-4 py-3 text-center text-base font-medium text-maja-muted hover:bg-maja-light"
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}
