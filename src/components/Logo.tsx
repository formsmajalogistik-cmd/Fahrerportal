interface LogoProps {
  variant?: 'light' | 'dark';
  size?: number;
  showText?: boolean;
}

/**
 * Maja Logistik wordmark logo.
 *
 * A stylized truck silhouette plus the MAJA LOGISTIK wordmark. Rendered
 * inline as SVG so it scales crisply and can be themed via the
 * `variant` prop (dark on light backgrounds, light on dark headers).
 *
 * Intentionally vector-only (no raster image) so it stays sharp on
 * any display and ships as part of the JS bundle instead of a separate
 * network request.
 */
export function Logo({ variant = 'dark', size = 40, showText = true }: LogoProps) {
  const primary = variant === 'light' ? '#FFFFFF' : '#1B3A5C';
  const accent = variant === 'light' ? '#E8F0F8' : '#2C5F8A';

  return (
    <div className="maja-logo" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="32" cy="32" r="30" fill={primary} />
        <path
          d="M12 38h28l6-6h6v10h-4a4 4 0 1 1-8 0H24a4 4 0 1 1-8 0h-4v-4z"
          fill={accent}
          stroke={variant === 'light' ? '#FFFFFF' : '#1B3A5C'}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <circle cx="20" cy="44" r="3" fill={primary} stroke={accent} strokeWidth="1" />
        <circle cx="44" cy="44" r="3" fill={primary} stroke={accent} strokeWidth="1" />
        <path
          d="M8 44c3 0 4-2 7-2"
          stroke={accent}
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      {showText && (
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
          <span
            style={{
              fontSize: '1rem',
              fontWeight: 800,
              letterSpacing: '0.08em',
              color: primary,
            }}
          >
            MAJA LOGISTIK
          </span>
          <span
            style={{
              fontSize: '0.65rem',
              fontWeight: 500,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: accent,
            }}
          >
            Fahrerportal
          </span>
        </div>
      )}
    </div>
  );
}
