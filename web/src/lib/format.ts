/** Compact number: 1493 -> "1.5k", 17 -> "17". */
export function compact(n: number): string {
  if (n >= 1000) {
    const k = n / 1000
    return `${k >= 10 ? Math.round(k) : k.toFixed(1)}k`.replace('.0k', 'k')
  }
  return String(n)
}

/** Strip the leading +61 / spaces for a tel: href. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`
}

const PLATFORM_LABEL: Record<string, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  linktree: 'Linktree',
  other: 'Social',
}

export function platformLabel(p: string | null): string {
  return p ? PLATFORM_LABEL[p] ?? 'Social' : ''
}

/**
 * Bucket a 0–100 heat score into a colour band for the signal meter.
 * Bands line up with the tier bases in `heatFor` so a top-tier lead
 * (social_only, ~72+) reads "hot", clean no-website gaps read "warm",
 * and the lower-confidence redesign buckets read "cool".
 */
export function heatLevel(heat: number): 'hot' | 'warm' | 'cool' {
  if (heat >= 72) return 'hot'
  if (heat >= 56) return 'warm'
  return 'cool'
}

/**
 * Parse a backend `created_at`. SQLite's `datetime('now')` yields
 * "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker, so we normalise to ISO and
 * tag it as UTC before handing it to Date.
 */
function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Short "generated on" date for the lead sheet: "29 Jun" (or "29 Jun 25"). */
export function formatDate(value: string | null | undefined): string {
  const d = parseDate(value)
  if (!d) return '—'
  const day = d.getDate()
  const mon = d.toLocaleString('en-AU', { month: 'short' })
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return sameYear ? `${day} ${mon}` : `${day} ${mon} ${String(d.getFullYear()).slice(2)}`
}

/** Full local timestamp for the column's hover title. */
export function formatDateTime(value: string | null | undefined): string {
  const d = parseDate(value)
  return d ? d.toLocaleString('en-AU') : ''
}

/** Sortable epoch ms (0 when missing) so "newest first" is a plain numeric sort. */
export function dateMs(value: string | null | undefined): number {
  const d = parseDate(value)
  return d ? d.getTime() : 0
}
