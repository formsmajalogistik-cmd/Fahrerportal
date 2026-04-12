interface LogoProps {
  variant?: 'light' | 'dark';
  size?: number;
  showText?: boolean;
}

/**
 * Maja Logistik logo — uses the actual Firmenlogo.png (VW Beetle).
 *
 * The image is served from /Firmenlogo.png (public/ directory).
 * The logo has its own white/light background with navy/blue artwork,
 * so it needs no CSS filters — it provides sufficient contrast on both
 * light and dark backgrounds.
 */
export function Logo({ variant = 'dark', size = 44, showText = true }: LogoProps) {
  const subColor = variant === 'light' ? 'rgba(255,255,255,0.7)' : '#2C5F8A';

  return (
    <div className="maja-logo" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
      <img
        src="/Firmenlogo.png"
        alt="Maja Logistik"
        style={{
          height: size,
          width: 'auto',
          objectFit: 'contain',
          flexShrink: 0,
          borderRadius: 6,
        }}
      />
      {showText && (
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
          <span
            style={{
              fontSize: '0.62rem',
              fontWeight: 500,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: subColor,
            }}
          >
            Fahrerportal
          </span>
        </div>
      )}
    </div>
  );
}
