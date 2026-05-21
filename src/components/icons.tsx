// Wiederverwendbare Inline-SVG-Icons (Heroicons-Stil). Ersetzen die
// Emoji-Glyphen, die wir nicht in produktiven UIs haben wollen — Emojis
// sind plattformabhängig gerendert und passen nicht zum Maja-Branding.

interface IconProps {
  className?: string;
  ariaLabel?: string;
}

function svgProps(className: string | undefined, ariaLabel: string | undefined) {
  return {
    viewBox: '0 0 20 20',
    fill: 'none' as const,
    stroke: 'currentColor' as const,
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: className ?? 'h-4 w-4',
    role: ariaLabel ? 'img' : 'presentation',
    'aria-label': ariaLabel,
    'aria-hidden': ariaLabel ? undefined : true,
  };
}

export function XIcon({ className, ariaLabel }: IconProps) {
  return (
    <svg {...svgProps(className, ariaLabel)}>
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}

export function CheckIcon({ className, ariaLabel }: IconProps) {
  return (
    <svg {...svgProps(className, ariaLabel)}>
      <path d="M4 10.5l4 4 8-9" />
    </svg>
  );
}

export function MailIcon({ className, ariaLabel }: IconProps) {
  return (
    <svg {...svgProps(className, ariaLabel)}>
      <rect x="2.5" y="4" width="15" height="12" rx="1.5" />
      <path d="M3 5.5l7 5.5 7-5.5" />
    </svg>
  );
}

export function EyeIcon({ className, ariaLabel }: IconProps) {
  return (
    <svg {...svgProps(className, ariaLabel)}>
      <path d="M1.8 10c1.5-3.5 4.6-5.8 8.2-5.8s6.7 2.3 8.2 5.8c-1.5 3.5-4.6 5.8-8.2 5.8S3.3 13.5 1.8 10z" />
      <circle cx="10" cy="10" r="2.4" />
    </svg>
  );
}

export function DownloadIcon({ className, ariaLabel }: IconProps) {
  return (
    <svg {...svgProps(className, ariaLabel)}>
      <path d="M10 3v9.5" />
      <path d="M6 9l4 4 4-4" />
      <path d="M3.5 16.5h13" />
    </svg>
  );
}

export function RefreshIcon({ className, ariaLabel }: IconProps) {
  return (
    <svg {...svgProps(className, ariaLabel)}>
      <path d="M3.5 10a6.5 6.5 0 0111.3-4.4" />
      <path d="M15 3v3.5h-3.5" />
      <path d="M16.5 10a6.5 6.5 0 01-11.3 4.4" />
      <path d="M5 17v-3.5h3.5" />
    </svg>
  );
}

export function FileTextIcon({ className, ariaLabel }: IconProps) {
  return (
    <svg {...svgProps(className, ariaLabel)}>
      <path d="M5 2.5h7l3.5 3.5v11A1 1 0 0114.5 18h-9.5A1 1 0 014 17V3.5A1 1 0 015 2.5z" />
      <path d="M12 2.5V6h3.5" />
      <path d="M7 10h6M7 13h6M7 7h2" />
    </svg>
  );
}

export function RotateLeftIcon({ className, ariaLabel }: IconProps) {
  return (
    <svg {...svgProps(className, ariaLabel)}>
      <path d="M3 5v4.5h4.5" />
      <path d="M3.5 9.5A6.5 6.5 0 1010 3.5" />
    </svg>
  );
}

export function RotateRightIcon({ className, ariaLabel }: IconProps) {
  return (
    <svg {...svgProps(className, ariaLabel)}>
      <path d="M17 5v4.5h-4.5" />
      <path d="M16.5 9.5A6.5 6.5 0 1110 3.5" />
    </svg>
  );
}

export function CheckBoxEmptyIcon({ className, ariaLabel }: IconProps) {
  return (
    <svg {...svgProps(className, ariaLabel)}>
      <rect x="3.5" y="3.5" width="13" height="13" rx="1.5" />
    </svg>
  );
}
