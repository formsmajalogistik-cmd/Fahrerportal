import type { SVGProps } from 'react';

/**
 * Minimal inline SVG icon set used throughout the app. Replaces the
 * earlier emoji icons so that rendering is consistent across platforms
 * and matches the Maja Logistik brand color palette.
 *
 * All icons are 24x24, stroke-based, and inherit currentColor so they
 * can be recolored via CSS.
 */
export type IconName =
  | 'dashboard'
  | 'document'
  | 'clock'
  | 'arrow-left'
  | 'arrow-right'
  | 'menu'
  | 'logout'
  | 'refresh'
  | 'check'
  | 'search'
  | 'truck';

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 20, ...rest }: IconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...rest,
  };

  switch (name) {
    case 'dashboard':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="9" rx="1" />
          <rect x="14" y="3" width="7" height="5" rx="1" />
          <rect x="14" y="12" width="7" height="9" rx="1" />
          <rect x="3" y="16" width="7" height="5" rx="1" />
        </svg>
      );
    case 'document':
      return (
        <svg {...common}>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
          <path d="M9 13h6" />
          <path d="M9 17h4" />
        </svg>
      );
    case 'clock':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case 'arrow-left':
      return (
        <svg {...common}>
          <path d="M19 12H5" />
          <path d="M12 19l-7-7 7-7" />
        </svg>
      );
    case 'arrow-right':
      return (
        <svg {...common}>
          <path d="M5 12h14" />
          <path d="M12 5l7 7-7 7" />
        </svg>
      );
    case 'menu':
      return (
        <svg {...common}>
          <path d="M4 6h16" />
          <path d="M4 12h16" />
          <path d="M4 18h16" />
        </svg>
      );
    case 'logout':
      return (
        <svg {...common}>
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="M16 17l5-5-5-5" />
          <path d="M21 12H9" />
        </svg>
      );
    case 'refresh':
      return (
        <svg {...common}>
          <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
          <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M3 21v-5h5" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <path d="M20 6L9 17l-5-5" />
        </svg>
      );
    case 'search':
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
      );
    case 'truck':
      return (
        <svg {...common}>
          <path d="M1 4h14v12H1z" />
          <path d="M15 8h4l3 3v5h-7" />
          <circle cx="6" cy="18" r="2" />
          <circle cx="18" cy="18" r="2" />
        </svg>
      );
    default:
      return null;
  }
}
