/** Inline stroke icons — currentColor, 1.6 stroke, no external deps. */
type P = { className?: string }
const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export const Phone = ({ className }: P) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M4 5c0 8.3 6.7 15 15 15a2 2 0 0 0 2-2v-2.3a1 1 0 0 0-.8-1l-3.4-.7a1 1 0 0 0-1 .4l-.8 1.1a12 12 0 0 1-5.3-5.3l1.1-.8a1 1 0 0 0 .4-1L9.3 3.8a1 1 0 0 0-1-.8H6a2 2 0 0 0-2 2Z" />
  </svg>
)

export const LogOut = ({ className }: P) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M15 4h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-2" />
    <path d="M10 17l-5-5 5-5" />
    <path d="M5 12h12" />
  </svg>
)

export const Star = ({ className }: P) => (
  <svg {...base} className={className} fill="currentColor" stroke="none" aria-hidden="true">
    <path d="M12 3.5l2.5 5 5.5.8-4 3.9 1 5.5-4.9-2.6L7.7 18.7l1-5.5-4-3.9 5.5-.8 2.5-5z" />
  </svg>
)

export const MapPin = ({ className }: P) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
    <circle cx="12" cy="10" r="2.5" />
  </svg>
)

export const Search = ({ className }: P) => (
  <svg {...base} className={className} aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.2-3.2" />
  </svg>
)

export const Link = ({ className }: P) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M9 15l6-6" />
    <path d="M11 6.5l1-1a4 4 0 0 1 5.7 5.7l-1 1" />
    <path d="M13 17.5l-1 1a4 4 0 0 1-5.7-5.7l1-1" />
  </svg>
)

export const Close = ({ className }: P) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

export const Archive = ({ className }: P) => (
  <svg {...base} className={className} aria-hidden="true">
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
    <path d="M10 12h4" />
  </svg>
)

export const Plus = ({ className }: P) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const Menu = ({ className }: P) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
)

export const Rows = ({ className }: P) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
)

export const Signal = ({ className }: P) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M4 18v-3" />
    <path d="M9 18v-7" />
    <path d="M14 18v-9" />
    <path d="M19 18V5" />
  </svg>
)

export const Instagram = ({ className }: P) => (
  <svg {...base} className={className} aria-hidden="true">
    <rect x="4" y="4" width="16" height="16" rx="4.5" />
    <circle cx="12" cy="12" r="3.5" />
    <circle cx="17" cy="7" r="0.9" fill="currentColor" stroke="none" />
  </svg>
)

export const Facebook = ({ className }: P) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M14 8.5h2V5.5h-2.2C12 5.5 11 6.8 11 8.5V10H9v3h2v6h3v-6h2.2l.4-3H14V8.8c0-.2.1-.3.3-.3Z" fill="currentColor" stroke="none" />
  </svg>
)

export const TikTok = ({ className }: P) => (
  <svg {...base} className={className} aria-hidden="true">
    <path d="M14 4c.3 2.3 1.8 3.8 4 4v2.7c-1.5 0-2.9-.5-4-1.3v5.4a5 5 0 1 1-5-5c.3 0 .7 0 1 .1v2.8a2.2 2.2 0 1 0 1.5 2.1V4H14Z" fill="currentColor" stroke="none" />
  </svg>
)

export const SocialIcon = ({ platform, className }: { platform: string | null; className?: string }) => {
  if (platform === 'instagram') return <Instagram className={className} />
  if (platform === 'facebook') return <Facebook className={className} />
  if (platform === 'tiktok') return <TikTok className={className} />
  return <Link className={className} />
}
