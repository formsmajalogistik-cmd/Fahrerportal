interface LogoProps {
  variant?: 'light' | 'dark';
  size?: number;
  showText?: boolean;
}

/**
 * Maja Logistik logo — uses the actual Firmenlogo.png (VW Beetle).
 *
 * The image is served from /Firmenlogo.png (public/ directory).
 * On dark backgrounds (header) use variant='light' to apply a
 * brightness/invert filter so the logo stays visible.
 */
export function Logo({ variant = 'dark', size = 44, showText = true }: LogoProps) {
  const subColor = variant === 'light' ? 'rgba(255,255,255,0.7)' : '#2C5F8A';

  // On the dark navy header the original dark-on-white logo needs to be
  // inverted to white so it remains legible.
  const imgStyle: React.CSSProperties = {
    height: size,
    width: 'auto',
    objectFit: 'contain',
    flexShrink: 0,
    ...(variant === 'light'
      ? { filter: 'brightness(0) invert(1)', opacity: 0.95 }
      : {}),
  };

  return (
    <div className="maja-logo" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
      <img
        src="/Firmenlogo.png"
        alt="Maja Logistik"
        style={imgStyle}
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
