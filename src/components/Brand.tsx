export function MajaLogo({ className = 'h-10' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <svg viewBox="0 0 48 48" className="h-full w-auto" aria-hidden="true">
        <rect width="48" height="48" rx="10" fill="#1B3A5C" />
        <path
          d="M12 34V16h4l6 10 6-10h4v18h-4V23l-5 8h-2l-5-8v11h-4z"
          fill="#E8F0F8"
        />
        <circle cx="38" cy="34" r="3" fill="#2C5F8A" />
      </svg>
      <div className="flex flex-col leading-tight">
        <span className="text-base font-semibold tracking-tight text-maja-navy">
          Maja-Logistik
        </span>
        <span className="text-xs font-medium text-maja-muted">Business-Portal</span>
      </div>
    </div>
  );
}
