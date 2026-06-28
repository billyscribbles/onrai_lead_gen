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
