export function MajaLogo({ className = 'h-10' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <img
        src="/Firmenlogo.png"
        alt="Maja-Logistik"
        className="h-full w-auto object-contain"
      />
      <div className="hidden sm:flex flex-col leading-tight">
        <span className="text-base font-semibold tracking-tight text-maja-navy">
          Maja-Logistik
        </span>
        <span className="text-xs font-medium text-maja-muted">Business-Portal</span>
      </div>
    </div>
  );
}
