interface LogoProps {
  variant?: 'light' | 'dark';
  size?: number;
  showText?: boolean;
}

/**
 * Maja Logistik logo — classic VW Beetle with exhaust cloud.
 *
 * Detailed inline SVG recreation of the brand logo: a side-profile VW
 * Beetle driving right with stylized exhaust clouds behind it, speed
 * lines underneath, and "MAJA LOGISTIK" wordmark below.
 *
 * Two variants: 'light' for the dark header and 'dark' for light
 * backgrounds (login page, print, etc.).
 */
export function Logo({ variant = 'dark', size = 44, showText = true }: LogoProps) {
  const primary = variant === 'light' ? '#FFFFFF' : '#1B3A5C';
  const accent = variant === 'light' ? 'rgba(255,255,255,0.7)' : '#2C5F8A';

  return (
    <div className="maja-logo" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 120 100"
        fill="none"
        aria-hidden="true"
        style={{ flexShrink: 0 }}
      >
        {/* ── Exhaust clouds ─────────────────────────────── */}
        <circle cx="12" cy="52" r="7" fill={accent} opacity="0.35" />
        <circle cx="22" cy="46" r="9" fill={accent} opacity="0.45" />
        <circle cx="18" cy="38" r="6" fill={accent} opacity="0.30" />
        <circle cx="30" cy="40" r="7.5" fill={accent} opacity="0.40" />
        <circle cx="26" cy="50" r="5" fill={accent} opacity="0.25" />

        {/* ── Beetle body ────────────────────────────────── */}
        {/* Main body shell */}
        <path
          d="M42 68 C42 68 44 58 50 52 C56 46 64 44 72 42 C78 40 84 40 88 42
             C92 44 96 48 98 54 L100 58 C102 58 104 60 104 62 L104 68 Z"
          fill={primary}
          stroke={primary}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        {/* Roof / top curve */}
        <path
          d="M58 52 C60 44 66 38 74 36 C80 34 86 36 88 42"
          fill="none"
          stroke={primary}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        {/* Roof filled area */}
        <path
          d="M58 52 C60 44 66 38 74 36 C80 34 86 36 88 42 C86 44 82 44 76 44 C70 44 64 46 58 52Z"
          fill={primary}
        />
        {/* Windshield */}
        <path
          d="M82 42 C83 40 85 38 87 40 L88 42 C86 43 84 43 82 42Z"
          fill={variant === 'light' ? 'rgba(255,255,255,0.25)' : '#7BA3C9'}
          stroke={primary}
          strokeWidth="0.5"
        />
        {/* Rear window */}
        <path
          d="M62 50 C63 46 66 43 70 42 C68 44 66 47 64 50Z"
          fill={variant === 'light' ? 'rgba(255,255,255,0.25)' : '#7BA3C9'}
          stroke={primary}
          strokeWidth="0.5"
        />
        {/* Fender line */}
        <path
          d="M46 64 L98 64"
          stroke={variant === 'light' ? 'rgba(255,255,255,0.4)' : '#4A7A9E'}
          strokeWidth="0.8"
        />
        {/* Front bumper */}
        <path
          d="M100 62 C102 62 105 63 105 66 L105 68 L100 68"
          fill={primary}
          stroke={primary}
          strokeWidth="1"
        />
        {/* Rear bumper */}
        <path
          d="M42 68 C40 68 38 67 38 65 L38 64 L42 64"
          fill={primary}
          stroke={primary}
          strokeWidth="1"
        />
        {/* Headlight */}
        <ellipse cx="103" cy="60" rx="2" ry="1.8"
          fill={variant === 'light' ? 'rgba(255,255,255,0.5)' : '#E8D44D'}
          stroke={primary}
          strokeWidth="0.5"
        />
        {/* Tail light */}
        <ellipse cx="40" cy="60" rx="1.5" ry="1.5"
          fill={variant === 'light' ? 'rgba(255,200,200,0.5)' : '#C94444'}
          stroke={primary}
          strokeWidth="0.5"
        />
        {/* Door handle */}
        <line x1="76" y1="52" x2="80" y2="52"
          stroke={variant === 'light' ? 'rgba(255,255,255,0.3)' : '#4A7A9E'}
          strokeWidth="1"
          strokeLinecap="round"
        />

        {/* ── Wheels ─────────────────────────────────────── */}
        {/* Rear wheel */}
        <circle cx="54" cy="70" r="8" fill={primary} stroke={primary} strokeWidth="1" />
        <circle cx="54" cy="70" r="5.5"
          fill={variant === 'light' ? 'rgba(255,255,255,0.15)' : '#364F6B'}
        />
        <circle cx="54" cy="70" r="2.5" fill={primary} />
        {/* Front wheel */}
        <circle cx="92" cy="70" r="8" fill={primary} stroke={primary} strokeWidth="1" />
        <circle cx="92" cy="70" r="5.5"
          fill={variant === 'light' ? 'rgba(255,255,255,0.15)' : '#364F6B'}
        />
        <circle cx="92" cy="70" r="2.5" fill={primary} />

        {/* ── Speed lines ────────────────────────────────── */}
        <line x1="28" y1="72" x2="38" y2="72"
          stroke={accent} strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
        <line x1="22" y1="76" x2="42" y2="76"
          stroke={accent} strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
        <line x1="32" y1="80" x2="46" y2="80"
          stroke={accent} strokeWidth="1" strokeLinecap="round" opacity="0.3" />

        {/* ── Ground line ────────────────────────────────── */}
        <line x1="44" y1="78" x2="106" y2="78"
          stroke={accent} strokeWidth="0.8" opacity="0.3" />
      </svg>
      {showText && (
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
          <span
            style={{
              fontSize: '1.05rem',
              fontWeight: 800,
              letterSpacing: '0.1em',
              color: primary,
            }}
          >
            MAJA LOGISTIK
          </span>
          <span
            style={{
              fontSize: '0.62rem',
              fontWeight: 500,
              letterSpacing: '0.2em',
              textTransform: 'uppercase' as const,
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
