export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 text-maja-muted">
      <span
        className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-maja-accent border-t-transparent"
        aria-hidden="true"
      />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}
