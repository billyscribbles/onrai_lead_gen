export type WebStatus = 'none' | 'social_only' | 'broken' | 'not_mobile' | string

export type SocialPlatform =
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | 'linktree'
  | 'other'

/** One row of the scraper CSV, lightly typed. */
export interface RawLead {
  business_name: string
  category: string
  web_status: WebStatus
  lead_tag: string
  rating: string
  reviews_count: string
  phone: string
  website: string
  suburb: string
  address: string
  google_maps_url: string
  google_search_url: string
}

/** A lead enriched with the derived fields the dial-sheet ranks on. */
export interface Lead {
  id: string
  name: string
  category: string
  webStatus: WebStatus
  leadTag: string
  rating: number | null
  reviews: number
  phone: string
  website: string
  suburb: string
  address: string
  mapsUrl: string
  searchUrl: string

  hasPhone: boolean
  social: SocialPlatform | null
  /** 1 = hottest. Drives default sort and the tier label. */
  tier: 1 | 2 | 3 | 4 | 5
  tierLabel: string
  /** 0–100, drives the signal meter width. */
  heat: number
}
