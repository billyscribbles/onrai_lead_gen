import { parseCsv } from './csv'
import type { Lead, RawLead, SocialPlatform } from '../types'

/**
 * Tier ranking encodes the ICP from CLAUDE.md:
 *   1  social_only + phone  — top of the best of the best
 *   2  social_only          — strong signal, no fetch needed
 *   3  none + phone         — clean gap, easy to reach
 *   4  none                 — clean gap, reach via socials/maps
 *   5  broken / not_mobile  — redesign buckets, lower confidence
 */
function tierFor(
  status: string,
  hasPhone: boolean,
): { tier: Lead['tier']; label: string } {
  if (status === 'social_only') {
    return hasPhone
      ? { tier: 1, label: 'Top tier' }
      : { tier: 2, label: 'Social only' }
  }
  if (status === 'none') {
    return hasPhone
      ? { tier: 3, label: 'No website' }
      : { tier: 4, label: 'No website' }
  }
  return { tier: 5, label: 'Redesign' }
}

function socialOf(url: string): SocialPlatform | null {
  if (!url) return null
  const u = url.toLowerCase()
  if (u.includes('instagram.')) return 'instagram'
  if (u.includes('facebook.') || u.includes('fb.')) return 'facebook'
  if (u.includes('tiktok.')) return 'tiktok'
  if (u.includes('linktr.ee') || u.includes('linktree')) return 'linktree'
  if (u.startsWith('http')) return 'other'
  return null
}

/** 0–100 confidence/heat used for the signal meter. */
function heatFor(tier: Lead['tier'], reviews: number, hasPhone: boolean): number {
  const tierBase = { 1: 78, 2: 62, 3: 58, 4: 44, 5: 30 }[tier]
  // reviews give traction proof; log-scaled so 3000 doesn't dwarf 200.
  const traction = Math.min(18, Math.log10(Math.max(1, reviews)) * 5)
  const reach = hasPhone ? 4 : 0
  return Math.round(Math.min(100, tierBase + traction + reach))
}

function toLead(raw: Record<string, string>, index: number): Lead {
  const r = raw as unknown as RawLead
  const hasPhone = Boolean(r.phone && r.phone.trim())
  const reviews = parseInt(r.reviews_count || '0', 10) || 0
  const ratingNum = parseFloat(r.rating)
  const { tier, label } = tierFor(r.web_status, hasPhone)

  return {
    id: `${r.business_name}-${index}`,
    name: r.business_name,
    category: r.category,
    webStatus: r.web_status,
    leadTag: r.lead_tag,
    rating: Number.isFinite(ratingNum) ? ratingNum : null,
    reviews,
    phone: r.phone?.trim() ?? '',
    website: r.website?.trim() ?? '',
    suburb: r.suburb || '',
    address: r.address || '',
    mapsUrl: r.google_maps_url || '',
    searchUrl: r.google_search_url || '',
    hasPhone,
    social: socialOf(r.website),
    tier,
    tierLabel: label,
    heat: heatFor(tier, reviews, hasPhone),
  }
}

/** Fetch + parse + classify, sorted hottest-first. */
export async function loadLeads(): Promise<Lead[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}leads.csv`)
  if (!res.ok) throw new Error(`Could not load leads.csv (${res.status})`)
  const text = await res.text()
  const leads = parseCsv(text).map(toLead)
  return sortLeads(leads)
}

/** Default ordering: tier, then traction (reviews), then rating. */
export function sortLeads(leads: Lead[]): Lead[] {
  return [...leads].sort(
    (a, b) =>
      a.tier - b.tier ||
      b.reviews - a.reviews ||
      (b.rating ?? 0) - (a.rating ?? 0),
  )
}
