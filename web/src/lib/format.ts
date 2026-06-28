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
